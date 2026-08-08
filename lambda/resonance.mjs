/**
 * Resonance Engine V2 (T-301 / backlog T-302) — server side.
 *
 * Consumes T-202 `soulProfile.emergentTraits[]` and produces:
 *   - an internal RI Profile (matching-eligible traits, weighted)
 *   - an internal resonance score (never returned to clients)
 *   - human-language reasons (the only user-facing output)
 *
 * Founder decisions enforced here:
 *   1. Traits are internal — ids/names/families/confidence never leave this module.
 *   2. Scores are internal — no number is ever placed in a reason or response.
 *   3. Explanation is the product — output is reasons[] only.
 *   4. Weights: candidate 0 · dormant 0 · emergent reduced · established full.
 *   5. Complementarity is first-class (shared OR reinforcing movement).
 *
 * This MUST NOT redesign taxonomy or trait inference — it only mirrors the
 * frozen matching-eligibility + family map from src/data/emergentTraits.ts
 * (Emergent Trait Taxonomy V1.1, FROZEN).
 */

// --- Frozen taxonomy mirror (matching-relevant fields only) ----------------
// Source of truth: src/data/emergentTraits.ts (T-201). Keep in sync.
export const TRAIT_META = {
  layered_inquiry:      { family: 'Thinking',      matchingEligible: true },
  structural_framing:   { family: 'Thinking',      matchingEligible: true },
  pattern_noticer:      { family: 'Thinking',      matchingEligible: true },
  dialectical_mind:     { family: 'Thinking',      matchingEligible: false },
  inquiry_led:          { family: 'Curiosity',     matchingEligible: true },
  thread_spreading:     { family: 'Curiosity',     matchingEligible: true },
  associative_drift:    { family: 'Curiosity',     matchingEligible: false },
  purpose_returning:    { family: 'Meaning',       matchingEligible: true },
  values_returning:     { family: 'Meaning',       matchingEligible: true },
  anchor_returning:     { family: 'Meaning',       matchingEligible: false },
  change_framing:       { family: 'Growth',        matchingEligible: true },
  narrative_revision:   { family: 'Growth',        matchingEligible: false },
  strain_continuity:    { family: 'Growth',        matchingEligible: false },
  reciprocity_emphasis: { family: 'Relationships', matchingEligible: true },
  long_horizon:         { family: 'Relationships', matchingEligible: true },
  trust_careful:        { family: 'Relationships', matchingEligible: false },
  boundary_protective:  { family: 'Relationships', matchingEligible: true },
  structure_assembly:   { family: 'Creation',      matchingEligible: true },
  expressive_channel:   { family: 'Creation',      matchingEligible: true },
  idea_combiner:        { family: 'Creation',      matchingEligible: true },
  doing_restoration:    { family: 'Action',        matchingEligible: false },
  closure_movement:     { family: 'Action',        matchingEligible: false },
  context_tracking:     { family: 'Adaptability',  matchingEligible: true },
  unresolved_tolerance: { family: 'Adaptability',  matchingEligible: false },
};

// Eligible complement pairs — both sides must be matching-eligible.
// (layered_inquiry × closure_movement is intentionally excluded: closure_movement
// is profile-only.)
export const COMPLEMENT_PAIRS = [
  ['thread_spreading', 'long_horizon'],
  ['boundary_protective', 'reciprocity_emphasis'],
];

export const ALIGN_FAMILIES = new Set(['Meaning', 'Growth']);

// --- Tunable calibration constants (internal; never exposed) ----------------
const STATUS_WEIGHT = { established: 1.0, emergent: 0.5, candidate: 0, dormant: 0 };
const TRAJECTORY_BOOST = { rising: 1.1, stable: 1.0 };

const W_SHARED = 0.45;
const W_COMPLEMENT = 0.30;
const W_ALIGN = 0.25;

const READINESS_FLOOR = 0.35;
const MIN_INSIGHTS = 2;
const MIN_MATCHING_TRAITS = 2;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Build the internal RI Profile from a user's emergentTraits[].
 * Returns matching-eligible traits with nonzero weight + per-family totals.
 */
export function assembleRIProfile(emergentTraits) {
  const traits = Array.isArray(emergentTraits) ? emergentTraits : [];
  const matchingTraits = [];
  const familyVector = {};

  for (const t of traits) {
    const meta = TRAIT_META[t?.traitId];
    if (!meta || !meta.matchingEligible) continue; // profile-only / unknown → skip

    const statusW = STATUS_WEIGHT[t.status] ?? 0;
    if (statusW === 0) continue; // candidate / dormant → zero weight (decision 4)

    const trajW = TRAJECTORY_BOOST[t.trajectory] ?? 1.0;
    const conf = clamp(typeof t.confidence === 'number' ? t.confidence : 0, 0, 1);
    const weight = clamp(statusW * conf * trajW, 0, 1);
    if (weight <= 0) continue;

    matchingTraits.push({
      traitId: t.traitId,
      family: meta.family,
      weight,
      lastReinforcedAt: t.lastReinforcedAt || 0,
    });
    familyVector[meta.family] = (familyVector[meta.family] || 0) + weight;
  }

  matchingTraits.sort((a, b) => b.weight - a.weight);

  const top3 = matchingTraits.slice(0, 3).map((t) => t.weight);
  const meanTop = top3.length ? top3.reduce((s, w) => s + w, 0) / top3.length : 0;
  const profileConfidence = clamp(
    0.5 * Math.min(matchingTraits.length / 3, 1) + 0.5 * meanTop,
    0,
    1,
  );

  return { matchingTraits, familyVector, profileConfidence };
}

/** Readiness gate — internal. */
export function isEligibleToMatch(ri, insightCount) {
  return (
    (insightCount || 0) >= MIN_INSIGHTS &&
    ri.matchingTraits.length >= MIN_MATCHING_TRAITS &&
    ri.profileConfidence >= READINESS_FLOOR
  );
}

function weightOf(ri, traitId) {
  const t = ri.matchingTraits.find((x) => x.traitId === traitId);
  return t ? t.weight : 0;
}

/**
 * Compute trait-level resonance between two RI Profiles.
 * Returns internal scores + the detail needed to build reasons.
 */
export function computeResonance(riA, riB) {
  const aIds = new Set(riA.matchingTraits.map((t) => t.traitId));

  // Shared — common matching traits.
  const sharedHits = [];
  let shared = 0;
  for (const t of riB.matchingTraits) {
    if (aIds.has(t.traitId)) {
      const m = Math.min(weightOf(riA, t.traitId), t.weight);
      shared += m;
      sharedHits.push({ traitId: t.traitId, family: t.family, contribution: m });
    }
  }

  // Complement — different-but-reinforcing eligible pairs.
  const complementHits = [];
  let complement = 0;
  for (const [p, q] of COMPLEMENT_PAIRS) {
    const c = weightOf(riA, p) * weightOf(riB, q) + weightOf(riA, q) * weightOf(riB, p);
    if (c > 0) {
      complement += c;
      complementHits.push({ pair: [p, q], contribution: c });
    }
  }

  // Align — shared movement in Meaning / Growth families.
  const alignHits = sharedHits.filter((h) => ALIGN_FAMILIES.has(h.family));
  const align = alignHits.reduce((s, h) => s + h.contribution, 0);

  const raw = W_SHARED * shared + W_COMPLEMENT * complement + W_ALIGN * align;
  const resonanceScore = raw / (1 + raw); // monotonic squash → [0,1), internal only

  return {
    resonanceScore,
    detail: { shared, complement, align, sharedHits, complementHits, alignHits },
  };
}

// ===========================================================================
// Moment channel (Behaviour / first-touch) — SECOND, INDEPENDENT evidence stream.
//
// Progressive understanding: Moments make a user matchable immediately; Reflect
// deepens matching as it accumulates. The two channels are scored separately in
// their own vocabularies (traits vs Movements) and combined additively at the
// ranking seam — there is NO trait↔movement bridge and the Reflect path above is
// untouched. Weighting is deliberately trivial for V1 (an internal detail that
// evolves with production data).
// ===========================================================================

/** Minimum meaningful Movements for the Moment channel to gate a user in. Internal. */
const MIN_MOMENT_MOVEMENTS = 2;

/** Normalize a denormalized momentProfile into the shape the Moment channel scores. */
export function assembleMomentProfile(momentProfile) {
  const raw = Array.isArray(momentProfile?.movements) ? momentProfile.movements : [];
  const movements = [];
  for (const m of raw) {
    if (!m || typeof m.movementId !== "string") continue;
    const weight = clamp(typeof m.weight === "number" ? m.weight : 0, 0, 1);
    if (weight <= 0) continue;
    movements.push({
      movementId: m.movementId,
      direction: clamp(typeof m.direction === "number" ? m.direction : 0, -1, 1),
      weight,
    });
  }
  return { movements };
}

/** Behaviour-channel readiness — Moments alone can qualify a user for matching. */
export function isMomentEligible(momentRI) {
  return (momentRI?.movements?.length || 0) >= MIN_MOMENT_MOVEMENTS;
}

/**
 * Resonance between two Moment profiles: shared Movements expressed in the SAME
 * direction (same side of the movement). Deliberately simple for V1 — no related-
 * movement complements yet.
 */
export function computeMomentResonance(mA, mB) {
  const byId = new Map((mB?.movements || []).map((m) => [m.movementId, m]));
  let raw = 0;
  const sharedHits = [];
  for (const a of mA?.movements || []) {
    const b = byId.get(a.movementId);
    if (!b) continue;
    // Same movement AND same side of it → genuine shared behaviour.
    if ((a.direction >= 0) !== (b.direction >= 0)) continue;
    const contribution = Math.min(a.weight, b.weight);
    if (contribution <= 0) continue;
    raw += contribution;
    sharedHits.push({ movementId: a.movementId, contribution });
  }
  const momentScore = raw / (1 + raw); // monotonic squash → [0,1), internal only
  return { momentScore, detail: { sharedHits } };
}

// --- Connection Origin (同频遇见) — internal channel classification -----------
// Explainability only: which understanding channel brought two people together.
// Pure read of the two scores already computed; NEVER changes ranking/scoring.
const ORIGIN_EPS = 1e-9;
export function classifyOrigin(reflectScore, momentScore) {
  const r = (reflectScore || 0) > ORIGIN_EPS;
  const m = (momentScore || 0) > ORIGIN_EPS;
  if (r && m) return "both"; // 共同形成
  if (m) return "moment"; // 生活场景
  if (r) return "reflect"; // 理解方式
  return "none"; // no shared channel — UI falls back gracefully
}

// --- Reason copy (W5) — motion/tendency language, no ids/names/numbers -------
const SHARED_FAMILY_COPY = {
  Thinking: [
    { zh: '你们都倾向于一层层地展开思考', en: 'You both tend to move through things in layers' },
    { zh: '你们思考的方式有些像，喜欢往深处走', en: 'You both seem to follow a thought further than most' },
  ],
  Curiosity: [
    { zh: '你们都喜欢顺着好奇心往外探索', en: 'You both tend to follow curiosity outward' },
    { zh: '你们都容易被新的问题带着走', en: 'You both tend to get drawn along by new questions' },
  ],
  Meaning: [
    { zh: '你们都会一再回到“意义”这件事上', en: 'You both keep returning to what matters' },
    { zh: '你们都更在意事情背后的意义', en: 'You both seem to look for the meaning underneath things' },
  ],
  Growth: [
    { zh: '你们都用变化的眼光看待自己的经历', en: 'You both tend to see your lives in terms of change' },
    { zh: '你们都在经历某种转变，并愿意去看它', en: 'You both seem to be moving through change and willing to look at it' },
  ],
  Relationships: [
    { zh: '你们靠近他人的节奏有些相似', en: 'You seem to move toward closeness in a similar way' },
    { zh: '你们在关系里看重的东西很接近', en: 'You seem close in what you weigh in a relationship' },
  ],
  Creation: [
    { zh: '你们都习惯把想法慢慢搭建成形', en: 'You both tend to build ideas into something' },
    { zh: '你们都喜欢把零散的东西组合起来', en: 'You both tend to assemble scattered things into shape' },
  ],
  Adaptability: [
    { zh: '你们都会留意情境如何改变期待', en: 'You both tend to track how context shifts things' },
  ],
};

const COMPLEMENT_COPY = {
  'thread_spreading|long_horizon': [
    {
      zh: '你们一个偏向广度探索，一个偏向长期视角——刚好彼此呼应',
      en: 'One of you tends to explore widely while the other holds the long view — they reinforce each other',
    },
  ],
  'boundary_protective|reciprocity_emphasis': [
    {
      zh: '你们一个更在意界限与节奏，一个更在意相互回应——彼此映衬',
      en: 'One of you tends to protect pace and space while the other leans into mutual response — they balance each other',
    },
  ],
};

const ALIGN_FAMILY_COPY = {
  Meaning: [
    {
      zh: '你们都更在意意义，而不是确定性',
      en: 'You both seem to move through the world as people for whom meaning matters more than certainty',
    },
  ],
  Growth: [
    {
      zh: '你们都把人生看作一个不断变化的过程',
      en: 'You both tend to see life as something in motion',
    },
  ],
};

const NEUTRAL_FALLBACK = [
  { zh: '你们都在用心去靠近一段真实的连接', en: 'You both seem to be reaching toward something real' },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function complementKey(pair) {
  const key = `${pair[0]}|${pair[1]}`;
  if (COMPLEMENT_COPY[key]) return key;
  const rev = `${pair[1]}|${pair[0]}`;
  return COMPLEMENT_COPY[rev] ? rev : null;
}

/**
 * Build human-language reasons from a resonance result.
 * Returns [{ zh, en }] — never trait ids/names/families or any number.
 */
export function buildReasons(resonanceResult, maxReasons = 2) {
  const { detail } = resonanceResult;
  const candidates = [];

  // Channel 1: strongest shared family.
  const topShared = [...detail.sharedHits].sort((a, b) => b.contribution - a.contribution)[0];
  if (topShared) {
    candidates.push({
      score: W_SHARED * topShared.contribution,
      copy: pick(SHARED_FAMILY_COPY[topShared.family] || NEUTRAL_FALLBACK),
    });
  }

  // Channel 2: strongest complement pair.
  const topComplement = [...detail.complementHits].sort((a, b) => b.contribution - a.contribution)[0];
  if (topComplement) {
    const key = complementKey(topComplement.pair);
    if (key) {
      candidates.push({
        score: W_COMPLEMENT * topComplement.contribution,
        copy: pick(COMPLEMENT_COPY[key]),
      });
    }
  }

  // Channel 3: strongest align (Meaning/Growth).
  const topAlign = [...detail.alignHits].sort((a, b) => b.contribution - a.contribution)[0];
  if (topAlign) {
    candidates.push({
      score: W_ALIGN * topAlign.contribution,
      copy: pick(ALIGN_FAMILY_COPY[topAlign.family] || NEUTRAL_FALLBACK),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // Dedupe identical copy; cap; never return empty when a candidate is surfaced.
  const seen = new Set();
  const reasons = [];
  for (const c of candidates) {
    const sig = c.copy.en;
    if (seen.has(sig)) continue;
    seen.add(sig);
    reasons.push({ zh: c.copy.zh, en: c.copy.en });
    if (reasons.length >= maxReasons) break;
  }

  if (reasons.length === 0) {
    const f = pick(NEUTRAL_FALLBACK);
    reasons.push({ zh: f.zh, en: f.en });
  }

  return reasons;
}
