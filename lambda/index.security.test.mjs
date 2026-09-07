/**
 * Route-level security hardening (Monetisation Phase 2) — through the REAL
 * Lambda handler:
 *   - unknown paths → 404 with ZERO OpenAI involvement
 *   - /reflect/send remains explicitly reachable (the Seen app's route)
 *   - missing SEEN_APP_API_KEY config → FAIL CLOSED (401), never fail open
 *   - /test/push is no longer usable with only the public app key
 *   - /billing/balance requires a verified identity
 *
 * Explicit test configuration (per Phase 2 directive): the app key is SET
 * per test — nothing here relies on the historical fail-open behaviour.
 * FIRESTORE_EMULATOR_HOST points at a dead port so any accidental Firestore
 * touch fails fast and deterministically (fail-open paths tolerate it).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "seen-test";

const { handler } = await import("./index.mjs");
const adminMod = (await import("firebase-admin")).default;
const { makeFakeDb } = await import("./billing.test.mjs");

// Stub Firestore ENTIRELY: no gRPC channel is ever opened, so the throttle's
// window writes hit an in-memory fake and the process exits promptly. Every
// assertion below is about ROUTING/GATING, not storage.
const fakeDb = makeFakeDb();
Object.defineProperty(adminMod, "firestore", { value: () => fakeDb, configurable: true });

const APP_KEY = "explicit-test-app-key";

function req(path, { key = APP_KEY, body = {}, headers = {}, method = "POST" } = {}) {
  return {
    requestContext: { http: { path, method, sourceIp: "9.9.9.9" } },
    headers: { "x-seen-app-key": key, ...headers },
    body: JSON.stringify(body),
  };
}

before(() => {
  process.env.SEEN_APP_API_KEY = APP_KEY;
});
after(() => {
  delete process.env.SEEN_APP_API_KEY;
});

test("unknown route → 404, no OpenAI call (no key config would make one 500)", async () => {
  const res = await handler(req("/definitely-not-a-route", { body: { text: "hi" } }));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, "not_found");
});

test("another unknown route with reflect-shaped body → still 404", async () => {
  const res = await handler(req("/", { body: { text: "probe", language: "zh" } }));
  assert.equal(res.statusCode, 404);
});

test("/reflect/send remains explicitly reachable (empty text → 400 text_required)", async () => {
  const res = await handler(req("/reflect/send", { body: {} }));
  assert.equal(res.statusCode, 400, "route reached its own validator, not 404");
  assert.equal(JSON.parse(res.body).error, "text_required");
});

test("missing SEEN_APP_API_KEY config → FAIL CLOSED for every route", async () => {
  delete process.env.SEEN_APP_API_KEY;
  try {
    for (const path of ["/reflect/send", "/gift/retrieve", "/definitely-not-a-route"]) {
      const res = await handler(req(path, { body: { text: "x" } }));
      assert.equal(res.statusCode, 401, `${path} refused under missing config`);
    }
  } finally {
    process.env.SEEN_APP_API_KEY = APP_KEY;
  }
});

test("wrong app key → 401", async () => {
  const res = await handler(req("/reflect/send", { key: "not-the-key", body: { text: "x" } }));
  assert.equal(res.statusCode, 401);
});

test("/test/push with ONLY the public app key → 403 (no FCM reachable)", async () => {
  const res = await handler(req("/test/push", { body: { token: "fcm-token-x" } }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, "forbidden");
});

test("/billing/balance without identity → 401 (no balance leaks)", async () => {
  const res = await handler(req("/billing/balance"));
  assert.equal(res.statusCode, 401);
});

test("/gift/reply is routed (grant-less → 401 invalid_reply_auth, not 404)", async () => {
  const res = await handler(req("/gift/reply", { body: { message: "hi", idempotencyKey: "k".repeat(12) } }));
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, "invalid_reply_auth");
});

// --- Phase 3 admin test grant: direct-invoke ONLY, forever-idempotent -------

test("maintenance grant: HTTP-shaped events NEVER reach it (not publicly routable)", async () => {
  // Even with the magic field, anything wearing an HTTP envelope routes
  // normally — here to the 404 of an unknown path.
  const res = await handler({
    ...req("/definitely-not-a-route", { body: {} }),
    maintenance: "admin_test_grant_phase3",
  });
  assert.equal(res.statusCode, 404);
  // And a gateway-shaped event with rawPath only (no requestContext) is
  // still refused by the bare-event condition.
  const res2 = await handler({ maintenance: "admin_test_grant_phase3", rawPath: "/x" });
  assert.notEqual(res2?.ok, true);
});

test("maintenance grant: bare direct invoke grants +10000 PAID once, then already_applied", async () => {
  const grantDb = makeFakeDb();
  Object.defineProperty(adminMod, "firestore", { value: () => grantDb, configurable: true });
  Object.defineProperty(adminMod, "auth", {
    value: () => ({ getUserByEmail: async (email) => {
      assert.equal(email, "beingseenmatters@gmail.com");
      return { uid: "founder-uid-1" };
    } }),
    configurable: true,
  });
  try {
    // Pre-existing account: free 200 (topped this week), paid 500 — ADDITIVE.
    const NOW = Date.now();
    grantDb._store.set("creditAccounts/founder-uid-1", {
      schemaVersion: 1, free: 200, paid: 500, freeTopUpAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
    });

    const first = await handler({ maintenance: "admin_test_grant_phase3" });
    assert.equal(first.ok, true);
    assert.equal(first.alreadyApplied, false);
    assert.deepEqual(first.before, { free: 200, paid: 500 });
    assert.deepEqual(first.balancesAfter, { free: 200, paid: 10500 }); // free UNTOUCHED
    const acc = grantDb._store.get("creditAccounts/founder-uid-1");
    assert.equal(acc.free, 200);
    assert.equal(acc.paid, 10500);
    const entry = grantDb._store.get("creditLedger/admin_test_grant_phase3_founder-uid-1");
    assert.equal(entry.type, "adjustment");
    assert.equal(entry.product, "admin_test_grant");
    assert.equal(entry.amount, 10000);
    assert.equal(entry.freeDelta, 0);
    assert.equal(entry.paidDelta, 10000);
    assert.equal(entry.provider, null);       // NOT a purchase
    assert.equal(entry.providerRef, null);    // no payment provider record
    assert.equal(entry.meta.reason, "Phase 3 production testing");
    assert.deepEqual(entry.balancesAfter, { free: 200, paid: 10500 });

    // Second execution: 0 additional — forever.
    const second = await handler({ maintenance: "admin_test_grant_phase3" });
    assert.equal(second.ok, true);
    assert.equal(second.alreadyApplied, true);
    assert.equal(grantDb._store.get("creditAccounts/founder-uid-1").paid, 10500);
    const ledgerEntries = [...grantDb._store.keys()].filter((k) => k.startsWith("creditLedger/admin_test_grant"));
    assert.equal(ledgerEntries.length, 1);
  } finally {
    Object.defineProperty(adminMod, "firestore", { value: () => fakeDb, configurable: true });
  }
});
