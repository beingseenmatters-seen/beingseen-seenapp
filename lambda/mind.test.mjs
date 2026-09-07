/**
 * Mind.Seen / 观·静心 — corrected creator→publish→permanent-QR architecture.
 *
 * Properties under test: creation is NOT public (project owner/editor/admin
 * roles on individual accounts), 走近静心学堂 is the singleton LIVING entry
 * (continuously updatable, never archivable, same permanent id forever),
 * event entries share the same infrastructure via lifecycle (archivable —
 * URL keeps resolving, responses close), the receiver read returns ONLY
 * published creator content, media rides the staging→sealed pipeline under
 * the mind_{entryId} namespace, and statistics preserve full timestamped
 * history reporting BOTH lifetime and the recent window.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleMind,
  MIND_PROJECTS,
  MIND_RESPONSE_TYPES,
  MIND_MUSIC_THEMES,
  MIND_ENTRY_COLLECTION,
  MIND_RESPONSE_COLLECTION,
  MIND_RECENT_WINDOW_DAYS,
  MIND_LIMITS,
} from "./mind.mjs";

function makeFakeDb() {
  const store = new Map();
  const doc = (path) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    set: async (v) => { store.set(path, v); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({
        docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value)
          .map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })),
      }),
    }),
    get: async () => ({
      docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`))
        .map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })),
    }),
  });
  return { collection, _store: store };
}

/** Fake media store implementing the giftMedia store contract. */
function makeFakeStore() {
  const staging = new Map(); // `${uid}/${assetId}` → head
  const sealed = new Map();  // `${ns}/${assetId}` → true
  return {
    _staging: staging,
    _sealed: sealed,
    stage(uid, assetId, { type = "photo", contentType = "image/jpeg", bytes = 5000, durationMs } = {}) {
      staging.set(`${uid}/${assetId}`, {
        bytes, contentType,
        metadata: { uid, type, bytes: String(bytes), ...(durationMs ? { durationms: String(durationMs) } : {}) },
      });
    },
    async headStaging({ uid, assetId }) { return staging.get(`${uid}/${assetId}`) ?? null; },
    async copyToSealed({ uid, assetId, tokenHash }) {
      if (!staging.has(`${uid}/${assetId}`)) throw new Error("missing");
      sealed.set(`${tokenHash}/${assetId}`, true);
    },
    async deleteStaging({ uid, assetId }) { staging.delete(`${uid}/${assetId}`); },
    async deleteSealed({ tokenHash, assetId }) { sealed.delete(`${tokenHash}/${assetId}`); },
    async presignSealedGet({ tokenHash, assetId }) {
      return sealed.has(`${tokenHash}/${assetId}`) ? `https://signed.example/${tokenHash}/${assetId}` : null;
    },
  };
}

const fakeAuth = (emailToUid) => ({
  getUserByEmail: async (email) => {
    if (!emailToUid[email]) { const e = new Error("not_found"); throw e; }
    return { uid: emailToUid[email], email };
  },
});

const ADMIN = { uid: "founder", email: "beingseenmatters@gmail.com", email_verified: true, master_admin: true };
const OWNER = { uid: "owner-1", email: "owner@x.com", email_verified: true };
const EDITOR = { uid: "editor-1", email: "editor@x.com", email_verified: true };
const VISITOR = { uid: "someone", email: "v@x.com", email_verified: true };

const call = (db, decoded, body, extra = {}) => handleMind({ db, decoded, body, ...extra });

/** A db pre-seeded with owner-1 owning `zen_tea` + `approach`, editor-1 editing `zen_tea`. */
function seededDb() {
  const db = makeFakeDb();
  db._store.set("mindMembers/owner-1", {
    schemaVersion: 1, email: "owner@x.com",
    projects: { zen_tea: "owner", approach: "owner" }, updatedAt: 1, updatedBy: "founder",
  });
  db._store.set("mindMembers/editor-1", {
    schemaVersion: 1, email: "editor@x.com",
    projects: { zen_tea: "editor" }, updatedAt: 1, updatedBy: "owner-1",
  });
  return db;
}

// --- Authorization ------------------------------------------------------------

test("RETIRED bootstrap: the founder EMAIL alone (no claim, no stored role) grants nothing", async () => {
  const db = seededDb();
  const emailOnly = { uid: "founder", email: "beingseenmatters@gmail.com", email_verified: true };
  assert.equal((await call(db, emailOnly, { op: "manage" })).status, 403);
  assert.equal((await call(db, emailOnly, { op: "create", projectId: "zen_tea" })).status, 403);
  assert.equal((await call(db, emailOnly, { op: "location_set", nameZh: "x", address: "y" })).status, 403);
});


test("creation is NOT public: anonymous, plain accounts and editors are refused", async () => {
  const db = seededDb();
  assert.equal((await call(db, null, { op: "create", projectId: "zen_tea" })).status, 403);
  assert.equal((await call(db, VISITOR, { op: "create", projectId: "zen_tea" })).status, 403);
  assert.equal((await call(db, EDITOR, { op: "create", projectId: "zen_tea" })).status, 403); // editors edit, never create
  assert.equal((await call(db, OWNER, { op: "create", projectId: "zen_flowers" })).status, 403); // other project
  assert.equal((await call(db, OWNER, { op: "create", projectId: "made_up" })).status, 400);
  const ok = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.entryId);
});

test("member_set: admin grants owners; owners grant ONLY editors of their own project", async () => {
  const db = seededDb();
  const auth = fakeAuth({ "new@x.com": "new-1", "owner@x.com": "owner-1" });
  // Admin → owner role anywhere.
  const r1 = await call(db, ADMIN, { op: "member_set", email: "new@x.com", projectId: "zen_flowers", role: "owner" }, { auth });
  assert.equal(r1.status, 200);
  assert.equal(db._store.get("mindMembers/new-1").projects.zen_flowers, "owner");
  // Owner → editor within own project.
  const r2 = await call(db, OWNER, { op: "member_set", email: "new@x.com", projectId: "zen_tea", role: "editor" }, { auth });
  assert.equal(r2.status, 200);
  // Owner may NOT mint owners, touch other projects, or demote an owner.
  assert.equal((await call(db, OWNER, { op: "member_set", email: "new@x.com", projectId: "zen_tea", role: "owner" }, { auth })).status, 403);
  assert.equal((await call(db, OWNER, { op: "member_set", email: "new@x.com", projectId: "zen_flowers", role: "editor" }, { auth })).status, 403);
  assert.equal((await call(db, OWNER, { op: "member_set", email: "owner@x.com", projectId: "zen_tea", role: "none" }, { auth })).status, 403);
  // Editors hold no membership authority at all.
  assert.equal((await call(db, EDITOR, { op: "member_set", email: "new@x.com", projectId: "zen_tea", role: "editor" }, { auth })).status, 403);
  // Unknown account: individual Seen Matters accounts only — no shared login path.
  assert.equal((await call(db, ADMIN, { op: "member_set", email: "ghost@x.com", projectId: "zen_tea", role: "editor" }, { auth })).status, 404);
});

test("STORED Mind Admin role: assignable, full authority, no email hardcoding needed", async () => {
  const db = seededDb();
  const auth = fakeAuth({ "ops@x.com": "ops-1" });
  // Admin grants the GLOBAL role via the same door — it lands in the model
  // (mindMembers.admin), never in code.
  const r = await call(db, ADMIN, { op: "member_set", email: "ops@x.com", role: "admin" }, { auth });
  assert.equal(r.status, 200);
  assert.equal(db._store.get("mindMembers/ops-1").admin, true);
  // The stored admin — a PLAIN token, no claim, non-bootstrap email — has it all.
  const OPS = { uid: "ops-1", email: "ops@x.com", email_verified: true };
  assert.equal((await call(db, OPS, { op: "manage" })).status, 200);
  assert.equal((await call(db, OPS, { op: "create", projectId: "zen_flowers" })).status, 200);
  const mine = await call(db, OPS, { op: "mine" });
  assert.equal(mine.body.isAdmin, true);
  // Owners can never mint admins.
  assert.equal((await call(db, OWNER, { op: "member_set", email: "ops@x.com", role: "admin" }, { auth })).status, 403);
  // Admin removes all access with role none — the model empties, doc remains auditable.
  await call(db, ADMIN, { op: "member_set", email: "ops@x.com", role: "none" }, { auth });
  assert.equal(db._store.get("mindMembers/ops-1").admin, false);
  assert.equal((await call(db, OPS, { op: "manage" })).status, 403);
});

test("member_set FULL assignment (admin): role + multi-project checkboxes replace the standing", async () => {
  const db = seededDb();
  const auth = fakeAuth({ "c@x.com": "c-1" });
  // User C: Editor of 正念咖啡 + 公益讲座 in ONE save (the founder's example).
  const r = await call(db, ADMIN, { op: "member_set", email: "c@x.com", role: "editor", projectIds: ["mindful_coffee", "public_lecture"] }, { auth });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.projects, { mindful_coffee: "editor", public_lecture: "editor" });
  // Editing the assignment later REPLACES it — unchecked boxes disappear.
  const r2 = await call(db, ADMIN, { op: "member_set", email: "c@x.com", role: "owner", projectIds: ["zen_tea"] }, { auth });
  assert.deepEqual(r2.body.projects, { zen_tea: "owner" });
  // owner/editor with no projects checked is a form error, not a wipe.
  assert.equal((await call(db, ADMIN, { op: "member_set", email: "c@x.com", role: "editor", projectIds: [] }, { auth })).status, 400);
  assert.equal((await call(db, ADMIN, { op: "member_set", email: "c@x.com", role: "editor", projectIds: ["nope"] }, { auth })).status, 400);
});

test("AUTHZ matrix (§9): an Editor can never cross projects via URL/entryId or read others' feedback", async () => {
  const db = seededDb();
  // An approach entry exists (editor-1 is NOT assigned to approach).
  const a = await call(db, OWNER, { op: "create", projectId: "approach" });
  await call(db, OWNER, { op: "save", entryId: a.body.entryId, title: "走近静心学堂", intro: "。" });
  await call(db, OWNER, { op: "publish", entryId: a.body.entryId });
  await call(db, null, { op: "respond", entryId: a.body.entryId, responseType: "high_interest", message: "别的项目的私密留言" });
  // Editor of zen_tea, armed with the OTHER project's entryId:
  assert.equal((await call(db, EDITOR, { op: "save", entryId: a.body.entryId, title: "越权改" })).status, 403);
  assert.equal((await call(db, EDITOR, { op: "publish", entryId: a.body.entryId })).status, 403);
  assert.equal((await call(db, EDITOR, { op: "archive", entryId: a.body.entryId })).status, 403);
  // Their dashboard carries NO unrelated entries — and therefore none of the
  // approach responses/messages.
  const mine = await call(db, EDITOR, { op: "mine" });
  assert.equal(mine.body.entries.length, 0);
  assert.ok(!JSON.stringify(mine.body).includes("别的项目的私密留言"));
  // No membership authority, no global surface, no directory writes.
  assert.equal((await call(db, EDITOR, { op: "manage" })).status, 403);
  assert.equal((await call(db, EDITOR, { op: "location_set", nameZh: "x", address: "y" })).status, 403);
});

// --- Lifecycle: living singleton vs event entries -----------------------------

test("走近静心学堂 is the singleton LIVING entry; other projects mint many EVENT entries", async () => {
  const db = seededDb();
  const a = await call(db, OWNER, { op: "create", projectId: "approach" });
  assert.equal(a.status, 200);
  assert.equal(a.body.entry.lifecycle, "living");
  // A second official entry can never exist — the answer names the one that does.
  const dup = await call(db, OWNER, { op: "create", projectId: "approach" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.entryId, a.body.entryId);
  // Event projects: many entries over time, lifecycle "event".
  const e1 = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const e2 = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  assert.equal(e1.status, 200);
  assert.equal(e2.status, 200);
  assert.equal(e1.body.entry.lifecycle, "event");
  assert.notEqual(e1.body.entryId, e2.body.entryId);
});

test("LIVING entry: continuously updatable behind the SAME permanent id; never archivable", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "approach" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "走近静心学堂", intro: "第一版介绍" });
  await call(db, OWNER, { op: "publish", entryId });
  // Update loop: reflections replaced repeatedly, id/status/URL untouched.
  for (const intro of ["第二版：本周共修记录", "第三版：新学期安排"]) {
    const r = await call(db, OWNER, { op: "save", entryId, intro });
    assert.equal(r.status, 200);
    assert.equal(r.body.entry.entryId, entryId);
    assert.equal(r.body.entry.status, "published");
  }
  const pub = await call(db, null, { op: "entry", entryId });
  assert.equal(pub.body.intro, "第三版：新学期安排");
  assert.equal(pub.body.lifecycle, "living");
  // The official doorway can never be ended.
  assert.equal((await call(db, OWNER, { op: "archive", entryId })).status, 409);
});

test("EVENT entry: archiving keeps the printed QR resolving but closes responses", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "秋日茶会", intro: "十月的一席茶。" });
  // Draft cannot be archived; publish first.
  assert.equal((await call(db, OWNER, { op: "archive", entryId })).status, 409);
  await call(db, OWNER, { op: "publish", entryId });
  await call(db, null, { op: "respond", entryId, responseType: "browsing" });
  const arch = await call(db, OWNER, { op: "archive", entryId });
  assert.equal(arch.status, 200);
  // Permanent URL still resolves — honestly marked ended…
  const pub = await call(db, null, { op: "entry", entryId });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.archived, true);
  // …while new responses close, and history is preserved.
  assert.equal((await call(db, null, { op: "respond", entryId, responseType: "browsing" })).status, 409);
  const count = [...db._store.keys()].filter((k) => k.startsWith(`${MIND_RESPONSE_COLLECTION}/`)).length;
  assert.equal(count, 1);
});

// --- Permanent QR / publish gate ----------------------------------------------

test("drafts are invisible to the public; publish requires title+intro; id never changes", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  // Public receiver: draft = not found (QR opens only after publish).
  assert.equal((await call(db, null, { op: "entry", entryId })).status, 404);
  assert.equal((await call(db, null, { op: "respond", entryId, responseType: "browsing" })).status, 404);
  // Publish gate: a QR page must at least say what it is.
  assert.equal((await call(db, OWNER, { op: "publish", entryId })).status, 400);
  await call(db, OWNER, { op: "save", entryId, title: "茶会", intro: "一席茶。" });
  const pub = await call(db, OWNER, { op: "publish", entryId });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.entry.entryId, entryId); // the id minted at draft IS the published id
  assert.equal((await call(db, null, { op: "entry", entryId })).status, 200);
});

test("editors edit content and see stats, but can never publish", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  const save = await call(db, EDITOR, { op: "save", entryId, title: "编辑改的", intro: "内容更新" });
  assert.equal(save.status, 200);
  assert.equal((await call(db, EDITOR, { op: "publish", entryId })).status, 403);
  const mine = await call(db, EDITOR, { op: "mine" });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.entries.length, 1);
  assert.equal(mine.body.roles.zen_tea, "editor");
});

// --- Media over the existing pipeline -----------------------------------------

test("photos/voice: staged assets adopt into mind_{entryId}; public read presigns", async () => {
  const db = seededDb();
  const store = makeFakeStore();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  store.stage("owner-1", "photoAAAA11111111", {});
  store.stage("owner-1", "voiceAAAA11111111", { type: "audio", contentType: "audio/mp4", durationMs: 12_000 });

  const r = await call(db, OWNER, {
    op: "save", entryId,
    title: "茶会", intro: "一席茶。",
    photos: [{ assetId: "photoAAAA11111111" }],
    voice: { assetId: "voiceAAAA11111111" },
  }, { store });
  assert.equal(r.status, 200);
  assert.ok(store._sealed.has(`mind_${entryId}/photoAAAA11111111`));
  assert.ok(!store._staging.has("owner-1/photoAAAA11111111")); // staging cleaned
  assert.equal(r.body.entry.voice.durationMs, 12_000);

  await call(db, OWNER, { op: "publish", entryId });
  const pub = await call(db, null, { op: "entry", entryId }, { store });
  assert.equal(pub.body.photos.length, 1);
  assert.match(pub.body.photos[0].url, /^https:\/\/signed\.example\/mind_/);
  assert.match(pub.body.voice.url, /^https:\/\/signed\.example\//);

  // Removing the photo removes its sealed object too.
  const r2 = await call(db, OWNER, { op: "save", entryId, photos: [] }, { store });
  assert.equal(r2.status, 200);
  assert.ok(!store._sealed.has(`mind_${entryId}/photoAAAA11111111`));
});

test("media guards: unknown staged asset refused; photo cap is NINE; 佛乐 fail-closed", async () => {
  const db = seededDb();
  const store = makeFakeStore();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  assert.equal((await call(db, OWNER, { op: "save", entryId, photos: [{ assetId: "neverStaged123456" }] }, { store })).status, 400);
  // Mind follows the 9-photo invitation experience (Founder): 9 adopts, 10 refuses.
  const nine = Array.from({ length: 9 }, (_, i) => ({ assetId: `p${i}23456789012345678` }));
  for (const p of nine) store.stage("owner-1", p.assetId, {});
  const okNine = await call(db, OWNER, { op: "save", entryId, photos: nine }, { store });
  assert.equal(okNine.status, 200);
  assert.equal(okNine.body.entry.photos.length, 9);
  const ten = Array.from({ length: 10 }, (_, i) => ({ assetId: `q${i}23456789012345678` }));
  assert.equal((await call(db, OWNER, { op: "save", entryId, photos: ten }, { store })).status, 400);
  // Approved-only music: the allowlist is EMPTY until licensed tracks exist.
  assert.equal(MIND_MUSIC_THEMES.length, 0);
  assert.equal((await call(db, OWNER, { op: "save", entryId, musicThemeId: "any_track" })).status, 400);
  assert.equal((await call(db, OWNER, { op: "save", entryId, musicThemeId: null })).status, 200);
});

// --- Public responses ----------------------------------------------------------

test("respond: model + gates (types, disabled section, dropped message, throttle)", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "茶会", intro: "一席茶。" });
  await call(db, OWNER, { op: "publish", entryId });

  assert.deepEqual(MIND_RESPONSE_TYPES, ["high_interest", "interested_later", "browsing"]);
  assert.equal((await call(db, null, { op: "respond", entryId, responseType: "很感兴趣" })).status, 400);

  const ok = await call(db, VISITOR, { op: "respond", entryId, responseType: "high_interest", message: " 期待。 " }, { now: 777 });
  assert.equal(ok.status, 200);
  const rec = [...db._store.entries()].find(([k]) => k.startsWith(`${MIND_RESPONSE_COLLECTION}/`))[1];
  assert.equal(rec.entryId, entryId);
  assert.equal(rec.projectId, "zen_tea");
  assert.equal(rec.message, "期待。");
  assert.equal(rec.createdAt, 777); // timestamped — history is analytics-grade
  assert.equal(rec.uid, "someone");

  // Creator turned the message line off → messages are silently dropped.
  await call(db, OWNER, { op: "save", entryId, responseConfig: { enabled: true, allowMessage: false } });
  await call(db, null, { op: "respond", entryId, responseType: "browsing", message: "会被丢弃" });
  const msgs = [...db._store.entries()].filter(([k]) => k.startsWith(`${MIND_RESPONSE_COLLECTION}/`)).map(([, v]) => v.message);
  assert.ok(!msgs.includes("会被丢弃"));

  // Creator turned the whole response section off.
  await call(db, OWNER, { op: "save", entryId, responseConfig: { enabled: false, allowMessage: false } });
  assert.equal((await call(db, null, { op: "respond", entryId, responseType: "browsing" })).status, 409);

  // Rapid-repeat guard per source IP.
  await call(db, OWNER, { op: "save", entryId, responseConfig: { enabled: true, allowMessage: true } });
  assert.equal((await call(db, null, { op: "respond", entryId, responseType: "browsing" }, { now: 1000, sourceIp: "9.9.9.9" })).status, 200);
  assert.equal((await call(db, null, { op: "respond", entryId, responseType: "browsing" }, { now: 2000, sourceIp: "9.9.9.9" })).status, 429);
});

test("respond: voluntary contact fields — trimmed, capped, validated, never identity", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "茶会", intro: "一席茶。" });
  await call(db, OWNER, { op: "publish", entryId });
  const responses = () => [...db._store.entries()]
    .filter(([k]) => k.startsWith(`${MIND_RESPONSE_COLLECTION}/`)).map(([, v]) => v);

  // ANONYMOUS submission with contacts — no login, whitespace trimmed.
  const r1 = await call(db, null, {
    op: "respond", entryId, responseType: "high_interest",
    message: "想来。", displayName: "  王小姐 ", phone: " +61 400 000 000 ", email: " wang@example.com ",
  }, { now: 111 });
  assert.equal(r1.status, 200);
  const rec1 = responses()[0];
  assert.equal(rec1.displayName, "王小姐");
  assert.equal(rec1.phone, "+61 400 000 000");
  assert.equal(rec1.email, "wang@example.com");
  assert.equal(rec1.uid, null); // contact info is visitor-provided, never an account

  // Omitted / blank contacts → explicit nulls; the legacy shape is unchanged.
  await call(db, VISITOR, { op: "respond", entryId, responseType: "browsing", displayName: "   ", phone: "", email: "" }, { now: 222 });
  const rec2 = responses().find((r) => r.createdAt === 222);
  assert.equal(rec2.displayName, null);
  assert.equal(rec2.phone, null);
  assert.equal(rec2.email, null);
  assert.equal(rec2.uid, "someone");

  // Malformed email → 400 naming the field, and NOTHING is written.
  const before = responses().length;
  for (const bad of ["not-an-email", "a@b", "two @words.com", "a@@b.com"]) {
    const r = await call(db, null, { op: "respond", entryId, responseType: "browsing", email: bad });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "email");
  }
  assert.equal(responses().length, before);

  // Length caps are enforced by trimming, never by rejection.
  await call(db, null, {
    op: "respond", entryId, responseType: "browsing",
    displayName: "名".repeat(80), phone: "1".repeat(80),
  }, { now: 333 });
  const rec3 = responses().find((r) => r.createdAt === 333);
  assert.equal(rec3.displayName.length, MIND_LIMITS.displayName);
  assert.equal(rec3.phone.length, MIND_LIMITS.phone);

  // allowMessage:false drops the message but KEEPS the contact details.
  await call(db, OWNER, { op: "save", entryId, responseConfig: { enabled: true, allowMessage: false } });
  await call(db, null, { op: "respond", entryId, responseType: "high_interest", message: "会被丢弃", phone: "0400123456" }, { now: 444 });
  const rec4 = responses().find((r) => r.createdAt === 444);
  assert.equal(rec4.message, null);
  assert.equal(rec4.phone, "0400123456");

  // 0-credit rule: responding touches NO billing collection, ever.
  assert.ok(![...db._store.keys()].some((k) => k.startsWith("creditAccounts/") || k.startsWith("creditLedger/")));
});

test("statistics: contact-only responses are LISTED (reachable people are never invisible)", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "茶会", intro: "一席茶。" });
  await call(db, OWNER, { op: "publish", entryId });

  const now = Date.now();
  await call(db, null, { op: "respond", entryId, responseType: "high_interest", message: "只留言" }, { now: now - 3000 });
  await call(db, null, { op: "respond", entryId, responseType: "high_interest", phone: "0400123456", displayName: "李师兄" }, { now: now - 2000 });
  await call(db, null, { op: "respond", entryId, responseType: "browsing" }, { now: now - 1000 }); // type-only → counted, not listed

  const mine = await call(db, OWNER, { op: "mine" });
  const stats = mine.body.entries.find((e) => e.entryId === entryId).stats;
  assert.equal(stats.total, 3);
  assert.equal(stats.messages.length, 2); // the type-only response stays a count
  const [contactOnly, messageOnly] = stats.messages; // newest first
  assert.equal(contactOnly.message, null);
  assert.equal(contactOnly.displayName, "李师兄");
  assert.equal(contactOnly.phone, "0400123456");
  assert.equal(contactOnly.email, null);
  assert.equal(contactOnly.responseType, "high_interest");
  assert.equal(messageOnly.message, "只留言");
  assert.equal(messageOnly.displayName, null);
  // Pre-contact-era records (no contact keys at all) keep flowing through.
  db._store.set(`${MIND_RESPONSE_COLLECTION}/legacy-1`, {
    schemaVersion: 1, entryId, projectId: "zen_tea", responseType: "browsing",
    message: "旧留言", uid: null, createdAt: now - 500,
  });
  const again = await call(db, OWNER, { op: "mine" });
  const legacyRow = again.body.entries.find((e) => e.entryId === entryId).stats.messages[0];
  assert.equal(legacyRow.message, "旧留言");
  assert.equal(legacyRow.displayName, null);
  assert.equal(legacyRow.phone, null);
  assert.equal(legacyRow.email, null);
});

// --- Statistics: lifetime + recent window --------------------------------------

test("statistics preserve full history: lifetime AND recent-period, messages newest-first", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "approach" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "走近静心学堂", intro: "常设入口" });
  await call(db, OWNER, { op: "publish", entryId });

  const now = Date.now();
  const old = now - (MIND_RECENT_WINDOW_DAYS + 10) * 24 * 60 * 60 * 1000;
  // A year of life: two old responses, one recent — nothing ever deleted.
  await call(db, null, { op: "respond", entryId, responseType: "high_interest", message: "去年的留言" }, { now: old });
  await call(db, null, { op: "respond", entryId, responseType: "browsing" }, { now: old + 1000 });
  await call(db, null, { op: "respond", entryId, responseType: "high_interest", message: "这周的留言" }, { now: now - 1000 });

  const mine = await call(db, OWNER, { op: "mine" });
  const stats = mine.body.entries.find((e) => e.entryId === entryId).stats;
  assert.equal(stats.total, 3);                       // lifetime
  assert.equal(stats.byType.high_interest, 2);
  assert.equal(stats.recent.total, 1);                // recent window
  assert.equal(stats.recent.byType.high_interest, 1);
  assert.equal(stats.recent.windowDays, MIND_RECENT_WINDOW_DAYS);
  assert.deepEqual(stats.messages.map((m) => m.message), ["这周的留言", "去年的留言"]); // newest first
  assert.ok(stats.messages.every((m) => typeof m.createdAt === "number"));
});

test("manage: Mind Admin only — global entries, stats, member roster, scan TODO", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  await call(db, OWNER, { op: "save", entryId: body.entryId, title: "茶会", intro: "一席茶。" });
  assert.equal((await call(db, OWNER, { op: "manage" })).status, 403);
  assert.equal((await call(db, null, { op: "manage" })).status, 403);
  const r = await call(db, ADMIN, { op: "manage" });
  assert.equal(r.status, 200);
  assert.equal(r.body.entries.length, 1);
  assert.equal(r.body.entries[0].scanCount, null); // TODO(scan-count) — responses first
  assert.equal(r.body.members.length, 2);
  // Admin sees every project in mine too.
  const mine = await call(db, ADMIN, { op: "mine" });
  assert.equal(Object.keys(mine.body.roles).length, MIND_PROJECTS.length);
  assert.equal(mine.body.isAdmin, true);
});

// --- AI assist -----------------------------------------------------------------

test("draft: members only, calm-tone JSON contract, graceful failure", async () => {
  const db = seededDb();
  const callModel = async () => JSON.stringify({ intro: "一席茶，一段安静的时间。", bodyText: "本周六下午，欢迎来坐。" });
  assert.equal((await call(db, VISITOR, { op: "draft", projectId: "zen_tea" }, { callModel })).status, 403);
  const r = await call(db, EDITOR, { op: "draft", projectId: "zen_tea", title: "秋日茶会", notes: "十月 周六" }, { callModel });
  assert.equal(r.status, 200);
  assert.ok(r.body.intro.length > 0);
  const bad = await call(db, EDITOR, { op: "draft", projectId: "zen_tea" }, { callModel: async () => "not json" });
  assert.equal(bad.status, 502);
});

test("voice script: three SPOKEN alternatives from entry context — text only, hard content rules server-side", async () => {
  const db = seededDb();
  let seenPrompt = null;
  const callModel = async ({ system, user }) => {
    seenPrompt = { system, user };
    return JSON.stringify({ scripts: ["版本一，欢迎你来。", "版本二，我们在老地方等你。", "版本三，很期待见到你。"] });
  };
  // Members only — a visitor can never spend the model.
  assert.equal((await call(db, VISITOR, { op: "draft", kind: "voice_script", projectId: "zen_tea" }, { callModel })).status, 403);
  const r = await call(db, EDITOR, {
    op: "draft", kind: "voice_script", projectId: "zen_tea",
    title: "秋日茶会", notes: "想邀请老朋友来",
    styleHint: "风格：文艺一点。",
    context: { intro: "一席茶。", bodyText: "十月的周六下午。", eventDetails: "2026-10-10 · 15:00 · 老地方" },
  }, { callModel });
  assert.equal(r.status, 200);
  assert.equal(r.body.scripts.length, 3); // three alternatives, always
  // The entry's own context rode along — the creator never re-types it…
  assert.ok(seenPrompt.user.includes("秋日茶会"));
  assert.ok(seenPrompt.user.includes("一席茶。"));
  assert.ok(seenPrompt.user.includes("想邀请老朋友来"));
  // …the style flavour reuses the expression styleHint…
  assert.ok(seenPrompt.system.includes("风格：文艺一点。"));
  // …and the hard SPOKEN + no-invention rules live server-side, uncircumventable.
  assert.ok(seenPrompt.system.includes("READ ALOUD"));
  assert.ok(seenPrompt.system.includes("30–60 seconds"));
  assert.ok(seenPrompt.system.includes("济群法师"));
  // Malformed model output fails gracefully.
  const bad = await call(db, EDITOR, { op: "draft", kind: "voice_script", projectId: "zen_tea" }, { callModel: async () => JSON.stringify({ scripts: [] }) });
  assert.equal(bad.status, 502);
});

test("project-addressed public read: the landing reaches the LIVING singleton, ids never hardcoded", async () => {
  const db = seededDb();
  // Unpublished / unknown / non-living → 404 (event entries are never enumerable).
  assert.equal((await call(db, null, { op: "entry", projectId: "approach" })).status, 404);
  assert.equal((await call(db, null, { op: "entry", projectId: "zen_tea" })).status, 404);
  assert.equal((await call(db, null, { op: "entry", projectId: "nope" })).status, 404);
  const { body } = await call(db, OWNER, { op: "create", projectId: "approach" });
  await call(db, OWNER, { op: "save", entryId: body.entryId, title: "走近静心学堂", intro: "常设入口" });
  // Still a draft → still invisible via the project address.
  assert.equal((await call(db, null, { op: "entry", projectId: "approach" })).status, 404);
  await call(db, OWNER, { op: "publish", entryId: body.entryId });
  const r = await call(db, null, { op: "entry", projectId: "approach" });
  assert.equal(r.status, 200);
  // The SAME permanent entry — identical id and content as the direct read.
  assert.equal(r.body.entryId, body.entryId);
  const direct = await call(db, null, { op: "entry", entryId: body.entryId });
  assert.deepEqual(r.body.title, direct.body.title);
});

// --- 近期活动 landing (Founder 任务3) ------------------------------------------

test("landing eligibility: derived, explicit opt-in, event-only, never drafts/archived/living", async () => {
  const db = seededDb();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const mk = async (projectId, { title, publish = true, show = true, date, archive = false } = {}) => {
    const { body } = await call(db, OWNER, { op: "create", projectId });
    await call(db, OWNER, { op: "save", entryId: body.entryId, title, intro: "。",
      showOnMindLanding: show, ...(date ? { eventDetails: { date } } : {}) });
    if (publish) await call(db, OWNER, { op: "publish", entryId: body.entryId });
    if (archive) await call(db, OWNER, { op: "archive", entryId: body.entryId });
    return body.entryId;
  };
  const shownId = await mk("zen_tea", { title: "今天的茶会", date: today });          // eligible
  await mk("zen_tea", { title: "没勾展示", show: false });                            // opted out
  await mk("zen_tea", { title: "还是草稿", publish: false });                         // draft
  await mk("zen_tea", { title: "已结束的活动", archive: true });                      // archived
  await mk("zen_tea", { title: "上周的活动", date: "2020-01-01" });                   // date passed
  // The permanent Living Entry NEVER appears as an activity, even opted in.
  const living = await call(db, OWNER, { op: "create", projectId: "approach" });
  await call(db, OWNER, { op: "save", entryId: living.body.entryId, title: "走近静心学堂", intro: "。", showOnMindLanding: true });
  await call(db, OWNER, { op: "publish", entryId: living.body.entryId });

  // PUBLIC read — anonymous, no login (Founder §13).
  const r = await call(db, null, { op: "landing" }, { now });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.activities.map((a) => a.title), ["今天的茶会"]);
  assert.equal(r.body.activities[0].entryId, shownId);
  // The living block resolves the SAME permanent entry the QR uses.
  assert.equal(r.body.living.entryId, living.body.entryId);
  // Cards are lightweight discovery data — never heavy/private payloads.
  const card = r.body.activities[0];
  for (const absent of ["bodyText", "responses", "voice", "musicThemeId", "stats", "createdBy", "responseConfig"]) {
    assert.equal(card[absent], undefined, absent);
  }
  // …and the card's receiver is the EXISTING public entry (same id resolves).
  assert.equal((await call(db, null, { op: "entry", entryId: shownId })).status, 200);
});

test("showOnMindLanding: default OFF; owner toggles it; an editor's save cannot", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  assert.equal(body.entry.showOnMindLanding, false); // explicit opt-in only
  const ed = await call(db, EDITOR, { op: "save", entryId: body.entryId, showOnMindLanding: true });
  assert.equal(ed.body.entry.showOnMindLanding, false); // publishing control stays with owners
  const ow = await call(db, OWNER, { op: "save", entryId: body.entryId, showOnMindLanding: true });
  assert.equal(ow.body.entry.showOnMindLanding, true);
});

test("academy themeColor: on the LOCATION (identity), partial updates keep it, landing carries it", async () => {
  const db = seededDb();
  const { MIND_SEED_LOCATIONS } = await import("./mind.mjs");
  assert.equal(MIND_SEED_LOCATIONS[0].themeColor, "#155F8C"); // 安心 blue, seeded on the academy
  // An owner fixing the address does NOT wipe the theme (partial updates).
  await call(db, OWNER, { op: "location_set", locationId: "mel_anxin", nameZh: "墨尔本安心·静心学堂", address: "New Addr" });
  const locs = await call(db, OWNER, { op: "locations" });
  assert.equal(locs.body.locations.find((l) => l.locationId === "mel_anxin").themeColor, "#155F8C");
  // Landing living block exposes the theme via the entry's academy.
  const living = await call(db, OWNER, { op: "create", projectId: "approach" });
  await call(db, OWNER, { op: "save", entryId: living.body.entryId, title: "走近静心学堂", intro: "。", locationIds: ["mel_anxin"] });
  await call(db, OWNER, { op: "publish", entryId: living.body.entryId });
  const r = await call(db, null, { op: "landing" });
  assert.equal(r.body.living.themeColor, "#155F8C");
  // Bad hex refused; a second academy may carry its OWN colour.
  assert.equal((await call(db, ADMIN, { op: "location_set", nameZh: "x", address: "y", themeColor: "blue" })).status, 400);
  const zj = await call(db, ADMIN, { op: "location_set", nameZh: "墨尔本正见·静心学堂", address: "z", themeColor: "#5E8A72" });
  assert.equal(zj.body.location.themeColor, "#5E8A72");
});

test("dynamic projects (静心抄经): admin-added, full rails, aligned with every other activity", async () => {
  const db = seededDb();
  const auth = fakeAuth({ "scribe@x.com": "scribe-1" });
  // Admin only; seed identities are fixed.
  assert.equal((await call(db, OWNER, { op: "project_set", nameZh: "静心抄经" })).status, 403);
  assert.equal((await call(db, ADMIN, { op: "project_set", projectId: "zen_tea", nameZh: "改名" })).status, 400);
  const add = await call(db, ADMIN, { op: "project_set", nameZh: "静心抄经", nameEn: "Sutra Copying", emoji: "🖌️" });
  assert.equal(add.status, 200);
  const pid = add.body.project.id;
  assert.equal(add.body.project.lifecycle, "event"); // living stays 走近静心学堂 alone

  // The new project rides EVERY existing rail with zero further code:
  // membership → create → publish → opt-in → landing card, same receiver.
  await call(db, ADMIN, { op: "member_set", email: "scribe@x.com", role: "owner", projectIds: [pid] }, { auth });
  const SCRIBE = { uid: "scribe-1", email: "scribe@x.com", email_verified: true };
  const e = await call(db, SCRIBE, { op: "create", projectId: pid });
  assert.equal(e.status, 200);
  await call(db, SCRIBE, { op: "save", entryId: e.body.entryId, title: "十月抄经", intro: "。", showOnMindLanding: true });
  await call(db, SCRIBE, { op: "publish", entryId: e.body.entryId });
  const landing = await call(db, null, { op: "landing" });
  const card = landing.body.activities.find((a) => a.entryId === e.body.entryId);
  assert.equal(card.projectName, "静心抄经"); // server-authoritative label — no i18n/code change
  assert.equal(card.projectEmoji, "🖌️");
  // Public receiver carries the same project identity.
  const pub = await call(db, null, { op: "entry", entryId: e.body.entryId });
  assert.equal(pub.body.projectName, "静心抄经");
  // Members list / mine expose the merged registry for the choosers.
  const mine = await call(db, SCRIBE, { op: "mine" });
  assert.ok(mine.body.projects.some((pr) => pr.id === pid && pr.nameZh === "静心抄经"));
  assert.equal(mine.body.projects.length, MIND_PROJECTS.length + 1);
});

// --- 学堂 location directory ---------------------------------------------------

test("学堂 directory: seeded Melbourne centre exact; entries reference ids, fail-closed", async () => {
  const { MIND_SEED_LOCATIONS } = await import("./mind.mjs");
  // The first seeded centre — exactly the founder-supplied facts.
  const mel = MIND_SEED_LOCATIONS.find((l) => l.locationId === "mel_anxin");
  assert.equal(mel.nameZh, "墨尔本安心·静心学堂");
  assert.equal(mel.address, "50 Mersey St, Box Hill North VIC 3129, Australia");
  assert.equal(mel.status, "active");

  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  // A location is a DIRECTORY reference — free text / unknown ids refused.
  assert.equal((await call(db, OWNER, { op: "save", entryId, locationIds: ["made_up"] })).status, 400);
  const ok = await call(db, OWNER, { op: "save", entryId, title: "茶会", intro: "。", locationIds: ["mel_anxin"] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.entry.locationIds, ["mel_anxin"]);
  // Optional: clearing is one save away; never mandatory.
  assert.deepEqual((await call(db, OWNER, { op: "save", entryId, locationIds: [] })).body.entry.locationIds, []);
});

test("public receiver embeds resolved 学堂 destinations; none associated → empty", async () => {
  const db = seededDb();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  const entryId = body.entryId;
  await call(db, OWNER, { op: "save", entryId, title: "茶会", intro: "。", locationIds: ["mel_anxin"] });
  await call(db, OWNER, { op: "publish", entryId });
  const pub = await call(db, null, { op: "entry", entryId });
  assert.equal(pub.body.locations.length, 1);
  assert.equal(pub.body.locations[0].nameZh, "墨尔本安心·静心学堂");
  assert.equal(pub.body.locations[0].address, "50 Mersey St, Box Hill North VIC 3129, Australia");
  // Destination facts only — no admin fields leak to the public shape.
  assert.equal(pub.body.locations[0].createdAt, undefined);
  assert.equal(pub.body.locations[0].updatedBy, undefined);
  // No location → empty array (the receiver renders no section).
  const g2 = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  await call(db, OWNER, { op: "save", entryId: g2.body.entryId, title: "无地点", intro: "。" });
  await call(db, OWNER, { op: "publish", entryId: g2.body.entryId });
  assert.deepEqual((await call(db, null, { op: "entry", entryId: g2.body.entryId })).body.locations, []);
});

test("location_set: authorized roles only (admin + project owners) — stored overrides seed", async () => {
  const db = seededDb();
  // Never public; editors hold no directory authority either.
  assert.equal((await call(db, null, { op: "location_set", nameZh: "x", address: "y" })).status, 403);
  assert.equal((await call(db, VISITOR, { op: "location_set", nameZh: "x", address: "y" })).status, 403);
  assert.equal((await call(db, EDITOR, { op: "location_set", nameZh: "x", address: "y" })).status, 403);
  // A project OWNER keeps the centre current themselves (Founder: an address
  // change is self-serve) — the edit lands in the DIRECTORY, so every entry
  // referencing the centre updates behind its unchanged QR.
  const ownerEdit = await call(db, OWNER, { op: "location_set", locationId: "mel_anxin", nameZh: "墨尔本安心·静心学堂", address: "New Address 1, Box Hill VIC" });
  assert.equal(ownerEdit.status, 200);
  const seen = await call(db, OWNER, { op: "locations" });
  assert.equal(seen.body.locations.find((l) => l.locationId === "mel_anxin").address, "New Address 1, Box Hill VIC");
  // Admin adds the second centre (the multi-centre future).
  const add = await call(db, ADMIN, { op: "location_set", nameZh: "墨尔本正见·静心学堂", address: "123 Example Rd, Melbourne VIC", city: "Melbourne", country: "Australia" });
  assert.equal(add.status, 200);
  const listed = await call(db, OWNER, { op: "locations" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.locations.length, 2); // seed ∪ stored
  // A stored doc with the seed's id OVERRIDES the seed (e.g. adding coords later).
  await call(db, ADMIN, { op: "location_set", locationId: "mel_anxin", nameZh: "墨尔本安心·静心学堂", address: "50 Mersey St, Box Hill North VIC 3129, Australia", latitude: -37.8, longitude: 145.12 });
  const after = await call(db, OWNER, { op: "locations" });
  assert.equal(after.body.locations.find((l) => l.locationId === "mel_anxin").latitude, -37.8);
  // Members-only selector: a stranger cannot read the directory door.
  assert.equal((await call(db, VISITOR, { op: "locations" })).status, 403);
  // Validation: coordinates must be sane.
  assert.equal((await call(db, ADMIN, { op: "location_set", nameZh: "x", address: "y", latitude: 200 })).status, 400);
});

test("domain separation: every write lands in mind* collections only", async () => {
  const db = seededDb();
  const store = makeFakeStore();
  const { body } = await call(db, OWNER, { op: "create", projectId: "zen_tea" });
  await call(db, OWNER, { op: "save", entryId: body.entryId, title: "茶", intro: "。" }, { store });
  await call(db, OWNER, { op: "publish", entryId: body.entryId });
  await call(db, null, { op: "respond", entryId: body.entryId, responseType: "browsing" }, { sourceIp: "1.1.1.1" });
  assert.ok([...db._store.keys()].every((k) =>
    k.startsWith(`${MIND_ENTRY_COLLECTION}/`) || k.startsWith("mindMembers/") ||
    k.startsWith(`${MIND_RESPONSE_COLLECTION}/`) || k.startsWith("mindThrottle/") ||
    k.startsWith("mindLocations/")));
});
