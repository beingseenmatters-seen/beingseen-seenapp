/**
 * Anonymous AI throttle (Phase 2 security hardening) — transactional
 * sliding windows, generous for humans, fail-open on infrastructure error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { allowRequest, throttledResponse, THROTTLE_BUCKETS } from "./throttle.mjs";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

test("throttle: counts within the window and blocks at minuteMax", async () => {
  const db = makeFakeDb();
  const { minuteMax } = THROTTLE_BUCKETS.express_draft_anon;
  for (let i = 0; i < minuteMax; i++) {
    const r = await allowRequest({ db, bucket: "express_draft_anon", key: "1.2.3.4", now: NOW + i });
    assert.equal(r.allowed, true, `request ${i + 1} allowed`);
  }
  const blocked = await allowRequest({ db, bucket: "express_draft_anon", key: "1.2.3.4", now: NOW + 500 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000);
  const resp = throttledResponse(blocked);
  assert.equal(resp.status, 429);
  assert.equal(resp.body.error, "rate_limited");
});

test("throttle: minute window resets; hour cap still enforced", async () => {
  const db = makeFakeDb();
  const { minuteMax, hourMax } = THROTTLE_BUCKETS.voice_transcribe_anon;
  let t = NOW;
  let sent = 0;
  while (sent < hourMax) {
    for (let i = 0; i < minuteMax && sent < hourMax; i++, sent++) {
      const r = await allowRequest({ db, bucket: "voice_transcribe_anon", key: "k", now: t });
      assert.equal(r.allowed, true, `request ${sent} allowed`);
    }
    t += 61_000; // next minute window
  }
  const blocked = await allowRequest({ db, bucket: "voice_transcribe_anon", key: "k", now: t });
  assert.equal(blocked.allowed, false, "hour cap holds across minute resets");
  const later = await allowRequest({ db, bucket: "voice_transcribe_anon", key: "k", now: NOW + 3_600_001 });
  assert.equal(later.allowed, true, "hour window eventually resets");
});

test("throttle: separate keys and buckets are independent", async () => {
  const db = makeFakeDb();
  const { minuteMax } = THROTTLE_BUCKETS.express_draft_anon;
  for (let i = 0; i < minuteMax; i++) {
    await allowRequest({ db, bucket: "express_draft_anon", key: "ip-A", now: NOW });
  }
  assert.equal((await allowRequest({ db, bucket: "express_draft_anon", key: "ip-B", now: NOW })).allowed, true);
  assert.equal((await allowRequest({ db, bucket: "moment_caption_anon", key: "ip-A", now: NOW })).allowed, true);
});

test("throttle: unknown bucket and missing key fail open (never block traffic)", async () => {
  const db = makeFakeDb();
  assert.equal((await allowRequest({ db, bucket: "nope", key: "x", now: NOW })).allowed, true);
  assert.equal((await allowRequest({ db, bucket: "express_draft_anon", key: null, now: NOW })).allowed, true);
});

test("throttle: infrastructure error fails open", async () => {
  const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw new Error("firestore down"); } };
  const r = await allowRequest({ db, bucket: "express_draft_anon", key: "1.2.3.4", now: NOW });
  assert.equal(r.allowed, true);
});
