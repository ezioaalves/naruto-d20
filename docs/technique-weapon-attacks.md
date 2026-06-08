# Technique Weapon Attacks

Some Naruto d20 techniques need to roll through an actor's existing PF1e weapon
or attack item instead of rolling the technique item directly. This is used when
the technique text says to make a normal weapon, ranged, or unarmed attack, and
the roll must inherit all bonuses that PF1e applies to that attack item.

The feature is configured on technique source JSON under
`system.flags.dictionary.weaponAttack.*`:

```json
"weaponAttack.mode": "selected",
"weaponAttack.filter": "unarmedOnly",
"weaponAttack.damageMode": "replace"
```

Supported filters are implemented in
`scripts/ui/technique-weapon-attack.mjs`:

- `meleeWeapon`: equipped melee weapons and weapon-derived attack items.
- `rangedWeapon`: equipped ranged weapons and weapon-derived attack items.
- `unarmedOnly`: natural/unarmed attack items only.
- `meleeOrUnarmed`: both melee weapons and unarmed attack items.

`damageMode: "replace"` means the selected attack item supplies the attack roll
context, but the technique action supplies technique-specific action details.
Historically this meant damage replacement only; it now also preserves save,
range, target, and effect-note data from the technique action.

## PF1e Flow Analyzed

The relevant PF1e v11.11 source was checked in the installed readable source at:

`/home/joelfmjr/.foundrydata/Data/modules/foundryvtt-pathfinder1`

The key file is:

`module/action-use/action-use.mjs`

Important PF1e behavior:

- `ActionUse.process()` calls `Hooks.callAll("pf1CreateActionUse", this)` after
  `getRollData()` and before generating attacks.
- The hook is early enough to mutate `actionUse.shared.action` and
  `actionUse.shared.rollData.action` before attack rolls, damage rolls, saves,
  effect notes, and range are calculated.
- `ActionUse.item`, `ActionUse.action`, `ActionUse.actor`, and
  `ActionUse.shared` are installed with `Object.defineProperties()`. The direct
  `item` and `action` properties are not writable, so the module cannot simply
  replace `actionUse.item` with the technique item.
- `ActionUse.finalizeAttack()` copies save information from
  `shared.action.save.type` and `shared.action.getDC(shared.rollData)` into
  `shared.save` and `shared.saveDC`.
- `ActionUse.getMessageData()` builds the chat card from `this.item.getChatData`
  and `this.shared.action`. If the selected unarmed attack item is left as-is,
  the resulting card shows the unarmed attack item name, description, and
  properties instead of the technique.
- `ActionUse.postMessage()` renders
  `systems/pf1/templates/chat/attack-roll.hbs` from `shared.templateData`.
  The template displays `name`, `description`, `actionDescription`,
  `properties`, `rangeLabel`, `hasSave`, and `save`.

PF1e chat templates checked:

- `public/templates/chat/attack-roll.hbs`
- `public/templates/chat/parts/attack-roll-header.hbs`
- `public/templates/chat/parts/attack-roll-footer.hbs`

## Naruto d20 Implementation

The Naruto d20 integration lives in:

`scripts/ui/technique-weapon-attack.mjs`

When a technique has a valid `weaponAttack` config, `performTechnique()` routes
the use through `rollSelectedWeaponAttackWithTechnique()`. That function:

1. Opens a selector listing valid actor weapon/attack actions.
2. Calls `selection.item.use()` so PF1e rolls through the selected attack item.
3. Installs a temporary `pf1CreateActionUse` hook for that one selected item and
   action.

Inside the hook, the module now does two separate things.

### Action data replacement

For `damageMode: "replace"`, `replaceActionDetails()` copies technique action
fields into both:

- `actionUse.shared.action`
- `actionUse.shared.rollData.action`

Copied fields:

- `damage`
- `ability` damage and critical data
- `save`
- `notes.effect`
- `notes.footer`
- `range`
- `target`
- `touch`

This lets PF1e keep the selected attack item's attack bonuses while calculating
technique-specific saves, ranges, and effect notes. A cleanup callback restores
the selected action after `selection.item.use()` finishes, so the actor's attack
item is not permanently modified.

### Chat data decoration

Because `ActionUse.item` itself cannot be replaced, PF1e still initially builds
the card as if the selected attack item was used. To fix that, the integration
wraps `actionUse.getMessageData()` for the current use only.

After PF1e prepares its normal card data, `applyTechniqueChatData()` calls
`technique.getChatData({ actionId, chatcard: true, rollData })` and rewrites the
display fields in `actionUse.shared.templateData`:

- card name
- item description
- action description
- item/action references used by the template
- header image
- common info properties

It also updates `actionUse.shared.chatData.system.item` and
`actionUse.shared.chatData.system.action` so the stored chat metadata points back
to the technique rather than only the selected attack item.

The result is a hybrid use:

- attack roll math comes from the selected PF1e attack item;
- technique save, range, target, effect text, enriched links, and visible card
  identity come from the Naruto d20 technique.

## Hekiden no Jutsu Fix

`HEKIDEN NO JUTSU (ELECTRICAL SPLIT TECHNIQUE)` now uses:

```json
"weaponAttack.mode": "selected",
"weaponAttack.filter": "unarmedOnly",
"weaponAttack.damageMode": "replace"
```

This matches the attack-roll behavior needed from `RAITE NO JUTSU`: Hekiden is
rolled through an actor's unarmed attack so unarmed-specific PF1e bonuses apply.

The extra integration work is required because Hekiden has no damage but does
have a Fortitude save and an enriched blinded condition in its description. A
plain selected unarmed attack card would lose those technique details.

## Manual QA

In Foundry VTT 13 with PF1e v11.11+:

1. Import or refresh Hekiden on an actor.
2. Ensure the actor has a natural/unarmed attack item with visible attack
   bonuses.
3. Use Hekiden from the technique list.
4. Select the unarmed attack in the selector.
5. Confirm the chat card shows Hekiden's name, description, enriched blinded
   condition, touch range, and Fortitude save button.
6. Confirm the attack roll total includes the same bonuses as the selected
   unarmed attack.

