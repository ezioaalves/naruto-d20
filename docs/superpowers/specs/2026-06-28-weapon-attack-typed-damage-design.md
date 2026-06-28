# Technique Weapon-Attack Typed Damage Bonuses

**Date:** 2026-06-28
**Status:** Approved design

## Problem

Technique weapon-attack automation currently stores damage bonuses as free-form
strings:

- `system.weaponAttack.damageBonus`
- `system.weaponAttack.nonCritDamageBonus`

At runtime, `damageBonus` is appended to `actionUse.shared.damageBonus`, which
PF1e treats as extra formula text on the first damage roll. It does not create a
separate damage instance and cannot carry damage types. `nonCritDamageBonus` is
inserted into `action.damage.nonCritParts`, but always with `types: []`, so it
also rolls as untyped.

Weapon damage configured directly on a PF1e weapon behaves better because it is
stored as `damage.parts[]` / `damage.nonCritParts[]` entries with `formula` and
`types`. PF1e's roll pipeline turns each part into a separate typed damage roll,
which produces the desired chat-card grouping.

## Goal

Make technique weapon-attack bonus damage use the same structured model as PF1e
weapon action damage parts, while keeping the configuration owned by
`system.weaponAttack`.

The user-facing result should be:

- Bonus damage from a technique can be split into multiple entries.
- Each entry can have explicit damage types such as `cold` or `electricity`.
- The roll card displays these entries as separate typed damage instances.
- Existing techniques keep their current behavior after migration.

## Decision

Keep the feature in the technique Automation tab and replace the current free
formula fields with typed damage-part arrays.

Do not move this data to `system.actions`. The selected weapon action remains
the damage source; `system.weaponAttack` is an overlay applied only when the
technique rolls through a selected weapon or unarmed attack. Storing overlay
damage on the technique's native action would blur that boundary and make
`damageMode: add` versus `replace` harder to reason about.

Do not parse `[label]` text as damage types. Existing formulas use bracketed
labels for roll flavor, such as `[Iaiken]` or `[Strength]`; treating those as
damage types would be ambiguous and unsafe. Types must be explicit structured
data.

## Data Model

Add two first-class arrays to `system.weaponAttack`:

```js
damageParts: [
  { formula: "2", types: ["cold"] },
],
nonCritDamageParts: [
  { formula: "(min(floor(@cl / 3), 4))d4", types: ["electricity"] },
],
```

Each row mirrors PF1e's `DamagePartModel` source shape:

- `formula`: string roll formula.
- `types`: array of damage type ids.

Keep `attackBonus` as a string. Attack bonuses do not carry damage types.

Remove `damageBonus` and `nonCritDamageBonus` from the editable UI once the
replacement arrays are available.

## Migration

Runtime and source migration should preserve old data conservatively:

- If `weaponAttack.damageBonus` is non-empty, convert it to one
  `damageParts` entry with the full old string as `formula` and `types: []`.
- If `weaponAttack.nonCritDamageBonus` is non-empty, convert it to one
  `nonCritDamageParts` entry with the full old string as `formula` and
  `types: []`.
- Do not attempt to split formulas on `+`; formulas can contain nested
  expressions, labels, and roll-data references.
- Do not infer types from bracket labels.
- Leave already-structured arrays unchanged.
- After migration, remove the legacy string fields from persisted source where
  practical.

This keeps old compendium techniques rolling exactly as before until a GM edits
their typed damage parts.

## Runtime

When a weapon attack is rolled through a technique:

- Append `config.damageParts` to `actionUse.shared.action.damage.parts`.
- Append `config.nonCritDamageParts` to
  `actionUse.shared.action.damage.nonCritParts`.
- Track original array lengths and restore them in the existing cleanup stack.
- Continue using `actionUse.shared.damageBonus` only for unrelated PF1e extra
  damage paths, not for the typed technique weapon-attack damage parts.

PF1e's existing `ItemAction.rollDamage()` then produces separate damage roll
instances because each appended part has its own `formula` and `types`.

## UI

In the Automation tab's weapon-attack section, replace:

- `Damage bonus`
- `Non-critical damage bonus`

with two repeatable damage-part editors:

- `Damage bonus instances`
- `Non-multiplying damage bonus instances`

Each row should expose:

- Formula input.
- Damage-type selector or visual type control using the same PF1e conventions
  as action damage where feasible.
- Add/remove controls.

The UI does not need to replicate the entire PF1e action sheet. It only needs a
small, focused editor for `formula` plus `types`.

## Validation

Keep validation permissive:

- Empty rows are dropped on save.
- `types` is normalized to a trimmed array of non-empty strings.
- Unknown/custom type ids are allowed, matching PF1e damage part behavior.

## Tests

Add focused node tests for:

- Defaults include `damageParts` and `nonCritDamageParts`.
- Legacy `damageBonus` and `nonCritDamageBonus` migrate to untyped structured
  rows without parsing labels.
- `getTechniqueWeaponAttackConfig()` returns structured arrays.
- Runtime injection appends typed rows to `damage.parts` and `nonCritParts` and
  restores them after cleanup.
- Existing no-bonus techniques remain unchanged.

Manual Foundry verification:

- Configure a weapon with typed base and non-multiplying damage.
- Configure a technique with typed weapon-attack bonus damage.
- Roll the technique through the weapon.
- Confirm the chat card shows separate typed damage instances like the native
  weapon roll.

## Non-Goals

- No automatic inference from formula labels to damage types.
- No change to weapon selection, filters, extra attacks, held state, charge, or
  suppression behavior.
- No migration of this data into `system.actions`.
- No broad redesign of the technique action editor.
