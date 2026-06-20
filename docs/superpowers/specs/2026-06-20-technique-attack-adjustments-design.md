# Technique Attack Adjustments Design

## Summary

Add a generic technique-level attack-adjustment model that can express attack-only combat tweaks independently of whether the technique rolls its own PF1e action or delegates to a selected weapon/unarmed attack via `weaponAttack.*`.

The initial supported adjustments are:
- Damage as if the attack were one or more size categories larger
- Bonus to critical confirmation rolls

TODOME will be migrated to the new generic fields.

## Goals

- Support the same technique metadata for:
  - Technique actions in `system.actions`
  - Techniques using `weaponAttack.mode = selected`
- Reuse PF1e v11.11 native roll behavior wherever possible
- Keep the implementation central so future techniques only need compendium data changes

## Non-Goals

- No new UI editing controls on the technique sheet in this change
- No broad migration of all existing technique text into structured attack metadata
- No custom damage-step implementation when PF1e already provides one

## Verified PF1e Behavior

PF1e v11.11 already supports both required mechanics:

- Critical confirmation bonuses:
  - Action field `critConfirmBonus`
  - Actor/buff target `critConfirm`, which only applies on the confirmation roll
- Size-based weapon damage:
  - Damage formulas commonly use `sizeRoll(..., @size)`
  - `ActionUse` supports a `size` conditional target that increments `rollData.size` for the current roll

Therefore the module should integrate with these native PF1e hooks instead of implementing its own size-die progression.

## Data Model

Add a new optional schema block on technique items:

- `system.attackAdjustments.sizeBonus`
  - Integer, default `0`
  - Represents the number of size categories to add for damage calculation on the affected attack
- `system.attackAdjustments.critConfirmBonus`
  - String formula, default `""`
  - Formula applied only to the critical confirmation roll

This block is technique-level data, not per-action data, because the current need is to describe technique modifiers that apply to the triggered attack as a whole. If a future feature needs per-action variation, it can extend the model later.

## Runtime Integration

### WeaponAttack techniques

For techniques that use `scripts/ui/technique-weapon-attack.mjs`:

- Parse the generic `attackAdjustments` block from the technique item
- During the temporary hook/decorator phase already used for attack and damage bonuses:
  - Apply `critConfirmBonus` to the selected action's confirmation roll
  - Apply `sizeBonus` using PF1e's native size handling for the action roll context

The implementation should be temporary and scoped to the triggered `item.use()` call, then restored during existing cleanup.

### Native technique actions

For techniques that call `item.use()` directly in `scripts/use-technique.mjs`:

- Detect whether the technique has non-empty `attackAdjustments`
- Temporarily decorate the current technique action before `item.use()`
- Apply:
  - `critConfirmBonus` on the action object
  - `sizeBonus` in a way that PF1e damage formulas using `@size` will honor during that action's roll
- Restore any mutated runtime state immediately after the use finishes

## TODOME migration

TODOME will be updated to structured data:

- `attackAdjustments.sizeBonus = 1`
- `attackAdjustments.critConfirmBonus = "2[TODOME]"`

Its descriptive text can remain as player-facing rules text, but the behavior will no longer depend on manual interpretation.

## Error Handling

- Empty or zero-valued adjustments should behave as no-op
- Invalid formulas should not crash the technique flow; they should follow existing PF1e/item roll behavior and surface naturally during roll evaluation
- Temporary action mutations must always be restored in `finally`

## Testing and Verification

Because this repo has no automated test suite, verification is manual:

- Confirm a technique with `weaponAttack` and `sizeBonus = 1` increases damage dice by one size step
- Confirm a technique with `weaponAttack` and `critConfirmBonus` only adds the bonus on the confirmation roll
- Confirm a native technique action with the same fields behaves identically
- Confirm a technique without `attackAdjustments` behaves unchanged
- Confirm TODOME now rolls the larger damage and `+2` confirmation bonus

## Files Expected To Change

- `scripts/data/technique-model.mjs`
- `scripts/ui/technique-weapon-attack.mjs`
- `scripts/use-technique.mjs`
- `packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json`
