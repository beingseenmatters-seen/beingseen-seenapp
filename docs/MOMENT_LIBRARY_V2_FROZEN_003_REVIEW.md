# Moment Library v2 — Founder Frozen Set 003 Review

**Workflow:** Library content ships as Library Versions without app rebuild —
see [`../RELEASE.md`](../RELEASE.md).

**Branch (historical):** `feat/moment-library-v2-frozen-003`  
**Original review status:** Prepared for Founder review / CDN promotion process.  
**Date:** 2026-08-06

## What shipped in this pack

| Field | Value |
|-------|--------|
| libraryVersion | **2** |
| Active Moments | **23** (v1 twenty-one + FRI-002 + PAR-001) |
| Seed (bundled) | Still **v1 / 21 Moments** (untouched — no app rebuild) |
| New IDs | `FRI-002`, `PAR-001` (immutable) |
| Regions | `moment-library/v2/global/` and `moment-library/v2/cn/` |

## Option → signal mappings

### FRI-002 (single_choice)

| Opt | Signal map |
|-----|------------|
| A | EXP-01 +0.45 med, CAR-01 +0.25 low |
| B | REL-09 +0.40 med, EXP-03 +0.30 med |
| C | TRU-01 +0.40 med, EXP-02 +0.30 low |
| D | CHG-07 +0.35 med, EXP-02 +0.25 low |
| E | TRU-05 +0.40 med, EXP-03 +0.30 med |

### PAR-001 (ranking, maxRank 6)

| Opt | Signal map |
|-----|------------|
| A | TRU-04 +0.45 med, CAR-04 +0.30 low |
| B | MEA-09 +0.40 med, EXP-01 +0.35 med |
| C | MEA-10 +0.45 med, MEA-12 +0.25 low |
| D | REL-07 +0.40 med, CAR-01 +0.30 low |
| E | CAR-03 +0.40 med, CHG-08 +0.30 low |
| F | EMW-02 +0.45 med, CHG-02 +0.35 med |

All signals exist in `SIGNAL_INDEX` and are mapped in `signalMovementMap`. No new signals. No Movement Library edits.

## Engine note (ranking)

Current Sketch / evidence pipeline weights ranked options equally (order stored, not weighted). With `maxRank: 6` (full sort of all options), PAR-001 contributes its full signal set whenever it appears in a session. Differentiation across the five sims is driven mainly by FRI-002; PAR-001 enriches the Behaviour signal pool for parenting themes.

## Five-user simulation (vitest)

All five produced `audit: PASSED` Sketch V2 strings. See `founderFrozenSet003.test.ts` console output.

## How installed apps receive v2 (no rebuild)

Requires an installed build that already includes Moment Platform V1 (`MomentLibraryClient`).

1. Host `moment-library/v2/global/` at `VITE_MOMENT_LIBRARY_GLOBAL_BASE` (and CN domestic host for CN).
2. App cold start / foreground → `syncRemote()` → atomic validate → promote if `libraryVersion` > active.
3. New Moments sessions draw from the 23-Moment pool.
4. Offline: last validated cache (or seed v1 if never synced).

### Local verification (pre-production)

```bash
# Serve GLOBAL pack locally (example)
npx --yes serve moment-library/v2/global -p 8787

# Point a Platform-enabled build at:
# VITE_MOMENT_LIBRARY_GLOBAL_BASE=http://<lan-ip>:8787
# Then cold-start Web / Android / iOS and confirm:
# - libraryVersion becomes 2 (devtools / log)
# - FRI-002 / PAR-001 can appear in a new Moments session
# - offline relaunch keeps v2 cache
```

**Do not upload to production CDN until Founder approves this review.**

## Commands

```bash
npm run moments:build-v2-frozen-003
npx vitest run src/services/moments/founderFrozenSet003.test.ts
npx vite-node scripts/validateLibraryV2Frozen003.ts
```

## Out of scope

- UI / HUE / Sketch Engine / Reflect / Matching changes
- Seed regeneration / app store rebuild
- Production CDN publish
