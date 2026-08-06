# Seen Moment Library — Permanent ID Convention

**Status:** Founder Frozen  
**Scope:** Moment identifiers, versioning, session snapshots, Moment Registry  
**Does not change:** Reflect, Sketch Engine, HUE, Matching, UI surfaces  

Workflow: Moment Library is the **primary content asset**. Moments are product
content, not application code. New Moments ship as Library Versions without
app rebuild unless renderer / interaction / ontology / Signal IDs change.

**Immutable meaning:** Signal meaning and Movement meaning are immutable.
Backward compatibility is mandatory; historical understanding must always
remain reproducible.

Every Library Version requires Release Notes (Added / Updated / Retired /
Signal changes / Breaking changes). See [`../RELEASE.md`](../RELEASE.md).

---

## Purpose

Moment IDs are **permanent identifiers**.

| Rule | Meaning |
|------|---------|
| Never reused | An ID that has been issued is never assigned to a different Moment |
| Never change | An existing Moment keeps its ID forever |
| Wording may evolve | Question / option copy may change; **version** increases; **ID stays** |
| Signal mappings may evolve | Option→signal mappings may change; **version** increases; **ID stays** |
| Moment IDs remain forever | Including retired Moments (IDs stay reserved) |

---

## Naming (categories)

| Code | Domain |
|------|--------|
| REL | Relationship |
| FRI | Friendship |
| BUS | Business |
| PAR | Parenting |
| SOC | Social |
| TRV | Travel |
| COM | Commitment |
| LIF | Daily Life |
| MON | Money |
| LRN | Learning |
| WRK | Career / Work |
| FAM | Family |
| SELF | Self-awareness |

### Canonical ID form

```
{CATEGORY}-{NNN}
```

Examples: `REL-001`, `REL-002`, `FRI-001`, `BUS-002`, `PAR-001`.

- Zero-padded three-digit sequence **within** the category.
- Sequences do not restart when a Moment is retired.
- Gaps (e.g. `BUS-001` reserved while `BUS-002` is live) are intentional and permanent.

---

## Rules

1. **Never reuse** an existing ID.
2. **Never renumber** Moments.
3. **Retired Moments remain reserved forever.**  
   Example: if `REL-008` is retired, `REL-008` may never become another question.
4. **Question wording may change.** Moment `version` increases; ID stays.  
   Example: `REL-003` v1 → v2 → v3.
5. **Session snapshots always store:**
   - Moment ID (`momentId`)
   - Moment Version (`version`)
   - Library Version (`libraryVersion`)
   - Schema Version (`schemaVersion`)
   - Signal Catalog Version (`signalCatalogVersion`)

Legacy sessions created before Moment Platform V1 may omit pack provenance fields; new sessions must include all five.

---

## Legacy

Old `M-Pxx` Moments are **historical aliases only**.

- They remain permanent IDs (never renumbered, never reused).
- **Canonical IDs** for new Moments are category IDs (`REL-*`, `FRI-*`, …).
- Do not mint new `M-Pxx` IDs.

---

## Moment Registry (single source of truth)

The **Moment Registry** (`src/data/moments/momentRegistry.ts`) is the SSOT for issued IDs.

| Policy | Detail |
|--------|--------|
| Founder-approved → registry | Every Founder-approved Moment is added to the registry |
| No duplicates | Duplicate IDs are forbidden |
| Library ⊆ Registry | Every Moment in a formal library pack must already be registered |
| Retired stay listed | Status `retired`; ID never reassigned |
| Reserved slots | Status `reserved` (e.g. `BUS-001`); content may be filled later **only** for that ID |

Registry status values:

- `active` — live / approved content may ship in a library pack
- `reserved` — ID claimed; not yet (or not currently) shipping content
- `retired` — permanently withdrawn; ID remains reserved forever

---

## Related code

| Artifact | Role |
|----------|------|
| `src/data/moments/momentRegistry.ts` | Registry SSOT |
| `src/data/moments/momentRegistry.test.ts` | Permanence / uniqueness guards |
| `src/types/moments.ts` → `MomentSnapshot` | Snapshot fields (ID + versions) |
| `src/data/moments/library.ts` | Authoring source for pack content |
| Moment Platform packs | Immutable published library versions |
