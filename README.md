# Seen App

Mobile-first Seen client (Web + Capacitor iOS/Android).

## Release workspace (Founder Frozen)

This directory — `Dropbox/SpotOnTechnologies/Seen/seenapp` — is the **permanent release workspace**.

- Branch: always `main`, always clean
- Purpose: release, build, TestFlight, Play Store, Web deploy, Moment Platform verification
- **No feature development, experiments, or WIP here**

Full policy and commands: **[RELEASE.md](./RELEASE.md)**

All engineering experiments and feature branches live under:

```
Dropbox/SpotOnTechnologies/Seen/worktrees/
```

---

## Quick release commands

```bash
git pull origin main
npm ci
npm run build
npx cap sync ios
npx cap sync android
```

Then Archive / store upload / Web deploy as needed.

Moment Library content updates ship as **library versions** and must not require an app rebuild (unless renderer, interaction type, ontology, or Signal IDs change). See `RELEASE.md` and `docs/MOMENT_ID_CONVENTION.md`.

---

## Local preview (release verification only)

Prefer verifying builds from this clean `main` tree. For feature work, use a worktree under `Seen/worktrees/`.

```bash
npm ci
npm run dev
```

Open the local Vite URL (typically `http://localhost:5173`). The UI is constrained to a mobile viewport on desktop.

---

## Core product surfaces (frozen)

- **Reflect** — expression and AI mirroring (lifecycle frozen; see `RELEASE.md`)
- **Moments** — behaviour observation via Moment Library (remote versioned content)
- **Discover / Inbox / Me** — navigation and product shell (frozen unless Founder reopens)

**Current Understanding** remains reserved — no implementation without Founder request.

---

## Design philosophy

Quiet, restrained, low stimulation. No social metrics. Soft typography and ample whitespace.
