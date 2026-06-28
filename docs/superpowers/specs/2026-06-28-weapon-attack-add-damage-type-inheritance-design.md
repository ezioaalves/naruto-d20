# Weapon Attack Add Damage Type Inheritance

**Date:** 2026-06-28
**Status:** Approved

## Goal

When a technique delegates to a selected weapon attack with
`system.weaponAttack.damageMode: "add"`, any added technique damage part with no
configured damage types inherits the selected weapon action's first normal
damage type.

## Behavior

- Applies only to runtime delegated weapon attacks using additive damage.
- Uses the first type list from the selected action's first normal damage part:
  `actionUse.shared.action.damage.parts[0].types`.
- Fills only rows whose normalized `types` array is empty.
- Preserves explicit technique damage types.
- Leaves rows untyped when the selected weapon has no normal damage type.
- Leaves `damageMode: "replace"` behavior unchanged.
- Applies to both normal added damage parts and non-critical added damage parts.

## Architecture

The change belongs in `scripts/features/techniques/weapon-attack.mjs`, inside
`applyTechniqueWeaponAttackDamageParts()`, because that function has both the
selected PF1e action and the normalized technique damage rows at the moment of
runtime injection. The helper should derive fallback types before appending
technique rows, then append cloned rows so the config object is not mutated.

## Testing

Add a `node:test` case covering a selected action with `slashing` weapon damage,
an additive technique damage part with `types: []`, and a non-critical part with
`types: []`. The test should assert both appended rows receive `["slashing"]`,
while cleanup restores the original selected weapon damage arrays.
