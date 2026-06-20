# Adding Weapons to the Equipments Compendium

This document describes how to add new weapon categories and items to the `equipments` compendium (`packs/_source/equipments/`). Follow this pattern for every new weapon category (Nin Weapons, Martial Weapons, etc.).

## Current Folder Hierarchy

```
equipments compendium
├── General Equipments  [EqpGenEqmntFld01]
│   └── Ninja Tools     [EqpNnjTlsFoldr02]
│       └── (training weight items)
└── Weapons             [WpnFolderAAA0001]
    ├── Simple Weapons  [SmpWpnFolderB002]
    │   ├── Quarterstaff
    │   └── Throwing Spear
    └── Nin Weapons     [NnjWpnFolderC003]
        ├── Battle Wire, Battle Wire (Long)
        ├── Blowgun + Darts
        ├── Chakra Gauntlets, Chisa-gatana, Daikunai
        ├── Fuuma Shuriken, Garrote Wire, Hand Crossbow + Bolts
        ├── Kama, Knuckle Blade, Kodachi
        ├── Kunai, Kunai (Curved), Kusari-Gama
        ├── Ninja-to / Chokuto, Nunchaku, Shuriken
        └── Sword-Cane, Tessen, Throwing Knife, Throwing Needle
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
| `NnjWpnFolderC003` | Nin Weapons |

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
| `"ninWeapons"` | Nin Weapon — custom type registered via `CONFIG.PF1.weaponTypes.ninWeapons`; proficiency granted when the class has `ninWeapons` in `actor.system.traits.weaponProf.standard` |

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

### Simple Weapons

| Weapon | ID | Actions |
|--------|----|---------|
| Quarterstaff | `QrtrstfSimpleA01` | mwak (main) + mwak (off-hand) |
| Throwing Spear | `ThrSpearSimpleB2` | twak (30 ft) + mwak (−4) |

### Nin Weapons (folder `NnjWpnFolderC003`, all `subType: "ninWeapons"`, `weaponGroups: ["ninWeapons", ...]`)

| Weapon | ID | Actions |
|--------|----|---------|
| Battle Wire | `NnjWpnBtWr000001` | rwak (10 ft, max 30 ft) |
| Battle Wire, Long | `NnjWpnBtWrL00002` | rwak (10 ft, max 40 ft) |
| Blowgun | `NnjWpnBlwgn00003` | rwak (10 ft, fixed 1 dmg) |
| Darts | `NnjWpnDarts00004` | — (ammo, qty 5) |
| Chakra Gauntlets | `NnjWpnChGntl0005` | — (modifies unarmed) |
| Chisa-gatana | `NnjWpnChGtn00006` | mwak (1d6 S, 19–20) |
| Daikunai | `NnjWpnDaikn00007` | mwak (1d8 P, 19–20) |
| Fuuma Shuriken | `NnjWpnFuShr00008` | twak (10 ft) + mwak collapsed (−4) |
| Garrote Wire | `NnjWpnGrrWr00009` | — (grapple only) |
| Hand Crossbow | `NnjWpnHndCb00010` | rwak (30 ft) |
| Bolts | `NnjWpnBolts00011` | — (ammo, qty 20) |
| Kama | `NnjWpnKama000012` | mwak (1d6 S) |
| Knuckle Blade | `NnjWpnKnBld00013` | — (modifies unarmed) |
| Kodachi | `NnjWpnKodch00014` | mwak (1d6 S) |
| Kunai | `NnjWpnKunai00015` | twak (10 ft) + mwak; qty 5 |
| Kunai, Curved | `NnjWpnKnaiCv0016` | twak (5 ft, −2) + mwak; 18–20 |
| Kusari-Gama | `NnjWpnKsrGm00017` | mwak kama (S) + mwak chain (B); double |
| Ninja-to / Chokuto | `NnjWpnNnjTo00018` | mwak (1d8 S, 19–20) |
| Nunchaku | `NnjWpnNnchk00019` | mwak (1d6 B) |
| Shuriken | `NnjWpnShrkn00020` | twak (10 ft, 1d3); qty 5 |
| Sword-Cane | `NnjWpnSwdCn00021` | mwak (1d6 P, 18–20) |
| Tessen | `NnjWpnTssnN00022` | twak (10 ft) + mwak (1d4 B) |
| Throwing Knife | `NnjWpnThrKn00023` | twak (10 ft) + mwak (−4); qty 5 |
| Throwing Needle | `NnjWpnThrNd00024` | twak (10 ft, fixed 1 dmg); qty 10 |

### Archaic Weapons (folder `ArcWpnFolderD004`)

| Weapon | ID | subType | Actions |
|--------|----|---------|---------|
| Battleaxe | `ArcWpnBtAxe00001` | martial | mwak (1d8 S, ×3) |
| Dagger | `ArcWpnDgger00002` | simple | mwak (1d4 P, 19–20) + twak (10 ft) |
| Daikyuu | `ArcWpnDaiky00003` | exotic | rwak (120 ft, 1d8+min(Str,4) P, ×3) |
| Arrows (20) | `ArcWpnArrow00004` | — | ammo, qty 20 |
| Fullblade | `ArcWpnFllBl00005` | exotic | mwak (2d8 S, 19–20); 2h; −2 penalty without EWP |
| Greatbow | `ArcWpnGrtBw00006` | exotic | rwak (80 ft, 1d10+Str P, ×3) |
| Greathammer | `ArcWpnGrtHm00007` | martial | mwak (1d12 B, ×3); 2h |
| Greatsword | `ArcWpnGrtSw00008` | martial | mwak (2d6 S, 19–20); 2h |
| Hankyuu | `ArcWpnHnkyu00009` | exotic | rwak (100 ft, 1d6 P, ×3); no Str to damage |
| Kanabo | `ArcWpnKanbo00010` | martial | mwak (1d12 B, ×3); 2h |
| Katana | `ArcWpnKatan00011` | exotic | mwak (1d10 S, 19–20); 2h (1h with EWP) |
| Kodachi | `ArcWpnKodch00012` | martial | mwak (1d6 S) |
| Large Katana | `ArcWpnLgKtn00013` | martial | mwak (2d6 S, 19–20); 2h |
| Longsword | `ArcWpnLngsw00014` | martial | mwak (1d8 S, 19–20) |
| Naginata | `ArcWpnNgnta00015` | exotic | mwak (1d10 S, ×3); 2h; reach |
| Sabre | `ArcWpnSabre00016` | exotic | mwak (1d6 S, 18–20); +4 to resist disarm |
| Shortsword | `ArcWpnShtsw00017` | martial | mwak (1d6 P, 19–20) |
| Throwing Axe | `ArcWpnThrAx00018` | martial | twak (10 ft) + mwak (1d6 S) |
| Wakizashi | `ArcWpnWkzsh00019` | martial | mwak (1d6 S, 19–20) |
| War Fan | `ArcWpnWarFn00020` | exotic | twak (10 ft) + mwak (1d8 B) |
| Warhammer | `ArcWpnWrhmr00021` | martial | mwak (1d8 B, ×3) |

### Exotic Weapons (folder `ExcWpnFolderE005`)

> Fullblade and Katana are listed in Table 7-6 with `**` ("See Archaic Weapons") — they live in the Archaic Weapons folder.

| Weapon | ID | Actions |
|--------|----|---------|
| Daigama | `ExcWpnDaigm00001` | mwak (1d10 P/S, ×3); 2h; trip |
| Double Katana | `ExcWpnDblKt00002` | mwak (1d10 S, 18–20); 2h; Treat Injury DC +5 |
| Hansori | `ExcWpnHansr00003` | mwak blade (1d10 S, 19–20) + mwak chain (1d4 S, 19–20); 2h double |
| Hooksword | `ExcWpnHkSwd00004` | mwak (1d8 S, ×3); disarm + trip |
| Large Shuriken | `ExcWpnLgShrk0005` | twak (10 ft, 1d8 P/S, 19–20) + mwak (−4); qty 3 |
| Mancatcher | `ExcWpnMncth00006` | mwak (1d8 B); 2h; reach + trip |
| Scythe | `ExcWpnScyth00007` | mwak (2d4 P/S, ×4); 2h |
| Scythe, Hand | `ExcWpnHndSc00008` | mwak (1d10 P/S, ×3) |
| Shuko and Ashiko | `ExcWpnShkAs00009` | — (modifies unarmed: +1 P dmg, armed, lethal) |
| Spiked Greatmace | `ExcWpnSpGtm00010` | mwak (1d12 B/S, ×3); 2h |
| Two-bladed Sword | `ExcWpnTwBlS00011` | mwak ×2 (1d8 S each, 19–20); 2h double |

## Weapon Icons

Icons live at `systems/pf1/icons/items/weapons/`. Some filenames use `.PNG` (uppercase), others `.png` — check the actual filename on disk before referencing. Common icons:

```
dagger.PNG       shortsword.PNG    longsword.PNG    greatsword.PNG
quarterstaff.png javelin.PNG       shortbow.PNG     longbow.PNG
spear.png        longspear.PNG     lance.PNG        club.PNG
handaxe.PNG      battleaxe.PNG     greataxe.PNG     morningstar.PNG
flail.PNG        heavyflail.PNG    warhammer.PNG    falchion.PNG
```
