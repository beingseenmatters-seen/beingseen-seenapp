# Moment Platform V1 — Founder Review Report

**Branch:** `feat/moment-platform-v1` (from `origin/main` @ `8cc4b1d`)  
**Status:** Implemented locally. **Not pushed. Not published to production.**  
**Date:** 2026-08-06

## Architecture updates applied

Founder Architecture Approval + Required Revisions are locked into the review canvas and this implementation:

| Decision | Implementation |
|----------|----------------|
| GLOBAL host | `VITE_MOMENT_LIBRARY_GLOBAL_BASE` → HTTP host (Firebase/GCS CDN ready) |
| CN host | `VITE_MOMENT_LIBRARY_CN_BASE` domestic only; Firebase-looking URLs refused |
| Region resolution | `account.dataRegion` when signed in; locale suggestion only when signed out |
| Atomic validation | Any active Moment failure rejects entire candidate pack |
| Immutable versions | Exporter writes `moments/{id}.v{n}.json`; never overwrites in ordinary updates |
| Snapshot provenance | New sessions store libraryVersion, schemaVersion, signalCatalogVersion + copy + signals |
| A/B | `ab` reserved null only — no assignment logic |
| Language | zh+en in same Moment document (unchanged content model) |

## What changed (code)

- `src/types/momentLibrary.ts` — pack/manifest/provenance types
- `src/types/moments.ts` — snapshot provenance fields
- `src/data/moments/platformConstants.ts`
- `src/data/moments/seed/momentLibrary.v1.pack.json` — immutable seed (21 Moments)
- `src/data/moments/momentLibrary.schema.json`
- `src/services/moments/libraryHash.ts`, `libraryValidation.ts`, `libraryClient.ts`, `libraryHosts.ts`, `dataRegion.ts`
- `src/services/moments/momentsClient.ts` — runtime library from client (seed/cache/remote)
- `src/services/moments/momentsService.ts` — snapshot provenance
- `src/auth/providers/types.ts` — `SeenUser.dataRegion`
- `src/auth/AuthContext.tsx` — sync account region into library client (no UI change)
- `scripts/exportMomentLibrary.ts`, `scripts/buildLibraryV2TestMoment.ts`
- Local fixtures: `moment-library/v1/{global,cn}/`, `moment-library/fixtures/test-v2/global/` (test Moment only)

**Not modified:** UI pages, Reflect, Sketch Engine content, Movement ontology, Matching, Me surfaces (aside from Auth wiring for `dataRegion`).

## Success criteria checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | 21-Moment library exported as immutable seed v1 | Done |
| 2 | Remote v1 fixture content-equivalent to seed | Done (`moment-library/v1/global`) |
| 3 | Web/iOS/Android load/validate/cache/use | Code path wired; **production host env not set** — uses seed offline |
| 4 | Offline first launch uses seed | Tested |
| 5 | Offline later launch uses last validated cache | Tested |
| 6 | Corrupt/incompatible v2 rejected; sessions untouched | Tested |
| 7 | Net-new Moment as library v2 | Fixture under `moment-library/fixtures/test-v2` with `TEST-PLAT-001`; formal sync rejects `TEST-*` |
| 8 | Existing installs receive v2 without app rebuild | Requires production CDN publish + env bases (blocked pending approval) |
| 9 | Existing sessions/sketches unchanged via snapshots | Provenance additive; rejection test keeps active session |

## Tests run

```
vitest: moments dataRegion, libraryClient, libraryHosts, config,
        momentsService, founderFrozenSet001/002, libraryExpansion,
        sketchEngine, sketchEngineV2
→ all passed (96 tests in these files)

npm run build → success
```

## Production publication (blocked)

Do **not** push or publish until Founder accepts this report.

Before production:

1. Set `VITE_MOMENT_LIBRARY_GLOBAL_BASE` to GLOBAL CDN base serving `moment-library/v1/global`.
2. Set `VITE_MOMENT_LIBRARY_CN_BASE` to domestic CN CDN (never Firebase).
3. Decide default `SeenUser.dataRegion` assignment policy for new accounts.
4. Publish seed-equivalent v1 packs only; then optionally publish Founder-approved v2 (replace `TEST-PLAT-001` with a real Moment).
5. Push `feat/moment-platform-v1` and open PR after approval.

## Ops commands (local)

```bash
npm run moments:export-library   # regenerate seed + v1 fixtures from library.ts
npm run moments:build-v2-test    # local v2 with TEST-PLAT-001 (not prod)
```
