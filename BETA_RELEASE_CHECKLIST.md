# Seen V1 Beta Release Checklist

Release branch: `release/v1-beta`  
Scope: Moment Library (21 Moments) + Sketch Engine V2 + bilingual Moments/Sketches  
Base: production `main` @ `f2d2bde`  
**Excluded:** Evidence Playground, Current Understanding UI, matching changes, Lambda/prompt edits, UI redesign

---

## Pre-flight (already run on release branch)

- [x] Founder Frozen Set 001 + 002 merged into official `MOMENT_LIBRARY` (21 active Moments)
- [x] Sketch Engine V2 verified (93 focused Moments/understanding tests passed)
- [x] Production build (`tsc -b && vite build`) succeeded
- [x] Production bundle contains no `/dev` Evidence Playground routes

---

## A. Web App release

1. [ ] Review PR `release/v1-beta` → `main` (files listed in PR only)
2. [ ] Merge to `main` and confirm Vercel production deploy completes
3. [ ] Note production URL + deployment ID (rollback identifier)
4. [ ] Hard-refresh production (Cmd+Shift+R)

### Manual smoke — Web

- [ ] **Onboarding** — nickname, age, gender, zodiac required; no Current State / Interests
- [ ] **Me** — “Seen 眼中的你” / “How Seen Sees You”; CTA 开始体验 / Start Moments
- [ ] **Moments entry** — `/moments` intro loads; start session
- [ ] **Moment pool** — over 2–3 sessions, see new Moments (随便, 快了快了, 在吗, 上错的菜, 收拾行李, 明天要交, 超出预算, 普通的家, 方向分歧, ranking M-P11/M-P12). Pool = 21, session draws 10
- [ ] **English Moments** — switch language to English → new session → Q&A in native English
- [ ] **Sketch (zh)** — complete session → Chinese sketch, audited Continuity+Delta voice
- [ ] **Sketch (en)** — English UI → sketch body in English (not Chinese)
- [ ] **My Sketches** — history + detail; language switch re-renders sketch when provenance exists
- [ ] **Reflect** — all 6 modes; per-turn switching; Understanding Update; 符合我，留下 / 不太符合，不保留
- [ ] **No debug UI** — no `/dev/*`, no visible `[helper]` / signal / score metadata
- [ ] **Navigation** — Me / Reflect / Discover / Inbox; no console-blocking errors

**Web verified:** ________  date: ________

---

## B. Capacitor native sync (after Web verified)

From `seenapp` on the released `main` commit:

```bash
npm ci
npm run build
npx cap sync ios
npx cap sync android
```

Confirm sync points at the same web `dist/` that Vercel ships.

### iOS

```bash
npx cap open ios
# Xcode: select team/signing → Archive → distribute TestFlight / internal beta
```

- [ ] `cap sync ios` completed without errors
- [ ] App launches; Firebase Auth works (Apple / Google / email as configured)
- [ ] Moments full flow + English sketch
- [ ] Reflect send/extract against production API
- [ ] Push / deep links smoke if used in beta

### Android

```bash
npx cap open android
# Android Studio: Build signed bundle/APK → internal testing track
```

- [ ] `cap sync android` completed without errors
- [ ] App launches; Auth works
- [ ] Moments full flow + English sketch
- [ ] Reflect against production API

**iOS build ID / version:** ________  
**Android build ID / version:** ________

---

## C. Beta tester focus (product)

- [ ] Sketches evolve across sessions (not the same opening every time)
- [ ] Weak/repeat sessions feel confirmatory, not artificially novel
- [ ] Chinese and English feel native (not machine-translated idioms)
- [ ] Deleting a retained sketch withdraws that session’s contribution for later understanding

---

## Rollback

- **Web:** Redeploy previous Vercel production deployment for `main` (pre-merge SHA `f2d2bde`)
- **Native:** Do not promote new TestFlight / Play builds; keep prior store binary

---

## Out of scope for this beta (do not test as broken)

- Evidence Playground / founder debugger
- Matching / Discover algorithm changes
- Living Profile / Current Understanding production UI
- New Reflect prompt edits beyond already-live v3.1
