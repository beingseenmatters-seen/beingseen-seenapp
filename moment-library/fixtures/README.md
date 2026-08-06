# Moment Library fixtures (non-production)

These trees are **not** production publish sources.

- `test-v2/` — contains `TEST-PLAT-001` for local acceptance harnesses only.
- Formal app sync (`MomentLibraryClient.syncRemote`) rejects `TEST-*` Moment ids.
- Production publishes must use `moment-library/v1/{global,cn}/` (or a Founder-approved successor without TEST ids).
