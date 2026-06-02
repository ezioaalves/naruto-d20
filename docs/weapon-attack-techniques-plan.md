# Weapon Attack Techniques Plan

> **Status: shipped.** This document is retained as the implementation notes for
> weapon-attack techniques. The parser/selector flow is implemented, the
> `weaponAttack` config format is documented in
> [`funcionalidades-e-melhorias.md`](funcionalidades-e-melhorias.md), and source
> JSON shape is covered by `npm run validate:compendia`.

## Summary

Weapon-attack techniques, after the normal Perform flow succeeds, ask the user
to choose one of the actor's weapons or attacks and roll that PF1e item with
fixed bonuses from the technique. The initial scope was limited to `JIKI-UCHI
(OPPORTUNITY STRIKE)` and `KENJUTSU: IAIDO (SWORD ART: IAIDO)`. Techniques with
their own attack and damage, such as `RAITE NO JUTSU`, keep the self-contained
action flow.

## Shipped Changes

- Configuration is read from `system.flags.dictionary`:
  - `weaponAttack.mode = selected`
  - `weaponAttack.filter = meleeOrUnarmed` or `meleeWeapon`
  - `weaponAttack.attackBonus = 2[Technique Name]`
  - `weaponAttack.damageBonus = 2[Technique Name]`
  - `weaponAttack.held = twohanded` when a technique should calculate damage as two-handed.
- `performTechnique` checks for `weaponAttack.mode === "selected"` before
  rolling the technique's own action.
- For selected-weapon techniques:
  - open a weapon/attack selector;
  - abort without spending chakra if the selector is cancelled;
  - roll the chosen weapon/attack with the normal PF1e dialog;
  - spend chakra and run automation only after the PF1e use is confirmed.
- `TechniqueWeaponAttackSelector` provides a small selector UI:
  - list equipped weapons with usable attack actions;
  - for `meleeOrUnarmed`, also list compatible unarmed/natural attacks;
  - display item image, item name, and action name.
- Inject technique bonuses with a temporary `pf1CreateActionUse` hook scoped to the chosen item/action:
  - push `weaponAttack.attackBonus` into `actionUse.shared.attackBonus`;
  - push `weaponAttack.damageBonus` into `actionUse.shared.damageBonus`;
  - unregister the hook after the use attempt, including cancellation.

## Technique Updates

- Mark `JIKI-UCHI (OPPORTUNITY STRIKE)`:
  - filter: `meleeOrUnarmed`;
  - bonus: `+2` attack and `+2` damage.
- Mark `KENJUTSU: IAIDO (SWORD ART: IAIDO)`:
  - filter: `meleeWeapon`;
  - bonus: `+2` attack and `+2` damage;
  - `held = twohanded`.
- Do not automate narrative or situational restrictions in this pass, including opportunity-attack timing, sheathed-weapon requirements, prone restrictions, Iaido's Defense penalty, or attacking every creature in a square. Those remain manual adjudication or future buff/automation work.

## Test Plan

- Use `Jiki-Uchi` with an equipped melee weapon:
  - Perform succeeds;
  - selector opens;
  - chosen weapon opens the PF1e attack dialog;
  - roll includes `+2` attack and `+2` damage from the technique.
- Use `Jiki-Uchi` with a compatible unarmed/natural attack:
  - the attack appears in the selector and receives the same bonuses.
- Use `Iaido`:
  - selector lists only equipped melee weapons;
  - roll includes `+2` attack and `+2` damage;
  - damage is calculated as two-handed.
- Cancellation cases:
  - cancelling the selector spends no chakra;
  - cancelling the PF1e attack dialog spends no chakra.
- Regression checks:
  - `Raite no Jutsu` still rolls its own technique action;
  - techniques without `weaponAttack.mode = selected` keep the current behavior.

## Assumptions

- The selector uses only actor item data; it does not infer whether a weapon is sheathed or whether the current attack is truly an attack of opportunity.
- Technique bonuses are fixed formula parts in the final roll, not editable defaults in the PF1e manual bonus fields.
- Initial configuration lives in advanced dictionary flags and compendium JSON, without adding a dedicated sheet tab or controls in this pass.
