/**
 * Mind.Seen / 观·静心 — the ecosystem's 公益 (public-interest) branch.
 *
 * CORRECTED ARCHITECTURE (Founder, 2026-08-31): creation is NOT public.
 * The flow is Creator → Create/Edit → Preview → Publish → PERMANENT QR →
 * public receiver page → responses → creator statistics.
 *
 * V1 authorization — deliberately light, expansion-compatible (Founder):
 *   · Public visitor        view published entries + respond; no login.
 *   · Project Editor        edit assigned project's entries, see its responses.
 *   · Project Owner         create/publish/manage entries in their project(s),
 *                           assign project editors.
 *   · Mind Admin            everything, all projects + membership. Authority =
 *                           the ecosystem `master_admin` claim (tag.mjs
 *                           precedent) with the same temporary email bootstrap.
 * Roles attach to INDIVIDUAL Seen Matters accounts (mindMembers/{uid}) —
 * never a shared organization login. No org-management system in V1.
 *
 * Mind.Seen is structured around authorized PROJECTS (走近静心学堂 / 正念咖啡 /
 * 正念禅茶 / 禅意插花 / 按导活动 / 公益讲座 / 义工招募). 走近静心学堂 is the
 * special standing official entry: exactly ONE permanent entry (one permanent
 * QR, designated maintainers). Every other project may mint multiple event
 * entries over time.
 *
 * LIFECYCLE, NOT SEPARATE SYSTEMS (Founder): every entry carries
 * `lifecycle: "living" | "event"` over the same media/QR/response/analytics
 * infrastructure.
 *   · living — a permanent interactive entry (走近静心学堂): maintainers
 *     continuously replace study reflections, practice photos, text, voice
 *     and approved music behind the SAME URL/QR, forever; it can never be
 *     archived, and visitors keep responding for its whole life.
 *   · event  — may carry dates/venue and may be ENDED (status "archived"):
 *     the permanent URL keeps resolving (a printed poster never 404s) with
 *     an honest ended flag, while new responses close.
 * Response history is never deleted and every response is timestamped, so
 * statistics report BOTH lifetime and a recent-period window.
 *
 * PERMANENT QR PRINCIPLE: `entryId` is minted at DRAFT creation and never
 * changes; the QR and public receiver page open only after publish; edits
 * after publish update content behind the same entryId/URL/QR forever.
 *
 * ONE door (`POST /mind`, op-dispatched — the gateway route already exists):
 *   public:  entry (read published), respond (one interest response)
 *   member:  create, save, publish, mine, draft (AI text assist)
 *   admin:   manage (global), member_set (owners may set editors of their own
 *            project; admins may set any project role)
 *
 * Media rides the EXISTING pipeline end to end: staged via /gift/media/upload,
 * adopted here by the same staging→sealed copy the Gift seal uses, under the
 * namespace `mind_{entryId}`; the public read mints the same short-lived
 * presigned GETs. Domain stays separate: no Gift record is ever touched.
 */
import crypto from "node:crypto";
import { spokenSystemPrompt, parseScripts } from "./spokenScript.mjs";
import {
  MEDIA_MAX_BYTES,
  MEDIA_MIN_BYTES,
  AUDIO_MAX_DURATION_MS,
  PHOTO_CONTENT_TYPES,
  AUDIO_CONTENT_TYPES,
} from "./giftMedia.mjs";

export const MIND_ENTRY_COLLECTION = "mindEntries";
export const MIND_LOCATION_COLLECTION = "mindLocations";
export const MIND_MEMBER_COLLECTION = "mindMembers";
export const MIND_RESPONSE_COLLECTION = "mindResponses";
export const MIND_THROTTLE_COLLECTION = "mindThrottle";

/** The authorized projects. `approach` (走近静心学堂) is the singleton official
 *  entry; every other project may hold many entries. Adding a project is one
 *  id here + one registry row on the frontend. */
export const MIND_PROJECTS = [
  "approach",
  "mindful_coffee",
  "zen_tea",
  "zen_flowers",
  "guided_activity",
  "public_lecture",
  "volunteer",
];
export const MIND_PROJECT_COLLECTION = "mindProjects";
/** Seed project meta (server-authoritative display names). Dynamic projects
 *  (e.g. a future 静心抄经) are ADMIN-ADDED Firestore docs merged with these —
 *  their entries ride the exact same editor/publish/QR/response/landing rails,
 *  no landing or page code change ever needed. Dynamic projects are always
 *  EVENT lifecycle; the living singleton stays 走近静心学堂 alone. */
export const MIND_PROJECT_SEEDS = [
  { id: "approach", nameZh: "走近静心学堂", nameEn: "Approaching the Academy", emoji: "🏮", lifecycle: "living" },
  { id: "mindful_coffee", nameZh: "正念咖啡", nameEn: "Mindful Coffee", emoji: "☕", lifecycle: "event" },
  { id: "zen_tea", nameZh: "正念禅茶", nameEn: "Mindful Tea", emoji: "🍵", lifecycle: "event" },
  { id: "zen_flowers", nameZh: "禅意插花", nameEn: "Zen Flower Arranging", emoji: "🌸", lifecycle: "event" },
  { id: "guided_activity", nameZh: "按导活动", nameEn: "Guided Sessions", emoji: "🧘", lifecycle: "event" },
  { id: "public_lecture", nameZh: "公益讲座", nameEn: "Community Talks", emoji: "📖", lifecycle: "event" },
  { id: "volunteer", nameZh: "义工招募", nameEn: "Volunteering", emoji: "🤲", lifecycle: "event" },
];

/** The whole project registry: seeds ∪ stored (stored wins on the same id). */
async function projectsAll(db) {
  const map = new Map(MIND_PROJECT_SEEDS.map((p) => [p.id, { ...p, status: "active" }]));
  const snap = await db.collection(MIND_PROJECT_COLLECTION).get();
  for (const d of snap.docs ?? []) {
    map.set(d.id, { lifecycle: "event", status: "active", ...map.get(d.id), ...d.data(), id: d.id });
  }
  return map;
}
const projectPublic = (p) => ({ id: p.id, nameZh: p.nameZh, nameEn: p.nameEn ?? null, emoji: p.emoji ?? "🌿", lifecycle: p.lifecycle ?? "event" });
export const MIND_SINGLETON_PROJECTS = ["approach"];
/** Projects whose entries are LIVING (permanent, continuously updated). */
export const MIND_LIVING_PROJECTS = ["approach"];
/** The recent-period statistics window (days). */
export const MIND_RECENT_WINDOW_DAYS = 30;

/**
 * 学堂 location directory — a REUSABLE model, never free text inside entries
 * (Founder). V1 = this seeded list ∪ Firestore `mindLocations` docs (a stored
 * doc with the same id overrides its seed; new centres — 正见, Sydney, … —
 * arrive via op location_set, Mind Admin only). Entries reference locationIds.
 */
export const MIND_SEED_LOCATIONS = [
  {
    locationId: "mel_anxin",
    nameZh: "墨尔本安心·静心学堂",
    nameEn: null,
    address: "50 Mersey St, Box Hill North VIC 3129, Australia",
    latitude: null,
    longitude: null,
    googleMapsUrl: null,
    appleMapsUrl: null,
    country: "Australia",
    city: "Melbourne",
    // Academy identity colour (安心 blue, sampled from the official site
    // palette #155F8C/#1C76A6) — presentation of THIS academy only; Mind.Seen
    // keeps its neutral identity and other academies may carry their own.
    themeColor: "#155F8C",
    status: "active",
  },
];
/** 近期活动 public-display period: a dated event stays listed through its
 *  date and drops off afterwards (one day of grace absorbs timezones). */
export const MIND_LANDING_GRACE_MS = 24 * 60 * 60 * 1000;
export const MIND_ENTRY_LOCATIONS_MAX = 5;

/** Stable INTERNAL values (fixed in V1 — Founder); UI shows labels only. */
export const MIND_RESPONSE_TYPES = ["high_interest", "interested_later", "browsing"];

/** Approved 佛乐 allowlist — EMPTY until genuinely licensed tracks exist.
 *  Fail-closed exactly like the Gift music gate: nothing unlicensed sealable. */
export const MIND_MUSIC_THEMES = [];

export const MIND_LIMITS = {
  title: 60, intro: 200, bodyText: 2000, message: 200,
  // Visitor-provided contact details (Founder: an interest response may carry
  // a voluntary way to reach the person — never verified, never identity).
  displayName: 40, phone: 32, email: 254,
};
/** Mind entries follow the 9-photo invitation experience (Founder) — the
 *  Gift photo-story cap (5) is a different product decision, left untouched. */
export const MIND_PHOTOS_MAX = 9;
const RESPOND_COOLDOWN_MS = 30 * 1000;
const MESSAGES_LIST_MAX = 100;
const ASSET_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
// Format sanity only (one @, a dot in the domain, no whitespace) — contact
// info is never verified; this just refuses obvious non-addresses.
const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mind Admin = the ecosystem-level `master_admin` custom claim (the founder
// email bootstrap was RETIRED 2026-09-04 once the claim was verified live).
function isMindAdminSync(decoded) {
  return decoded?.master_admin === true;
}

/** Mind Admin = the master_admin claim OR the STORED member admin role
 *  (mindMembers/{uid}.admin) — the reusable authorization model (Founder §6:
 *  never role logic by email). */
async function isMindAdmin(db, decoded) {
  if (!decoded?.uid) return false;
  if (isMindAdminSync(decoded)) return true;
  const snap = await db.collection(MIND_MEMBER_COLLECTION).doc(decoded.uid).get();
  return snap.exists && snap.data()?.admin === true;
}

const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** The sealed-store namespace for an entry's media (`tokenHash` slot). */
const mindNs = (entryId) => `mind_${entryId}`;

/** Resolve this account's role for a project: admin | owner | editor | null. */
async function roleFor({ db, decoded, projectId }) {
  if (!decoded?.uid) return null;
  if (isMindAdminSync(decoded)) return "admin";
  const snap = await db.collection(MIND_MEMBER_COLLECTION).doc(decoded.uid).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data?.admin === true) return "admin"; // stored global role
  const role = data?.projects?.[projectId];
  return role === "owner" || role === "editor" ? role : null;
}

export async function handleMind({
  db, decoded = null, body, now = Date.now(), sourceIp = null,
  store = null, auth = null, callModel = null,
}) {
  switch (body?.op) {
    case "create": return createEntry({ db, decoded, body, now });
    case "save": return saveEntry({ db, decoded, body, now, store });
    case "publish": return publishEntry({ db, decoded, body, now });
    case "archive": return archiveEntry({ db, decoded, body, now });
    case "mine": return listMine({ db, decoded });
    case "entry": return readEntry({ db, body, store });
    case "landing": return readLanding({ db, store, now });
    case "respond": return submitMindResponse({ db, decoded, body, now, sourceIp });
    case "draft": return draftText({ db, decoded, body, callModel });
    case "member_set": return memberSet({ db, decoded, body, auth, now });
    case "locations": return listLocations({ db, decoded });
    case "location_set": return locationSet({ db, decoded, body, now });
    case "project_set": return projectSet({ db, decoded, body, now });
    case "manage": return mindManage({ db, decoded });
    default: return { status: 400, body: { error: "invalid_request", field: "op" } };
  }
}

// --- Creator plane ------------------------------------------------------------

/** op create — Project Owner (or Admin) mints a DRAFT with its permanent id. */
async function createEntry({ db, decoded, body, now }) {
  const projectId = clean(body?.projectId, 64);
  const project = (await projectsAll(db)).get(projectId);
  if (!project || project.status !== "active") {
    return { status: 400, body: { error: "unknown_project" } };
  }
  const role = await roleFor({ db, decoded, projectId });
  if (role !== "owner" && role !== "admin") return { status: 403, body: { error: "forbidden" } };

  // 走近静心学堂 is the ONE standing official entry — a second can never be
  // minted; its maintainers edit the existing one behind the same QR.
  if (MIND_SINGLETON_PROJECTS.includes(projectId)) {
    const existing = await db.collection(MIND_ENTRY_COLLECTION).where("projectId", "==", projectId).get();
    if ((existing.docs ?? []).length > 0) {
      return { status: 409, body: { error: "project_singleton", entryId: existing.docs[0].id } };
    }
  }

  // PERMANENT from this moment: the id outlives every future edit.
  const entryId = crypto.randomUUID();
  const rec = {
    schemaVersion: 1,
    projectId,
    // Lifecycle is intrinsic, not a separate system: the official standing
    // entry lives forever; project activities are events that may end.
    lifecycle: MIND_LIVING_PROJECTS.includes(projectId) ? "living" : "event",
    status: "draft",
    title: "",
    intro: "",
    bodyText: "",
    photos: [],
    voice: null,
    musicThemeId: null,
    responseConfig: { enabled: true, allowMessage: true },
    eventDetails: null,
    locationIds: [],
    // Discovery is an EXPLICIT opt-in, separate from publish: published =
    // reachable by URL/QR; showOnMindLanding = discoverable from /mind.
    showOnMindLanding: false,
    createdBy: decoded.uid,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  await db.collection(MIND_ENTRY_COLLECTION).doc(entryId).set(rec);
  return { status: 200, body: { entryId, entry: ownerShape(entryId, rec) } };
}

/** Validate ONE staged asset and adopt it into the entry's sealed namespace. */
async function adoptStagedAsset({ store, uid, entryId, assetId, expectAudio }) {
  if (!store) return { ok: false, status: 503, body: { error: "media_unavailable" } };
  if (!ASSET_ID_RE.test(assetId || "")) return { ok: false, status: 400, body: { error: "invalid_media" } };
  let head;
  try {
    head = await store.headStaging({ uid, assetId });
  } catch {
    return { ok: false, status: 502, body: { error: "media_attach_failed" } };
  }
  if (!head) return { ok: false, status: 400, body: { error: "invalid_media" } };
  const meta = head.metadata || {};
  const contentType = String(head.contentType || "").toLowerCase();
  const bytes = Number(meta.bytes ?? head.bytes ?? NaN);
  const okType = expectAudio
    ? meta.type === "audio" && AUDIO_CONTENT_TYPES.includes(contentType)
    : meta.type === "photo" && PHOTO_CONTENT_TYPES.includes(contentType);
  if (!okType || !Number.isFinite(bytes) || bytes > MEDIA_MAX_BYTES || bytes < MEDIA_MIN_BYTES) {
    return { ok: false, status: 400, body: { error: "invalid_media" } };
  }
  let durationMs = null;
  if (expectAudio) {
    durationMs = Number(meta.durationms ?? meta.durationMs ?? NaN);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_DURATION_MS) {
      return { ok: false, status: 400, body: { error: "invalid_media" } };
    }
  }
  try {
    await store.copyToSealed({ uid, assetId, tokenHash: mindNs(entryId) });
    await store.deleteStaging({ uid, assetId }).catch(() => {});
  } catch {
    return { ok: false, status: 502, body: { error: "media_attach_failed" } };
  }
  return { ok: true, fragment: { assetId, contentType, bytes, ...(expectAudio ? { durationMs } : {}) } };
}

/**
 * op save — Owner/Editor/Admin of the entry's project updates content.
 * NEVER changes entryId/status here; publish is its own explicit act.
 * Photos arrive as ordered [{assetId}] mixing already-attached ids (kept)
 * with freshly staged ones (validated + adopted); dropped ids are removed.
 */
async function saveEntry({ db, decoded, body, now, store }) {
  const entryId = clean(body?.entryId, 64);
  const ref = db.collection(MIND_ENTRY_COLLECTION).doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = snap.data();
  const role = await roleFor({ db, decoded, projectId: rec.projectId });
  if (!role) return { status: 403, body: { error: "forbidden" } };

  const updates = { updatedAt: now };
  if (body.title !== undefined) updates.title = clean(body.title, MIND_LIMITS.title);
  if (body.intro !== undefined) updates.intro = clean(body.intro, MIND_LIMITS.intro);
  if (body.bodyText !== undefined) updates.bodyText = clean(body.bodyText, MIND_LIMITS.bodyText);

  if (body.showOnMindLanding !== undefined && (role === "owner" || role === "admin")) {
    updates.showOnMindLanding = body.showOnMindLanding === true;
  }

  if (body.responseConfig !== undefined) {
    updates.responseConfig = {
      enabled: body.responseConfig?.enabled !== false,
      allowMessage: body.responseConfig?.allowMessage !== false,
    };
  }

  if (body.eventDetails !== undefined) {
    if (body.eventDetails === null) updates.eventDetails = null;
    else {
      const d = body.eventDetails;
      const date = clean(d?.date, 10);
      const timeStart = clean(d?.timeStart, 5);
      if (date && !DATE_RE.test(date)) return { status: 400, body: { error: "invalid_request", field: "eventDetails.date" } };
      if (timeStart && !TIME_RE.test(timeStart)) return { status: 400, body: { error: "invalid_request", field: "eventDetails.timeStart" } };
      updates.eventDetails = {
        ...(date ? { date } : {}),
        ...(timeStart ? { timeStart } : {}),
        ...(clean(d?.venueName, 80) ? { venueName: clean(d.venueName, 80) } : {}),
        ...(clean(d?.venueAddress, 160) ? { venueAddress: clean(d.venueAddress, 160) } : {}),
      };
      if (Object.keys(updates.eventDetails).length === 0) updates.eventDetails = null;
    }
  }

  if (body.locationIds !== undefined) {
    if (!Array.isArray(body.locationIds) || body.locationIds.length > MIND_ENTRY_LOCATIONS_MAX) {
      return { status: 400, body: { error: "invalid_request", field: "locationIds" } };
    }
    const known = await locationsAll(db);
    const ids = [];
    for (const raw of body.locationIds) {
      const id = clean(raw, 64);
      const loc = known.get(id);
      if (!loc || loc.status !== "active") {
        return { status: 400, body: { error: "unknown_location", locationId: id } };
      }
      if (!ids.includes(id)) ids.push(id);
    }
    updates.locationIds = ids;
  }

  if (body.musicThemeId !== undefined) {
    if (body.musicThemeId !== null && !MIND_MUSIC_THEMES.includes(body.musicThemeId)) {
      // Approved-only 佛乐: an empty allowlist means NOTHING is attachable yet.
      return { status: 400, body: { error: "invalid_request", field: "musicThemeId" } };
    }
    updates.musicThemeId = body.musicThemeId;
  }

  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > MIND_PHOTOS_MAX) {
      return { status: 400, body: { error: "invalid_request", field: "photos" } };
    }
    const current = new Map((rec.photos ?? []).map((p) => [p.assetId, p]));
    const nextPhotos = [];
    for (const p of body.photos) {
      const assetId = clean(p?.assetId, 64);
      if (current.has(assetId)) {
        nextPhotos.push(current.get(assetId)); // kept (supports reorder)
        continue;
      }
      const adopted = await adoptStagedAsset({ store, uid: decoded.uid, entryId, assetId, expectAudio: false });
      if (!adopted.ok) return { status: adopted.status, body: adopted.body };
      nextPhotos.push(adopted.fragment);
    }
    // Dropped photos leave the sealed store too (best-effort).
    for (const [assetId] of current) {
      if (!nextPhotos.some((p) => p.assetId === assetId) && store) {
        await store.deleteSealed({ tokenHash: mindNs(entryId), assetId }).catch(() => {});
      }
    }
    updates.photos = nextPhotos;
  }

  if (body.voice !== undefined) {
    if (body.voice === null) {
      if (rec.voice?.assetId && store) {
        await store.deleteSealed({ tokenHash: mindNs(entryId), assetId: rec.voice.assetId }).catch(() => {});
      }
      updates.voice = null;
    } else if (body.voice?.assetId && body.voice.assetId === rec.voice?.assetId) {
      updates.voice = rec.voice; // unchanged
    } else {
      const adopted = await adoptStagedAsset({ store, uid: decoded.uid, entryId, assetId: body.voice?.assetId, expectAudio: true });
      if (!adopted.ok) return { status: adopted.status, body: adopted.body };
      if (rec.voice?.assetId && store) {
        await store.deleteSealed({ tokenHash: mindNs(entryId), assetId: rec.voice.assetId }).catch(() => {});
      }
      updates.voice = adopted.fragment;
    }
  }

  await ref.update(updates);
  return { status: 200, body: { ok: true, entry: ownerShape(entryId, { ...rec, ...updates }) } };
}

/** op publish — Owner/Admin only (Editors edit, never publish). First publish
 *  opens the public receiver page; the QR may be shown from now on. */
async function publishEntry({ db, decoded, body, now }) {
  const entryId = clean(body?.entryId, 64);
  const ref = db.collection(MIND_ENTRY_COLLECTION).doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = snap.data();
  const role = await roleFor({ db, decoded, projectId: rec.projectId });
  if (role !== "owner" && role !== "admin") return { status: 403, body: { error: "forbidden" } };
  // A QR page must at least say what it is.
  if (!clean(rec.title, MIND_LIMITS.title) || !clean(rec.intro, MIND_LIMITS.intro)) {
    return { status: 400, body: { error: "incomplete", field: !rec.title ? "title" : "intro" } };
  }
  const updates = { status: "published", updatedAt: now, publishedAt: rec.publishedAt ?? now };
  await ref.update(updates);
  return { status: 200, body: { ok: true, entry: ownerShape(entryId, { ...rec, ...updates }) } };
}

/** op archive — Owner/Admin ends an EVENT entry: the permanent URL keeps
 *  resolving (with an honest ended flag) but new responses close. A LIVING
 *  entry can never be archived — 走近静心学堂 stays open for life. */
async function archiveEntry({ db, decoded, body, now }) {
  const entryId = clean(body?.entryId, 64);
  const ref = db.collection(MIND_ENTRY_COLLECTION).doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = snap.data();
  const role = await roleFor({ db, decoded, projectId: rec.projectId });
  if (role !== "owner" && role !== "admin") return { status: 403, body: { error: "forbidden" } };
  if ((rec.lifecycle ?? "event") === "living") return { status: 409, body: { error: "lifecycle_living" } };
  if (rec.status !== "published") return { status: 409, body: { error: "not_published" } };
  const updates = { status: "archived", updatedAt: now, archivedAt: now };
  await ref.update(updates);
  return { status: 200, body: { ok: true, entry: ownerShape(entryId, { ...rec, ...updates }) } };
}

/** op mine — every entry in projects where this account holds a role, with
 *  response statistics (Editors see their project's feedback too). */
async function listMine({ db, decoded }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const admin = await isMindAdmin(db, decoded);
  const memberSnap = await db.collection(MIND_MEMBER_COLLECTION).doc(decoded.uid).get();
  const projects = memberSnap.exists ? (memberSnap.data()?.projects ?? {}) : {};
  const registry = await projectsAll(db);
  const roles = admin
    ? Object.fromEntries([...registry.keys()].map((p) => [p, "admin"]))
    : projects;
  const projectList = [...registry.values()].filter((p) => p.status === "active").map(projectPublic);
  if (Object.keys(roles).length === 0) {
    return { status: 200, body: { isAdmin: false, roles: {}, entries: [], projects: [] } };
  }

  const [entriesSnap, aggregates] = await Promise.all([
    db.collection(MIND_ENTRY_COLLECTION).get(),
    responseAggregates(db, Date.now()),
  ]);
  const entries = (entriesSnap.docs ?? [])
    .map((d) => ({ id: d.id, rec: d.data() }))
    .filter(({ rec }) => roles[rec.projectId])
    .sort((a, b) => (b.rec.updatedAt ?? 0) - (a.rec.updatedAt ?? 0))
    .map(({ id, rec }) => ({
      ...ownerShape(id, rec),
      stats: aggregates.get(id) ?? emptyAggregate(),
    }));
  return { status: 200, body: { isAdmin: admin, roles, entries, projects: projectList } };
}

/** op draft — AI text assist for members (calm 公益 tone; never marketing).
 *  kind "voice_script" generates THREE spoken scripts the creator reads aloud
 *  while recording (Founder: AI text only — never TTS, never generated voice). */
async function draftText({ db, decoded, body, callModel }) {
  const projectId = clean(body?.projectId, 64);
  if (!(await projectsAll(db)).has(projectId)) return { status: 400, body: { error: "unknown_project" } };
  const role = await roleFor({ db, decoded, projectId });
  if (!role) return { status: 403, body: { error: "forbidden" } };
  if (!callModel) return { status: 503, body: { error: "draft_unavailable" } };
  const lang = body?.lang === "en" ? "en" : "zh";
  const notes = clean(body?.notes, 500);
  const title = clean(body?.title, MIND_LIMITS.title);
  if (body?.kind === "voice_script") return voiceScript({ body, callModel, lang, notes, title, projectId });
  try {
    const raw = await callModel({
      system:
        "You write short, calm, restrained Chinese/English copy for a public-interest mindfulness community page (观·静心 / Mind.Seen). " +
        "Tone: warm, quiet, respectful. NEVER salesy, never urgent, no exclamation pressure, no emojis, no pricing. " +
        'Return STRICT JSON: {"intro": "...", "bodyText": "..."} — intro ≤ 80 characters, bodyText ≤ 300 characters. ' +
        `Language: ${lang === "zh" ? "Simplified Chinese" : "English"}.`,
      user: `Project: ${projectId}. Title: ${title || "(untitled)"}. Creator notes: ${notes || "(none)"}`,
      maxTokens: 500,
      temperature: 0.7,
      jsonObject: true,
    });
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const intro = clean(parsed?.intro, MIND_LIMITS.intro);
    const bodyText = clean(parsed?.bodyText, MIND_LIMITS.bodyText);
    if (!intro && !bodyText) return { status: 502, body: { error: "draft_failed" } };
    return { status: 200, body: { intro, bodyText } };
  } catch {
    return { status: 502, body: { error: "draft_failed" } };
  }
}

/**
 * VOICE SCRIPT drafting — text a real person reads aloud to visitors about a
 * learning experience, reflection, community activity, invitation or feeling.
 * The hard content rules live HERE, server-side, so no client can drop them:
 * spoken register, restrained warmth, ~30–60s, nothing invented, and NOTHING
 * attributed to 济群法师 / 静心学堂 unless the creator supplied that text.
 * Style flavour arrives as the reused expression styleHint (client-side tone
 * registry) — Mind.Seen context replaces the gifting occasion entirely.
 */
async function voiceScript({ body, callModel, lang, notes, title, projectId }) {
  const ctx = body?.context ?? {};
  const styleHint = clean(body?.styleHint, 400);
  const contextLines = [
    `Project: ${projectId}`,
    title ? `Title: ${title}` : null,
    clean(ctx?.intro, MIND_LIMITS.intro) ? `Intro: ${clean(ctx.intro, MIND_LIMITS.intro)}` : null,
    clean(ctx?.bodyText, 800) ? `Existing description: ${clean(ctx.bodyText, 800)}` : null,
    clean(ctx?.eventDetails, 300) ? `Event details: ${clean(ctx.eventDetails, 300)}` : null,
    notes ? `Creator wants this to express: ${notes}` : null,
  ].filter(Boolean).join("\n");
  try {
    const raw = await callModel({
      // Shared spoken register (spokenScript.mjs) + Mind.Seen's OWN safeguards
      // as extraRules — the Buddhist/community rules live HERE only and can
      // never leak into another product's door (Founder isolation rule).
      system: spokenSystemPrompt({
        roleLine:
          "You help a mindfulness-community (观·静心 / 静心学堂) maintainer prepare a SHORT SPOKEN script they will READ ALOUD while recording a voice message for page visitors. It must mention length ~30–60 seconds discipline implicitly through brevity.",
        lang,
        extraRules:
          "NEVER invent Buddhist teachings, doctrine, quotations or claims; " +
          "NEVER attribute ANY statement to 济群法师 or 静心学堂 unless that exact source text appears in the supplied context.",
        styleHint,
      }),
      user: contextLines || "(no context supplied — a gentle generic welcome for this project)",
      maxTokens: 900,
      temperature: 0.8,
      jsonObject: true,
    });
    const scripts = parseScripts(raw);
    if (scripts.length === 0) return { status: 502, body: { error: "draft_failed" } };
    return { status: 200, body: { scripts } };
  } catch {
    return { status: 502, body: { error: "draft_failed" } };
  }
}

/**
 * op member_set — the 成员与权限 assignment door (Founder 任务2 §4).
 *
 * FULL-ASSIGNMENT semantics for Mind Admin: {email, role, projectIds[]}
 * describes the member's complete standing —
 *   · role "admin"  → global Mind Admin (stored flag; projects cleared);
 *   · role "owner"/"editor" + projectIds → exactly those project roles
 *     (previous assignment replaced — the checkbox UI is the whole truth);
 *   · role "none" → all access removed.
 * A project OWNER (never an Editor) may still manage EDITORS within their
 * own projects only — scoped MERGE semantics so they can never touch a
 * member's standing elsewhere, never mint owners/admins, and never demote
 * an owner or an admin.
 * Always an individual Seen Matters account resolved from email — the
 * shared-login path structurally never exists.
 */
async function memberSet({ db, decoded, body, auth, now }) {
  const newRole = body?.role;
  if (!["admin", "owner", "editor", "none"].includes(newRole)) {
    return { status: 400, body: { error: "invalid_request", field: "role" } };
  }
  const projectIds = [
    ...new Set(
      (Array.isArray(body?.projectIds) ? body.projectIds : body?.projectId ? [body.projectId] : [])
        .map((x) => clean(x, 64)),
    ),
  ];
  const knownProjects = await projectsAll(db);
  if (projectIds.some((pid) => !knownProjects.has(pid))) {
    return { status: 400, body: { error: "unknown_project" } };
  }
  if ((newRole === "owner" || newRole === "editor") && projectIds.length === 0) {
    return { status: 400, body: { error: "invalid_request", field: "projectIds" } };
  }

  const callerAdmin = await isMindAdmin(db, decoded);
  let callerOwnerProjects = [];
  if (!callerAdmin && decoded?.uid) {
    const callerSnap = await db.collection(MIND_MEMBER_COLLECTION).doc(decoded.uid).get();
    const projects = callerSnap.exists ? (callerSnap.data()?.projects ?? {}) : {};
    callerOwnerProjects = Object.entries(projects).filter(([, r]) => r === "owner").map(([pid]) => pid);
  }
  const ownerScoped =
    !callerAdmin &&
    callerOwnerProjects.length > 0 &&
    (newRole === "editor" || newRole === "none") &&
    projectIds.length > 0 &&
    projectIds.every((pid) => callerOwnerProjects.includes(pid));
  if (!callerAdmin && !ownerScoped) return { status: 403, body: { error: "forbidden" } };
  if (!auth) return { status: 503, body: { error: "auth_unavailable" } };

  const email = clean(body?.email, 120).toLowerCase();
  if (!email) return { status: 400, body: { error: "invalid_request", field: "email" } };
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    return { status: 404, body: { error: "user_not_found", email } };
  }

  const targetSnap = await db.collection(MIND_MEMBER_COLLECTION).doc(user.uid).get();
  const prev = targetSnap.exists ? targetSnap.data() : null;
  let admin = prev?.admin === true;
  let projects = { ...(prev?.projects ?? {}) };

  if (callerAdmin) {
    // FULL assignment — what the form says is the member's whole standing.
    admin = newRole === "admin";
    projects =
      newRole === "owner" || newRole === "editor"
        ? Object.fromEntries(projectIds.map((pid) => [pid, newRole]))
        : {};
  } else {
    // Owner-scoped: editors of MY projects only; merge, never global.
    if (admin) return { status: 403, body: { error: "forbidden" } }; // never touch an admin
    for (const pid of projectIds) {
      if (projects[pid] === "owner") return { status: 403, body: { error: "forbidden" } }; // never demote an owner
      if (newRole === "editor") projects[pid] = "editor";
      else delete projects[pid];
    }
  }

  await db.collection(MIND_MEMBER_COLLECTION).doc(user.uid).set({
    schemaVersion: 1,
    email: user.email ?? email,
    admin,
    projects,
    updatedAt: now,
    updatedBy: decoded.uid,
  });
  return { status: 200, body: { ok: true, uid: user.uid, email: user.email ?? email, admin, projects } };
}

// --- Public plane -------------------------------------------------------------

/** op entry — the PUBLIC receiver read: published entries only, media served
 *  as short-lived presigned URLs. Only creator-supplied content is returned —
 *  the receiver never renders a section the creator didn't fill. */
async function readEntry({ db, body, store }) {
  let entryId = clean(body?.entryId, 64);
  let rec = null;
  if (!entryId) {
    // Project-addressed read (public): resolve a LIVING project's published
    // singleton — the landing reaches 走近静心学堂 without hardcoding ids,
    // and always lands on the SAME permanent entry/URL/QR. Only living
    // projects are addressable this way (event entries are never enumerated).
    const projectId = clean(body?.projectId, 40);
    if (!MIND_LIVING_PROJECTS.includes(projectId)) return { status: 404, body: { error: "not_found" } };
    const snap = await db.collection(MIND_ENTRY_COLLECTION).where("projectId", "==", projectId).get();
    const hit = (snap.docs ?? [])
      .map((d) => ({ id: d.id, data: d.data() }))
      .find((x) => x.data.status === "published");
    if (!hit) return { status: 404, body: { error: "not_found" } };
    entryId = hit.id;
    rec = hit.data;
  } else {
    const snap = await db.collection(MIND_ENTRY_COLLECTION).doc(entryId).get();
    if (!snap.exists) return { status: 404, body: { error: "not_found" } };
    rec = snap.data();
  }
  // Draft = invisible. Archived keeps resolving (a printed QR never 404s)
  // with an honest ended flag; only truly published content ever leaves.
  if (rec.status !== "published" && rec.status !== "archived") {
    return { status: 404, body: { error: "not_found" } };
  }

  const presign = async (assetId) => {
    if (!store) return null;
    try {
      return await store.presignSealedGet({ tokenHash: mindNs(entryId), assetId });
    } catch {
      return null;
    }
  };
  const photos = [];
  for (const p of rec.photos ?? []) {
    const url = await presign(p.assetId);
    if (url) photos.push({ url });
  }
  const voiceUrl = rec.voice?.assetId ? await presign(rec.voice.assetId) : null;

  // 学堂 locations — resolved to PUBLIC destination facts (name/address/
  // coords/provider URLs). Retired or unknown ids drop silently: the page
  // never renders a dead navigation action.
  const knownLocations = (rec.locationIds ?? []).length > 0 ? await locationsAll(db) : null;
  const locations = (rec.locationIds ?? [])
    .map((id) => knownLocations?.get(id))
    .filter((l) => l && l.status === "active")
    .map(publicLocation);

  const entryProject = (await projectsAll(db)).get(rec.projectId);
  return {
    status: 200,
    body: {
      entryId,
      projectId: rec.projectId,
      ...(entryProject ? { projectName: entryProject.nameZh, projectNameEn: entryProject.nameEn ?? null, projectEmoji: entryProject.emoji ?? "🌿" } : {}),
      lifecycle: rec.lifecycle ?? "event",
      ...(rec.status === "archived" ? { archived: true } : {}),
      title: rec.title,
      intro: rec.intro,
      ...(rec.bodyText ? { bodyText: rec.bodyText } : {}),
      photos,
      voice: voiceUrl ? { url: voiceUrl, ...(rec.voice.durationMs ? { durationMs: rec.voice.durationMs } : {}) } : null,
      musicThemeId: rec.musicThemeId ?? null,
      responseConfig: rec.responseConfig ?? { enabled: true, allowMessage: true },
      eventDetails: rec.eventDetails ?? null,
      locations,
      updatedAt: rec.updatedAt ?? null,
    },
  };
}

/**
 * op landing — the PUBLIC /mind page's ONE lightweight read (no login):
 *   · living — the standing 走近静心学堂 entry (id + title + academy theme
 *     colour), enough for the permanent-QR block without the full payload;
 *   · activities — 近期活动 DERIVED from published entries (Founder §9: the
 *     landing never needs hand-curating). Eligibility: event lifecycle,
 *     published (never archived/draft), showOnMindLanding opted in, and a
 *     dated event drops off after its date passes (grace absorbs timezones).
 * Card data is the minimum for discovery (§15): id/title/intro/one cover
 * thumbnail/date/venue name/theme — never responses, voice, music or drafts.
 * QR codes deliberately absent: discovery here, sharing on the entry itself.
 * TODO(往期活动): past activities remain reachable by their permanent URLs;
 * a Past Activities surface is a future task, not this one.
 */
async function readLanding({ db, store, now }) {
  const snap = await db.collection(MIND_ENTRY_COLLECTION).get();
  const all = (snap.docs ?? []).map((d) => ({ id: d.id, rec: d.data() }));

  let living = null;
  const livingHit = all.find(
    (x) => MIND_LIVING_PROJECTS.includes(x.rec.projectId) && x.rec.status === "published",
  );

  const cutoff = new Date(now - MIND_LANDING_GRACE_MS).toISOString().slice(0, 10);
  const eligible = all.filter(({ rec }) =>
    (rec.lifecycle ?? "event") === "event" &&
    rec.status === "published" &&
    rec.showOnMindLanding === true &&
    (!rec.eventDetails?.date || rec.eventDetails.date >= cutoff),
  );

  const locations = await locationsAll(db);
  const registry = await projectsAll(db);
  const projMeta = (rec) => {
    const proj = registry.get(rec.projectId);
    return proj ? { projectName: proj.nameZh, projectNameEn: proj.nameEn ?? null, projectEmoji: proj.emoji ?? "🌿" } : {};
  };
  const locName = (rec) => {
    const loc = (rec.locationIds ?? []).map((id) => locations.get(id)).find((l) => l && l.status === "active");
    return loc ? { locationName: loc.nameZh, locationNameEn: loc.nameEn ?? null } : {};
  };
  const themeOf = (rec) => {
    const loc = (rec.locationIds ?? []).map((id) => locations.get(id)).find((l) => l && l.status === "active" && l.themeColor);
    return loc?.themeColor ?? null;
  };
  const cover = async (id, rec) => {
    const assetId = rec.photos?.[0]?.assetId;
    if (!assetId || !store) return null;
    try {
      return await store.presignSealedGet({ tokenHash: mindNs(id), assetId });
    } catch {
      return null;
    }
  };

  if (livingHit) {
    living = {
      entryId: livingHit.id,
      title: livingHit.rec.title,
      themeColor: themeOf(livingHit.rec),
    };
  }

  const activities = [];
  for (const { id, rec } of eligible
    .sort((a, b) => {
      // Soonest dated activity first; undated ones follow, freshest first.
      const da = a.rec.eventDetails?.date ?? "9999-99-99";
      const db_ = b.rec.eventDetails?.date ?? "9999-99-99";
      if (da !== db_) return da < db_ ? -1 : 1;
      return (b.rec.updatedAt ?? 0) - (a.rec.updatedAt ?? 0);
    })
    .slice(0, 20)) {
    activities.push({
      entryId: id,
      projectId: rec.projectId,
      ...projMeta(rec),
      title: rec.title,
      intro: clean(rec.intro, 120),
      coverUrl: await cover(id, rec),
      ...(rec.eventDetails?.date ? { date: rec.eventDetails.date } : {}),
      ...(rec.eventDetails?.timeStart ? { timeStart: rec.eventDetails.timeStart } : {}),
      ...locName(rec),
      themeColor: themeOf(rec),
    });
  }

  return { status: 200, body: { living, activities } };
}

/** op respond — anonymous, published entries with responses enabled only. */
async function submitMindResponse({ db, decoded, body, now, sourceIp }) {
  const entryId = clean(body?.entryId, 64);
  const entrySnap = await db.collection(MIND_ENTRY_COLLECTION).doc(entryId).get();
  if (!entrySnap.exists) return { status: 404, body: { error: "not_found" } };
  const entry = entrySnap.data();
  if (entry.status === "archived") return { status: 409, body: { error: "ended" } };
  if (entry.status !== "published") return { status: 404, body: { error: "not_found" } };
  if (entry.responseConfig?.enabled === false) {
    return { status: 409, body: { error: "responses_disabled" } };
  }
  const responseType = clean(body?.responseType, 40);
  if (!MIND_RESPONSE_TYPES.includes(responseType)) {
    return { status: 400, body: { error: "invalid_request", field: "responseType" } };
  }
  // A message on a message-disabled entry is silently dropped, never an error.
  const message =
    entry.responseConfig?.allowMessage === false ? null : clean(body?.message, MIND_LIMITS.message) || null;

  // Voluntary contact details — all optional, trimmed, length-capped. These
  // are whatever the visitor typed, NOT verified identity and NEVER used for
  // authentication; they exist so 学堂 staff can actually reach a person who
  // chose to be reachable. Only the email gets a format check when supplied.
  const displayName = clean(body?.displayName, MIND_LIMITS.displayName) || null;
  const phone = clean(body?.phone, MIND_LIMITS.phone) || null;
  const email = clean(body?.email, MIND_LIMITS.email) || null;
  if (email && !CONTACT_EMAIL_RE.test(email)) {
    return { status: 400, body: { error: "invalid_request", field: "email" } };
  }

  if (sourceIp) {
    const throttleRef = db.collection(MIND_THROTTLE_COLLECTION).doc(sha256Hex(sourceIp));
    const prev = await throttleRef.get();
    if (prev.exists && now - (prev.data().lastAt ?? 0) < RESPOND_COOLDOWN_MS) {
      return { status: 429, body: { error: "slow_down" } };
    }
    await throttleRef.set({ lastAt: now });
  }

  await db.collection(MIND_RESPONSE_COLLECTION).doc(crypto.randomUUID()).set({
    schemaVersion: 1,
    entryId,
    projectId: entry.projectId,
    responseType,
    message,
    displayName,
    phone,
    email,
    uid: decoded?.uid ?? null, // best-effort reference; anonymous is first-class
    createdAt: now,
  });
  return { status: 200, body: { ok: true } };
}

// --- 学堂 location directory ---------------------------------------------------

/** The whole directory: seeds ∪ stored (stored wins on the same id). */
async function locationsAll(db) {
  const map = new Map(MIND_SEED_LOCATIONS.map((l) => [l.locationId, l]));
  const snap = await db.collection(MIND_LOCATION_COLLECTION).get();
  for (const d of snap.docs ?? []) map.set(d.id, { ...d.data(), locationId: d.id });
  return map;
}

/** Public destination shape — what a visitor needs to navigate, nothing else. */
function publicLocation(l) {
  return {
    locationId: l.locationId,
    nameZh: l.nameZh,
    nameEn: l.nameEn ?? null,
    address: l.address,
    latitude: l.latitude ?? null,
    longitude: l.longitude ?? null,
    googleMapsUrl: l.googleMapsUrl ?? null,
    appleMapsUrl: l.appleMapsUrl ?? null,
    themeColor: l.themeColor ?? null,
  };
}

/** op locations — the editor's selector list (any member role). */
async function listLocations({ db, decoded }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const memberSnap = await db.collection(MIND_MEMBER_COLLECTION).doc(decoded.uid).get();
  const isMember = (await isMindAdmin(db, decoded)) || (memberSnap.exists && Object.keys(memberSnap.data()?.projects ?? {}).length > 0);
  if (!isMember) return { status: 403, body: { error: "forbidden" } };
  const all = [...(await locationsAll(db)).values()].filter((l) => l.status === "active");
  return { status: 200, body: { locations: all.map(publicLocation) } };
}

/** op location_set — authorized roles only (Founder: never every public
 *  user): Mind Admin, or any project OWNER — the responsible people keep
 *  names/addresses current themselves; a change here propagates instantly to
 *  EVERY entry (and printed QR) referencing the centre. Editors cannot. */
async function locationSet({ db, decoded, body, now }) {
  let allowed = await isMindAdmin(db, decoded);
  if (!allowed && decoded?.uid) {
    const memberSnap = await db.collection(MIND_MEMBER_COLLECTION).doc(decoded.uid).get();
    const projects = memberSnap.exists ? (memberSnap.data()?.projects ?? {}) : {};
    allowed = Object.values(projects).includes("owner");
  }
  if (!allowed) return { status: 403, body: { error: "forbidden" } };
  const nameZh = clean(body?.nameZh, 80);
  const address = clean(body?.address, 200);
  if (!nameZh || !address) {
    return { status: 400, body: { error: "invalid_request", field: !nameZh ? "nameZh" : "address" } };
  }
  const locationId = clean(body?.locationId, 64) || crypto.randomUUID();
  const lat = body?.latitude === undefined || body?.latitude === null ? null : Number(body.latitude);
  const lng = body?.longitude === undefined || body?.longitude === null ? null : Number(body.longitude);
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180))) {
    return { status: 400, body: { error: "invalid_request", field: "coordinates" } };
  }
  // Partial-update semantics for OPTIONAL fields: an omitted field keeps its
  // current value (seed included) — an owner fixing an address can never
  // silently wipe coordinates or the academy theme colour.
  const prev = (await locationsAll(db)).get(locationId) ?? null;
  const themeColorRaw = body?.themeColor;
  if (themeColorRaw !== undefined && themeColorRaw !== null && !/^#[0-9a-fA-F]{6}$/.test(String(themeColorRaw))) {
    return { status: 400, body: { error: "invalid_request", field: "themeColor" } };
  }
  const keep = (field, incoming) => (incoming !== undefined ? incoming : (prev?.[field] ?? null));
  const rec = {
    schemaVersion: 1,
    nameZh,
    nameEn: keep("nameEn", body?.nameEn !== undefined ? clean(body.nameEn, 120) || null : undefined),
    address,
    latitude: keep("latitude", body?.latitude !== undefined ? lat : undefined),
    longitude: keep("longitude", body?.longitude !== undefined ? lng : undefined),
    googleMapsUrl: keep("googleMapsUrl", body?.googleMapsUrl !== undefined ? clean(body.googleMapsUrl, 300) || null : undefined),
    appleMapsUrl: keep("appleMapsUrl", body?.appleMapsUrl !== undefined ? clean(body.appleMapsUrl, 300) || null : undefined),
    country: keep("country", body?.country !== undefined ? clean(body.country, 60) || null : undefined),
    city: keep("city", body?.city !== undefined ? clean(body.city, 60) || null : undefined),
    themeColor: keep("themeColor", themeColorRaw !== undefined ? themeColorRaw : undefined),
    status: body?.status === "inactive" ? "inactive" : (prev?.status ?? "active"),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: decoded.uid,
  };
  await db.collection(MIND_LOCATION_COLLECTION).doc(locationId).set(rec);
  return { status: 200, body: { ok: true, location: publicLocation({ ...rec, locationId }) } };
}

/** op project_set — Mind Admin adds (or renames) an ACTIVITY project, e.g. a
 *  future 静心抄经. The new project immediately rides every existing rail:
 *  member assignment, editor, publish, permanent QR, responses, statistics
 *  and 近期活动 — zero further code. Seed projects are fixed identity (not
 *  editable here); dynamic ones are always event lifecycle. */
async function projectSet({ db, decoded, body, now }) {
  if (!(await isMindAdmin(db, decoded))) return { status: 403, body: { error: "forbidden" } };
  const nameZh = clean(body?.nameZh, 40);
  if (!nameZh) return { status: 400, body: { error: "invalid_request", field: "nameZh" } };
  let projectId = clean(body?.projectId, 64);
  if (projectId && MIND_PROJECTS.includes(projectId)) {
    return { status: 400, body: { error: "seed_project_fixed" } };
  }
  if (!projectId) projectId = crypto.randomUUID();
  const prevSnap = await db.collection(MIND_PROJECT_COLLECTION).doc(projectId).get();
  const prev = prevSnap.exists ? prevSnap.data() : null;
  const rec = {
    schemaVersion: 1,
    nameZh,
    nameEn: clean(body?.nameEn, 80) || prev?.nameEn || null,
    emoji: clean(body?.emoji, 8) || prev?.emoji || "🌿",
    lifecycle: "event",
    status: "active",
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    updatedBy: decoded.uid,
  };
  await db.collection(MIND_PROJECT_COLLECTION).doc(projectId).set(rec);
  return { status: 200, body: { ok: true, project: projectPublic({ ...rec, id: projectId }) } };
}

// --- Admin plane --------------------------------------------------------------

/** op manage — Mind Admin's global view: every entry with statistics, plus
 *  the membership roster. Scan counting stays a marked TODO (responses first). */
async function mindManage({ db, decoded }) {
  if (!(await isMindAdmin(db, decoded))) return { status: 403, body: { error: "forbidden" } };
  const [entriesSnap, membersSnap, aggregates, registry] = await Promise.all([
    db.collection(MIND_ENTRY_COLLECTION).get(),
    db.collection(MIND_MEMBER_COLLECTION).get(),
    responseAggregates(db, Date.now()),
    projectsAll(db),
  ]);
  const entries = (entriesSnap.docs ?? [])
    .map((d) => ({ id: d.id, rec: d.data() }))
    .sort((a, b) => (b.rec.updatedAt ?? 0) - (a.rec.updatedAt ?? 0))
    .map(({ id, rec }) => ({
      ...ownerShape(id, rec),
      stats: aggregates.get(id) ?? emptyAggregate(),
      // TODO(scan-count): needs a public page-load beacon — deferred (Founder §8).
      scanCount: null,
    }));
  const members = (membersSnap.docs ?? []).map((d) => ({
    uid: d.id,
    email: d.data().email ?? null,
    admin: d.data().admin === true,
    projects: d.data().projects ?? {},
  }));
  const projects = [...registry.values()].filter((p) => p.status === "active").map(projectPublic);
  return { status: 200, body: { entries, members, projects } };
}

// --- Shared shapes ------------------------------------------------------------

const emptyAggregate = () => ({
  total: 0,
  byType: Object.fromEntries(MIND_RESPONSE_TYPES.map((t) => [t, 0])),
  recent: {
    windowDays: MIND_RECENT_WINDOW_DAYS,
    total: 0,
    byType: Object.fromEntries(MIND_RESPONSE_TYPES.map((t) => [t, 0])),
  },
  messages: [],
});

/** Lifetime AND recent-period engagement from the never-deleted, always-
 *  timestamped response history (Founder: a Living Entry's whole life plus
 *  what happened lately must both be visible). */
async function responseAggregates(db, now = Date.now()) {
  const snap = await db.collection(MIND_RESPONSE_COLLECTION).get();
  const recentSince = now - MIND_RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const byEntry = new Map();
  for (const d of snap.docs ?? []) {
    const r = d.data();
    if (!byEntry.has(r.entryId)) byEntry.set(r.entryId, emptyAggregate());
    const agg = byEntry.get(r.entryId);
    agg.total += 1;
    if (agg.byType[r.responseType] !== undefined) agg.byType[r.responseType] += 1;
    if ((r.createdAt ?? 0) >= recentSince) {
      agg.recent.total += 1;
      if (agg.recent.byType[r.responseType] !== undefined) agg.recent.byType[r.responseType] += 1;
    }
    // The staff-visible list: any response that carries a message OR contact
    // details (a person who left only a phone number must not be invisible —
    // Founder: staff should see who can actually be reached, not just counts).
    if (r.message || r.displayName || r.phone || r.email) {
      agg.messages.push({
        message: r.message ?? null,
        responseType: r.responseType,
        displayName: r.displayName ?? null,
        phone: r.phone ?? null,
        email: r.email ?? null,
        createdAt: r.createdAt ?? null,
      });
    }
  }
  for (const agg of byEntry.values()) {
    agg.messages.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    agg.messages = agg.messages.slice(0, MESSAGES_LIST_MAX);
  }
  return byEntry;
}

/** The creator-facing shape — includes status/draft content, never media URLs
 *  (the editor previews via the public read once published; staged media is
 *  addressed by assetId). */
function ownerShape(entryId, rec) {
  return {
    entryId,
    projectId: rec.projectId,
    lifecycle: rec.lifecycle ?? "event",
    status: rec.status,
    title: rec.title ?? "",
    intro: rec.intro ?? "",
    bodyText: rec.bodyText ?? "",
    photos: (rec.photos ?? []).map((p) => ({ assetId: p.assetId })),
    voice: rec.voice ? { assetId: rec.voice.assetId, ...(rec.voice.durationMs ? { durationMs: rec.voice.durationMs } : {}) } : null,
    musicThemeId: rec.musicThemeId ?? null,
    responseConfig: rec.responseConfig ?? { enabled: true, allowMessage: true },
    eventDetails: rec.eventDetails ?? null,
    locationIds: rec.locationIds ?? [],
    showOnMindLanding: rec.showOnMindLanding === true,
    createdAt: rec.createdAt ?? null,
    updatedAt: rec.updatedAt ?? null,
    publishedAt: rec.publishedAt ?? null,
    archivedAt: rec.archivedAt ?? null,
  };
}
