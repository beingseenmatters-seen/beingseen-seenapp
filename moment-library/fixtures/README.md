# Moment Library fixtures (non-production)

These trees are **not** production publish sources.

- `test-v2/` — contains `TEST-PLAT-001` for local acceptance harnesses only.
- Formal app sync (`MomentLibraryClient.syncRemote`) rejects `TEST-*` Moment ids.
- Production publishes must use Founder-approved library packs (e.g. CDN
  `cdn/moment-library` global trees, or successor packs) **without** TEST ids.
- Content-only library publishes must not require an app rebuild — see
  `../../RELEASE.md`.
