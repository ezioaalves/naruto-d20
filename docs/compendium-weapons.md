# Adding Weapons to the Equipments Compendium

This document describes how to add new weapon categories and items to the `equipments` compendium (`packs/_source/equipments/`). Follow this pattern for every new weapon category (Nin Weapons, Martial Weapons, etc.).

## Current Folder Hierarchy

```
equipments compendium
├── General Equipments  [EqpGenEqmntFld01]
│   └── Ninja Tools     [EqpNnjTlsFoldr02]
│       └── (training weight items)
└── Weapons             [WpnFolderAAA0001]
    └── Simple Weapons  [SmpWpnFolderB002]
        ├── Quarterstaff
        └── Throwing Spear
```

## Step 1 — Create Folder Documents

Every folder inside a Foundry compendium is a JSON file with `"_key": "!folders!<ID>"`.

**Root category folder** (e.g., `Nin_Weapons_<ID>.json`):
```json
{
  "_id": "<16-char-unique-ID>",
  "name": "Nin Weapons",
  "type": "Item",
  "description": "",
  "folder": "WpnFolderAAA0001",
  "sorting": "a",
  "color": null,
  "sort": 2000,
  "_stats": {
    "coreVersion": "13.351",
    "systemId": "pf1",
    "systemVersion": "11.11",
    "createdTime": null,
    "modifiedTime": null,
    "lastModifiedBy": null
  },
  "_key": "!folders!<16-char-unique-ID>"
}
```

Key fields:
- `"_id"` and the `!folders!` suffix in `"_key"` must use the **same 16-char alphanumeric ID** — this is what identifies the document as a folder.
- `"folder"`: `null` for root-level; parent folder's `_id` for children.
- `"sort"`: controls display order among siblings (higher = lower in list).

**IDs already in use** in this compendium:

| ID | Name |
|----|------|
| `EqpGenEqmntFld01` | General Equipments |
| `EqpNnjTlsFoldr02` | Ninja Tools |
| `WpnFolderAAA0001` | Weapons |
| `SmpWpnFolderB002` | Simple Weapons |

Pick a new unique 16-char ID for each new folder. Format used here: descriptive prefix + zero-padded counter (e.g., `NnjWpnFolderC003`).

## Step 2 — Create Weapon Item Documents

File naming convention: `Weapon_Name_<ItemID>.json`

### Minimal weapon template

```json
{
  "_id": "<16-char-unique-ID>",
  "_key": "!items!<same-ID>",
  "_stats": {
    "coreVersion": "13.351",
    "systemId": "pf1",
    "systemVersion": "11.11",
    "createdTime": null,
    "modifiedTime": null,
    "lastModifiedBy": null
  },
  "type": "weapon",
  "name": "Weapon Name",
  "img": "systems/pf1/icons/items/weapons/<icon-name>.<PNG|png>",
  "folder": "<parent-folder-ID>",
  "system": {
    "description": { "value": "<p>Description text.</p>", "unidentified": "" },
    "actions": [ /* see below */ ],
    "weaponSubtype": "1h",
    "weaponGroups": ["spears"],
    "weight": { "value": 2 },
    "price": 4,
    "quantity": 1,
    "identified": true,
    "carried": true,
    "equipped": false,
    "hardness": 5,
    "hp": { "base": 3 }
  },
  "effects": [],
  "ownership": { "default": 0 },
  "sort": 0,
  "flags": {}
}
```

### `system.weaponSubtype` values

| Value | Meaning |
|-------|---------|
| `"1h"` | One-handed melee |
| `"2h"` | Two-handed melee (also set `"hands": 2, "held": "2h"`) |
| `"ranged"` | Projectile weapon |

### `system.subType` values (weapon category / proficiency)

| Value | Meaning |
|-------|---------|
| omitted | Simple weapon |
| `"martial"` | Martial weapon |
| `"exotic"` | Exotic weapon |

### `system.weaponGroups` common values

`"staves"`, `"spears"`, `"bows"`, `"crossbows"`, `"thrown"`, `"bladesLight"`, `"bladesHeavy"`, `"hammers"`, `"double"`, `"close"`, `"flails"`, `"tribal"`

### `system.properties` common flags

| Flag | Meaning |
|------|---------|
| `"double": true` | Double weapon (two ends, two attacks) |
| `"fin": true` | Finessable (can use Dex for attack) |
| `"trip": true` | Trip weapon |
| `"disarm": true` | Disarm weapon |
| `"brace": true` | Brace (readied action vs. charge) |
| `"reach": true` | Reach weapon |

## Step 3 — Action Definitions

Each weapon has one or more entries in `system.actions[]`. Every action needs a unique 16-char `_id`.

### Action types (`actionType`)

| Code | Meaning |
|------|---------|
| `"mwak"` | Melee weapon attack |
| `"rwak"` | Ranged weapon attack |
| `"twak"` | Thrown weapon attack |

### Standard melee action

```json
{
  "_id": "<16-char-action-ID>",
  "name": "Attack",
  "actionType": "mwak",
  "activation": {
    "type": "attack",
    "unchained": { "type": "attack" }
  },
  "ability": {
    "attack": "_default",
    "damage": "str"
  },
  "damage": {
    "parts": [
      {
        "formula": "sizeRoll(1, 6, @size)",
        "types": ["bludgeoning"]
      }
    ]
  },
  "range": { "units": "melee", "value": "0" },
  "duration": { "units": "inst" },
  "extraAttacks": { "type": "standard" },
  "uses": { "autoDeductChargesCost": "0" }
}
```

### Standard ranged / thrown action

```json
{
  "_id": "<16-char-action-ID>",
  "name": "Attack",
  "actionType": "rwak",
  "activation": {
    "type": "attack",
    "unchained": { "type": "attack" }
  },
  "ability": {
    "attack": "_default"
  },
  "damage": {
    "parts": [
      {
        "formula": "sizeRoll(1, 6, @size)",
        "types": ["piercing"]
      }
    ]
  },
  "range": { "units": "ft", "value": "60", "maxIncrements": 10 },
  "duration": { "units": "inst" },
  "extraAttacks": { "type": "standard" },
  "uses": { "autoDeductChargesCost": "0" }
}
```

### Modifying the attack roll

Add `"attackBonus": "<formula>"` directly on the action to apply a flat modifier:

```json
"attackBonus": "-4"
```

### Critical range / multiplier

Set these on `ability` when they differ from the default (20/×2):

```json
"ability": {
  "attack": "_default",
  "damage": "str",
  "critRange": 19,
  "critMult": 3
}
```

### Damage formula patterns

| Situation | Formula |
|-----------|---------|
| Standard die, size-scaled | `"sizeRoll(1, 6, @size)"` |
| Two dice | `"sizeRoll(2, 6, @size)"` |
| Ranged, cap negative Str | `"sizeRoll(1, 6, @size) + min(@abilities.str.mod, 0)[Strength]"` |

### Damage types

`"bludgeoning"`, `"piercing"`, `"slashing"` — or multiple: `["piercing", "slashing"]`

## Step 4 — Pack the Compendium

After creating or editing any source file:

```bash
npm run pack:equipments
```

This rebuilds `packs/equipments/` (LevelDB) from all JSON files in `packs/_source/equipments/`. Always run before committing.

## Implemented Weapons Reference

| Weapon | ID | Folder | Actions |
|--------|----|--------|---------|
| Quarterstaff | `QrtrstfSimpleA01` | Simple Weapons | mwak (main) + mwak (off-hand) |
| Throwing Spear | `ThrSpearSimpleB2` | Simple Weapons | twak (30 ft) + mwak (−4) |

## Weapon Icons

Icons live at `systems/pf1/icons/items/weapons/`. Some filenames use `.PNG` (uppercase), others `.png` — check the actual filename on disk before referencing. Common icons:

```
dagger.PNG       shortsword.PNG    longsword.PNG    greatsword.PNG
quarterstaff.png javelin.PNG       shortbow.PNG     longbow.PNG
spear.png        longspear.PNG     lance.PNG        club.PNG
handaxe.PNG      battleaxe.PNG     greataxe.PNG     morningstar.PNG
flail.PNG        heavyflail.PNG    warhammer.PNG    falchion.PNG
```
