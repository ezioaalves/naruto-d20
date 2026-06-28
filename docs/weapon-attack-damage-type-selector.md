# Weapon Attack Damage Type Selector

This note documents the visual damage-type selector added to technique weapon
attack automation.

## Problem

Weapon attack automation gained structured damage rows under
`system.weaponAttack.damageParts` and `system.weaponAttack.nonCritDamageParts`,
but the technique sheet initially exposed the row damage types as plain text.
That made the technique workflow feel different from PF1e weapon action damage
configuration, and it made it easy to type labels that do not match PF1e damage
type IDs.

PF1e renders the nice damage icons in action sheets and chat cards from
`DamagePartModel.types`. The official weapon action UI uses:

- `systems/pf1/templates/internal/damage-type-visual.hbs`
- `pf1.applications.DamageTypeSelector`
- `pf1.registry.damageTypes`

The technique sheet now uses the same PF1e visual and selector path.

## Implementation

The stored module data remains simple and pack-friendly:

```json
{
  "formula": "1d4",
  "types": ["electric"]
}
```

No new compendium shape was introduced. The sheet builds a view model from that
stored array before rendering:

- `typesText` keeps a comma-separated hidden input value for Foundry form
  submission.
- `damage.types` is a `Set`, matching what PF1e's partial checks.
- `damage.standard` contains damage type registry entries for recognized PF1e
  damage IDs.
- `damage.custom` contains unrecognized custom damage labels.

The visible type control in `templates/item/technique-sheet.hbs` now renders
PF1e's `damage-type-visual.hbs` partial instead of a text input. Clicking the
visual control opens `pf1.applications.DamageTypeSelector`. Before opening the
selector, the sheet submits pending edits with `preventRender: true`, so formula
changes in the same row are not lost. The selector is opened with the row path
for PF1e's own window identity, such as:

```js
system.weaponAttack.damageParts.0.types
system.weaponAttack.nonCritDamageParts.0.types
```

The callback writes the full `damageParts` or `nonCritDamageParts` array back to
the technique item after replacing only the selected row's `types`. This avoids
partial numeric array-path updates dropping sibling row fields such as
`formula`.

Newly added rows use the same hidden-field plus visual-control structure and
start with the PF1e undefined damage label.

## Damage Type IDs

PF1e v11.11's electricity damage type ID is `electric`, even though its label is
"Electricity" and Naruto d20 rules text often says "electricity". The shared
weapon attack damage-part helper canonicalizes the legacy/user-facing
`electricity` alias into `electric`.

This affects:

- sheet form rows,
- defaults and migration normalization,
- runtime weapon attack damage injection,
- tests that assert the final roll data sent to PF1e.

Keeping the canonical ID in `types` lets PF1e render the expected lightning icon
in the damage card.

## Files

- `scripts/features/techniques/weapon-attack-damage-parts.mjs`
  normalizes damage rows and canonicalizes damage type aliases.
- `scripts/features/techniques/weapon-attack-sheet.mjs`
  prepares PF1e-compatible visual data for the sheet template.
- `scripts/features/techniques/sheet.mjs`
  wires the visual control to `DamageTypeSelector` and updates row paths.
- `templates/item/technique-sheet.hbs`
  renders the PF1e damage type visual partial for normal and non-multiplying
  damage rows.
- `styles/item/technique-sheet.css`
  sizes the visual selector to fit the compact technique automation layout.

## Verification

Automated verification:

```bash
npm test
git diff --check
```

Manual Foundry verification:

1. Open a technique item with weapon attack automation enabled.
2. Add or edit a damage bonus row in the Automation tab.
3. Click the damage type visual control.
4. Choose a PF1e damage type such as Electricity and save.
5. Confirm the row shows the damage icon instead of plain text.
6. Use the technique through a selected weapon or unarmed attack.
7. Confirm the chat damage card shows the same type icon on the technique bonus
   damage instance.
