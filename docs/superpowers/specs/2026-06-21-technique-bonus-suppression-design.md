# Technique Bonus Suppression Design

## Goal

Add generic technique metadata that can suppress selected native PF1e attack
bonuses when a technique delegates to a selected weapon or unarmed attack.
Start with AMATSU NO KARADA: it should keep general attack/damage bonuses such
as flanking, charge, high ground, dialog bonuses, and technique-added damage,
but should not receive attack bonuses that belong to the selected natural attack
itself and should not add Strength to damage.

## Architecture

The feature extends the existing `weaponAttack` dictionary config rather than
adding a parallel technique model. Techniques can define:

```json
"weaponAttack.suppressedBonuses": "naturalAttack,abilityDamage"
```

The parser accepts a comma-separated string or array-like value and returns a
normalized list of known suppression tokens. Unknown tokens are reported through
the existing `weaponAttack` config warning path.

Initial tokens:

- `abilityDamage`: temporarily clears `action.ability.damage` on both the
  selected action and `rollData.action`, preventing PF1e from adding Strength
  or another ability to damage.
- `naturalAttack`: temporarily clears selected-action attack bonuses that are
  intrinsic to the natural attack, including `action.attackBonus` and the
  secondary natural attack attack bonus/penalty path.

## Data Flow

When `rollSelectedWeaponAttackWithTechnique` receives the `pf1CreateActionUse`
hook for the selected attack, it applies suppressions before adding
technique-specific bonuses. The mutation uses the existing cleanup stack, so the
selected item action is restored after the delegated roll finishes.

PF1e v11.11 behavior confirmed in source:

- General situational bonuses from the attack dialog are appended to
  `actionUse.shared.attackBonus`.
- General damage bonuses from the attack dialog and Naruto technique additions
  are appended to `actionUse.shared.damageBonus`.
- Ability damage is read from `action.ability.damage`.
- Natural secondary attack handling reads
  `action.naturalAttack.secondary.attackBonus`.

Because suppression edits only the selected action data, not `shared.*`, general
bonuses remain available.

## Amatsu Source Update

AMATSU NO KARADA should use delegated unarmed attacks:

```json
"weaponAttack.mode": "selected",
"weaponAttack.filter": "unarmedOnly",
"weaponAttack.damageMode": "replace",
"weaponAttack.suppressedBonuses": "naturalAttack,abilityDamage"
```

Its own action should not declare `ability.damage: "str"` because the technique
damage is elemental and explicitly does not add Strength.

## Testing

Add node tests for:

- parsing `weaponAttack.suppressedBonuses`;
- rejecting/reporting unknown suppression tokens while preserving known tokens;
- applying and restoring `abilityDamage` suppression without touching
  `shared.damageBonus`;
- applying and restoring `naturalAttack` suppression without touching
  `shared.attackBonus`.

Run the relevant node tests and `npm run validate:compendia`.
