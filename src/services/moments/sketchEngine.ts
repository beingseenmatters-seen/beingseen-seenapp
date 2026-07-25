/**
 * Sketch engine — a faithful TypeScript port of the approved Summary Engine V1
 * pipeline from the Previewer (Prototype/app.js, PR/SUMMARY_ENGINE, frozen):
 *
 *   Snapshot → Dimension Resolver → Deterministic Block Selector →
 *   Approved Variant Selection → Approved Connective Assembly →
 *   Assembly Audit → User Sketch.
 *
 * No free-form generation exists: output text is always an exact concatenation
 * of approved variant texts and approved connectives. Fully deterministic —
 * the same answers always produce the same sketch. Runs entirely client-side;
 * no AI or backend calls.
 *
 * It consumes session snapshots (not the live library) so a completed session
 * can always be regenerated/audited even after Moment content changes.
 */

import type {
  MomentAnswer,
  MomentSnapshot,
  SummaryBlock,
  SummaryCondition,
  SummaryEngineConfig,
  SummaryVariant,
} from '../../types/moments';
import { SUMMARY_ENGINE_CONFIG } from '../../data/moments/summaryConfig';

/** Approved evidence weight factors (Prototype/app.js, unchanged). */
const WEIGHT_FACTOR: Record<string, number> = {
  'very light': 0.08,
  light: 0.15,
  moderate: 0.25,
};

/**
 * Accumulate signal values from answered snapshots.
 * Each selected option applies `delta * weightFactor * 2` on a 0.5 baseline,
 * clamped to [0.02, 0.98] — identical to the approved Previewer accumulation.
 * Ranking answers contribute every ranked option (rank recorded, not weighted),
 * matching the Previewer's evidence model.
 */
export function accumulateSignals(
  snapshots: MomentSnapshot[],
  answers: Record<string, MomentAnswer>,
): Record<string, number> {
  const acc: Record<string, number> = {};
  snapshots.forEach((snap) => {
    const answer = answers[snap.momentId];
    if (!answer) return;
    answer.selectedOptionIds.forEach((optId) => {
      const option = snap.options.find((o) => o.id === optId);
      if (!option) return;
      const wf = WEIGHT_FACTOR[(option.weight || 'Light').toLowerCase()] ?? 0.15;
      option.signals.forEach((sg) => {
        if (acc[sg.signal] === undefined) acc[sg.signal] = 0.5;
        acc[sg.signal] += sg.delta * wf * 2;
      });
    });
  });
  Object.keys(acc).forEach((k) => {
    acc[k] = Math.max(0.02, Math.min(0.98, acc[k]));
  });
  return acc;
}

function condHolds(c: SummaryCondition, snap: Record<string, number>): boolean {
  const v = snap[c.signal] !== undefined ? snap[c.signal] : 0.5;
  if (c.op === '>=') return v >= c.value;
  if (c.op === '<=') return v <= c.value;
  if (c.op === '>') return v > c.value;
  if (c.op === '<') return v < c.value;
  return false;
}

interface DimensionResolution {
  code: string;
  dominance: number;
}

/** Stage 1 — Dimension Resolver. */
function resolveDimensions(
  snap: Record<string, number>,
  config: SummaryEngineConfig,
): DimensionResolution[] {
  return config.dimensions.map((d) => {
    let dominance = 0;
    d.signals.forEach((id) => {
      if (snap[id] !== undefined) dominance += Math.abs(snap[id] - 0.5);
    });
    return { code: d.code, dominance: +dominance.toFixed(4) };
  });
}

/** Stage 2 — Deterministic Block Selector (specificity → evidence strength → block id). */
function selectBlock(
  dimCode: string,
  snap: Record<string, number>,
  config: SummaryEngineConfig,
): SummaryBlock | undefined {
  const blocks = config.blocks.filter((b) => b.dim === dimCode && !b.fallback);
  const eligible = blocks.filter(
    (b) => (b.conditions || []).length > 0 && b.conditions.every((c) => condHolds(c, snap)),
  );
  if (!eligible.length) return config.blocks.find((b) => b.dim === dimCode && b.fallback);
  const strength = (bb: SummaryBlock) =>
    bb.conditions.reduce(
      (s, c) => s + Math.abs((snap[c.signal] !== undefined ? snap[c.signal] : 0.5) - 0.5),
      0,
    );
  eligible.sort((a, b) => {
    const spec = b.conditions.length - a.conditions.length;
    if (spec) return spec;
    const st = strength(b) - strength(a);
    if (Math.abs(st) > 1e-9) return st > 0 ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
  return eligible[0];
}

/** Stage 3 — Approved Variant Selection (rhythm alternation; deterministic). */
function chooseVariants(orderedBlocks: SummaryBlock[]): SummaryVariant[] {
  let lastRhythm: string | null = null;
  return orderedBlocks.map((b) => {
    const want = lastRhythm === 'long' ? 'short' : 'long';
    const v = b.variants.find((x) => x.rhythm === want) || b.variants[0];
    lastRhythm = v.rhythm;
    return v;
  });
}

/** Stage 4 — Approved Connective Assembly. */
function assemble(
  orderedBlocks: SummaryBlock[],
  variants: SummaryVariant[],
  config: SummaryEngineConfig,
): { text: string; connectivesUsed: string[] } {
  const conn = config.connectives || [];
  const parts = variants.map((v, i) => {
    const c = orderedBlocks[i].fallback ? '' : conn[i] || '';
    return (i === 0 ? '' : c) + v.text;
  });
  return {
    text: parts.join(''),
    connectivesUsed: variants.map((_v, i) =>
      i === 0 || orderedBlocks[i].fallback ? '' : conn[i] || '',
    ),
  };
}

/** Stage 5 — Assembly Audit: output must be exactly variants ⊕ approved connectives. */
function auditAssembly(text: string, variants: SummaryVariant[], connectivesUsed: string[]): boolean {
  let rest = text;
  for (let i = 0; i < variants.length; i++) {
    const expect = (i === 0 ? '' : connectivesUsed[i]) + variants[i].text;
    if (!rest.startsWith(expect)) return false;
    rest = rest.slice(expect.length);
  }
  return rest.length === 0;
}

export interface SketchResult {
  text: string;
  audit: 'PASSED' | 'PASSED (fallback concatenation)' | 'FAILED';
  engineVersion: string;
}

/** Full approved pipeline: answered snapshots in, deterministic sketch text out. */
export function generateSketch(
  snapshots: MomentSnapshot[],
  answers: Record<string, MomentAnswer>,
  config: SummaryEngineConfig = SUMMARY_ENGINE_CONFIG,
): SketchResult {
  const snap = accumulateSignals(snapshots, answers);
  const dims = resolveDimensions(snap, config);
  const selections = dims
    .map((d) => ({ dim: d, block: selectBlock(d.code, snap, config) }))
    .filter((s): s is { dim: DimensionResolution; block: SummaryBlock } => !!s.block);

  // Dominance ordering: strongest first; fallbacks always last.
  const ordered = selections.slice().sort((a, b) => {
    if (!!a.block.fallback !== !!b.block.fallback) return a.block.fallback ? 1 : -1;
    return b.dim.dominance - a.dim.dominance;
  });

  const orderedBlocks = ordered.map((s) => s.block);
  const variants = chooseVariants(orderedBlocks);
  let { text, connectivesUsed } = assemble(orderedBlocks, variants, config);

  let audit: SketchResult['audit'];
  if (auditAssembly(text, variants, connectivesUsed)) {
    audit = 'PASSED';
  } else {
    // Reject and fall back to pure approved-variant concatenation.
    text = variants.map((v) => v.text).join('');
    connectivesUsed = variants.map(() => '');
    audit = auditAssembly(text, variants, connectivesUsed)
      ? 'PASSED (fallback concatenation)'
      : 'FAILED';
  }

  return { text, audit, engineVersion: config.engineVersion };
}
