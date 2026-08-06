# Seen — Release Workspace

**Status:** Founder Frozen (Development Workflow Freeze)  
**Path:** `Dropbox/SpotOnTechnologies/Seen/seenapp`  
**Branch:** always `main` · always clean

This directory is the **permanent release workspace**. It is not a feature development tree.

---

## Purpose

`seenapp` is used **only** for:

- Release
- Build
- TestFlight
- Play Store
- Web deployment
- Moment Platform runtime verification

It is **not** used for:

- Feature development
- Experiments
- WIP
- Evidence Playground / Current Understanding implementation
- Local redesign of frozen systems

---

## Workspace layout

| Path | Role |
|------|------|
| `…/Seen/seenapp` | Release workspace — `main`, clean |
| `…/Seen/worktrees/` | All development and experiments |

Examples under `worktrees/`:

- `evidence-playground`
- `current-understanding`
- `wechat`
- future feature branches

Create new worktrees from a clean clone or from git; never develop inside this release directory.

---

## Product systems frozen

Do not redesign the following unless the Founder explicitly reopens architecture:

- UI
- Navigation
- Reflect
- Sketch Engine
- Human Understanding Engine
- Behaviour Understanding
- Meaning Understanding
- Matching architecture
- Moment Platform
- Release workspace structure

**Current Understanding** remains intentionally reserved. No implementation unless the Founder requests it.

Primary product work from this point: **designing better Moments** (content), not redesigning application architecture.

---

## Founder Addendum — permanent principles

### 1. Moment Library is the primary content asset

- Moments are **product content**
- Moments are **not** application code
- Moment Library growth is the primary product activity of Seen

### 2. Signal and Movement meaning are immutable

- **Signal meaning is immutable**
- **Movement meaning is immutable**
- **Backward compatibility is mandatory**
- Historical understanding must **always** remain reproducible

Do not redefine what an existing Signal or Movement means. New meanings require new IDs (with Founder approval). Session snapshots + library/schema/signal catalog versions exist so past understanding can be regenerated faithfully.

### 3. Moment creation workflow

```
Founder
  → Moment Design
  → Engineering
  → Simulation
  → Founder Frozen
  → Library Version
  → Publish
```

### 4. Every Library Version requires Release Notes

No Library Version may publish without Release Notes that list:

| Section | Required |
|---------|----------|
| Added | New Moments / content |
| Updated | Changed Moments (wording, options, mappings) |
| Retired | Permanently withdrawn Moment IDs |
| Signal changes | New Signal IDs only if Founder-approved; never silent meaning changes |
| Breaking changes | If any — must be explicit; prefer none |

These four principles are permanent engineering rules.

---

## Application release flow

From this directory only:

```bash
cd /Users/spoton/Library/CloudStorage/Dropbox/SpotOnTechnologies/Seen/seenapp

git pull origin main
npm ci
npm run build
npx cap sync ios
npx cap sync android
```

Then Archive / upload (TestFlight, Play Store) or deploy Web as usual.

**Never** develop, experiment, or leave WIP directly inside `Seen/seenapp`.

---

## Release policy

### Application release (App Store / Play / Web binary)

Only when one or more of these change:

- UI
- Reflect
- Sketch Engine
- New interaction types
- New Signal IDs / ontology
- Native platform changes

### Moment Library release (content)

- Publish a new **Library Version** only
- **No** App Store / Play / Web app rebuild required for new Moments

New Moments must **never** require Web / iOS / Android rebuild unless renderer, interaction type, ontology, or Signal IDs change.

---

## Moment Platform (frozen)

```
App → Renderer → Human Understanding Engine → Sketch Engine
Moment Library → remote versioned content
```

- **Seed Library** — offline bootstrap
- **Remote Library** — normal update path

### Acceptance standard

Moment Platform is successful only when:

| Client | Expectation |
|--------|-------------|
| Existing installed Web | Receives new Moment **without** rebuild |
| Existing installed Android | Receives new Moment **without** rebuild |
| Existing installed iPhone | Receives new Moment **without** rebuild |

---

## Moment content workflow

Canonical flow (Founder Addendum §3):

```
Founder → Moment Design → Engineering → Simulation
  → Founder Frozen → Library Version → Publish
```

Typical content steps inside Design / Engineering: Chinese, English, Signal mapping, Sketch simulation — then Founder Frozen.

No app rebuild for content-only library publishes.  
Every publish must include **Release Notes** (Founder Addendum §4).

Permanent Moment IDs: see `docs/MOMENT_ID_CONVENTION.md`. IDs are never reused or renumbered; wording may evolve; Moment version increases.

---

## Reflect (frozen lifecycle)

```
Unfinished conversation → retain transcript
Finished conversation → Understanding Update → user review
  → Keep → persist Understanding Update only → dispose transcript
```

No completed transcript remains in Reflect.

---

## Related docs

| Doc | Role |
|-----|------|
| `docs/MOMENT_ID_CONVENTION.md` | Permanent Moment IDs |
| `moment-library/RELEASE_NOTES.template.md` | Required Release Notes skeleton per Library Version |
| `docs/MOMENT_PLATFORM_V1_FOUNDER_REVIEW.md` | Platform review history (architecture frozen) |
| Founding Team `ENGINEERING/Development_Workflow_Freeze_V1.md` | Org-wide workflow freeze |
| Founding Team `ENGINEERING/Moment_Library.md` | Official Moment registry / content gate |

Engineering for features and experiments: work under `Seen/worktrees/`, not here.
