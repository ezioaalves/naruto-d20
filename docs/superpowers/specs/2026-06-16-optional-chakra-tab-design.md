# Optional Chakra Tab — Design Spec

**Date:** 2026-06-16

## Problem

All `character` and `npc` actors get the Chakra tab injected unconditionally.
Creatures without chakra have their pool/reserve maximums calculated automatically
(because they have a level), but their current values stay at 0, causing
`checkAndUpdateConditions` to trigger Chakra Depletion the moment combat starts.

## Goal

Make the Chakra tab opt-out per actor, identical in concept to PF1e's spellbook
`inUse` toggle in the actor's Settings tab. When disabled: no tab, no conditions.

---

## Data

**Flag:** `flags["naruto-d20"].hasChakra` — `Boolean | undefined`

| Value | Meaning |
|---|---|
| `undefined` | defaults to `true` (existing actors unaffected) |
| `true` | chakra tab visible, conditions active |
| `false` | chakra tab hidden, conditions suppressed |

This flag is **not** initialized in `prepareBaseActorData` — it is persisted data,
not derived. All read sites use `actor.flags[MODULE_ID]?.hasChakra ?? true`.

No migration required: existing actors without the flag default to `true` via the
`?? true` fallback.

---

## Toggle UI

A "Naruto D20" section injected into the PF1e Settings tab via `renderActorSheetPF`,
appended to `[data-tab="settings"]`:

```
┌─ Naruto D20 ────────────────────────────────────┐
│  ☑ Has Chakra                                   │
└─────────────────────────────────────────────────┘
```

- Checkbox wired with a `change` listener → `actor.setFlag(MODULE_ID, "hasChakra", checked)`
- `setFlag` persists and triggers an actor update, which automatically re-renders the sheet
- The chakra tab appears/disappears on the next render without extra logic

---

## Behavior when `hasChakra === false`

### Chakra tab (`render-patch.mjs`)

In the `_renderInner` wrapper, skip nav `<a>` and content `<div>` injection:

```js
const hasChakra = this.actor.flags?.[MODULE_ID]?.hasChakra ?? true;
if (!hasChakra) return $html;
```

Foundry's V1 Tabs system only binds tabs it finds in the DOM, so skipping the
injection produces no errors.

### Chakra conditions (`chakra-conditions.mjs`)

`checkAndUpdateConditions` gains an early guard:

```js
if ((actor.flags?.[MODULE_ID]?.hasChakra ?? true) === false) {
  await _clearNarutoConditions(actor);
  return;
}
```

`_clearNarutoConditions` (new private function):
1. Calls `actor.setConditions({ lowReserves: false, chakraDepletion: false })`
2. Deletes any module-owned `fatigued`/`exhausted` ActiveEffects (same logic as the
   existing removal path in `checkAndUpdateConditions`)
3. Resets all tracking flags to `false`:
   `appliedFatigued`, `appliedExhausted`, `depletionActive`, `lowReserveFatiguePending`
   — skips the `actor.update()` if all were already `false` (no unnecessary round-trip)

**Edge case:** If a GM disables chakra on an actor that is in active combat with
Chakra Depletion already applied, the cleanup runs immediately on the next
`checkAndUpdateConditions` call triggered by the `setFlag` actor update.

---

## Files Changed

| File | Change |
|---|---|
| `scripts/ui/render-patch.mjs` | Guard at start of chakra tab injection block |
| `scripts/data/chakra-conditions.mjs` | Guard + `_clearNarutoConditions` helper |
| `scripts/ui/summary-stats.mjs` | Inject Naruto D20 settings section + change listener via existing `renderActorSheetPF` usage |
| `lang/en.json` | `NarutoD20.ActorSettings.Header`, `NarutoD20.ActorSettings.HasChakra.Label`, `.Hint` |
| `lang/pt-BR.json` | Portuguese translations |

No new files. No schema changes beyond the new flag. No migration.

---

## Out of Scope

- Making chakra max calculation conditional on `hasChakra` — pool/reserve maxes
  are still computed for actors with the flag off; they're just ignored.
- A world-level default setting — per-actor opt-out is sufficient.
- Hiding the Synckit header button when chakra is off — unrelated feature.
