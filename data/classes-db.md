# Classes DB — Field Reference

How to add classes and class features to `classes-db.json`.

---

## File structure

```
{
  "_meta":         { ... },      ← do not edit
  "classes":       [ ... ],      ← one entry per class
  "classFeatures": [ ... ]       ← one entry per class feature / ability
}
```

---

## Adding a class

Copy this block into the `classes` array and fill in the fields.

```json
{
  "_key": "my-class",
  "name": "My Class",
  "type": "class",
  "img":  "modules/naruto-d20/icons/class-my-class.webp",
  "system": {
    "description": { "value": "<p>HTML description.</p>" },
    "subType":       "base",
    "hd":            8,
    "hp":            8,
    "bab":           "med",
    "skillsPerLevel": 4,
    "savingThrows": {
      "fort": { "value": "low"  },
      "ref":  { "value": "high" },
      "will": { "value": "high" }
    },
    "fc": {
      "hp":    { "value": 1 },
      "skill": { "value": 0 },
      "alt":   { "value": 0, "notes": "" }
    },
    "wealth":        "3d6 × 10 gp",
    "alignment":     "",
    "classSkills":   {},
    "armorProf":     [],
    "weaponProf":    [],
    "changes":       [],
    "contextNotes":  [],
    "tags":          [],
    "flags":         { "boolean": {}, "dictionary": {} },
    "scriptCalls":   [],
    "links":         { "classAssociations": [] }
  },
  "progression": [
    { "level": 1, "features": ["feature-key-a", "feature-key-b"] },
    { "level": 2, "features": ["feature-key-c"] }
  ]
}
```

### Class fields

| Field | Type | Description |
|-------|------|-------------|
| `_key` | string | Unique slug for this file only. Used by `classFeatures._classes[]` and `progression[].features[]`. Never sent to Foundry. |
| `name` | string | Display name shown in Foundry. |
| `img` | string | Path to icon. Use `modules/naruto-d20/icons/` or `systems/pf1/icons/`. |
| `system.subType` | string | `"base"` · `"prestige"` · `"npc"` · `"racial"` · `"mythic"` |
| `system.hd` | number | Hit die size: `6`, `8`, `10`, or `12`. |
| `system.hp` | number | HP granted at level 1. Usually equals `hd`. |
| `system.bab` | string | Base attack bonus progression: `"low"` (½) · `"med"` (¾) · `"high"` (1×) |
| `system.skillsPerLevel` | number | Skill points per level before Int modifier. |
| `system.savingThrows.*.value` | string | `"low"` or `"high"` for each of `fort`, `ref`, `will`. |
| `system.fc` | object | Favored class bonus. `hp.value 1` = grants +1 HP per level; `skill.value 1` = +1 skill point; `alt` = alternate bonus with a text note. |
| `system.wealth` | string | Starting wealth formula, e.g. `"3d6 × 10 gp"`. Leave `""` to skip. |
| `system.alignment` | string | Suggested alignment note (free text). |
| `system.classSkills` | object | Map of skill keys to `true`. See **Skill keys** below. |
| `system.armorProf` | array | Armor proficiencies, e.g. `["light", "medium", "shields"]`. |
| `system.weaponProf` | array | Weapon proficiencies, e.g. `["simple", "martial"]`. |
| `system.changes` | array | PF1e changes engine bonuses applied at all levels. See **Changes** below. |
| `system.tags` | array | Arbitrary string tags for filtering. |
| `progression` | array | Level-by-level feature grant table. See **Progression** below. |

### Progression table

```json
"progression": [
  { "level": 1, "features": ["chakra-pool", "bonus-feat"] },
  { "level": 2, "features": ["evasion"] }
]
```

- `level` — the class level at which features are granted (1–20).
- `features` — array of `_key` values from the `classFeatures` array.
- A feature key can appear more than once across different levels (e.g. `"bonus-feat"` granted at levels 1, 3, 5 …).

### Skill keys

**PF1e standard skills**

| Key | Skill |
|-----|-------|
| `acr` | Acrobatics |
| `appraise` | Appraise |
| `blf` | Bluff |
| `clm` | Climb |
| `crf` | Craft |
| `dip` | Diplomacy |
| `dev` | Disable Device |
| `dis` | Disguise |
| `esc` | Escape Artist |
| `fly` | Fly |
| `han` | Handle Animal |
| `hea` | Heal |
| `int` | Intimidate |
| `kna` | Knowledge (Arcana) |
| `kne` | Knowledge (Engineering) |
| `kng` | Knowledge (Geography) |
| `knh` | Knowledge (History) |
| `kni` | Knowledge (Local) |
| `knl` | Knowledge (Local) |
| `knm` | Knowledge (Nature) |
| `knp` | Knowledge (Planes) |
| `knr` | Knowledge (Religion) |
| `lin` | Linguistics |
| `lor` | Lore |
| `per` | Perception |
| `pro` | Profession |
| `rid` | Ride |
| `sen` | Sense Motive |
| `slt` | Sleight of Hand |
| `spl` | Spellcraft |
| `ste` | Stealth |
| `sur` | Survival |
| `swm` | Swim |
| `umd` | Use Magic Device |

**Naruto D20 custom skills**

| Key | Skill | Default ability |
|-----|-------|-----------------|
| `ckc` | Chakra Control | Wis |
| `fui` | Fuinjutsu | Int |
| `gnj` | Genjutsu | Cha |
| `nin` | Ninjutsu | Int |
| `tai` | Taijutsu | Str |

---

## Adding a class feature

Copy this block into the `classFeatures` array and fill in the fields.

```json
{
  "_key":     "my-feature",
  "_classes": ["my-class"],
  "_level":   1,
  "name": "My Feature",
  "type": "feat",
  "img":  "modules/naruto-d20/icons/feat-my-feature.webp",
  "system": {
    "description": { "value": "<p>HTML description.</p>" },
    "subType":       "classFeature",
    "traitType":     "class feature",
    "traitCategory": "general",
    "abilityType":   "ex",
    "associations":  { "classes": [] },
    "showInQuickbar": false,
    "crOffset":  "",
    "inherited": false,
    "acquired":  false,
    "simple":    false,
    "summons":   false,
    "disabled":  false,
    "classSkills": {},
    "changes":       [],
    "contextNotes":  [],
    "tags":          [],
    "flags":         { "boolean": {}, "dictionary": {} },
    "scriptCalls":   [],
    "links":         { "charges": [], "children": [] },
    "uses": {
      "value": null,
      "per": "",
      "autoDeductChargesCost": "",
      "maxFormula": "",
      "rechargeFormula": ""
    }
  }
}
```

### Class feature fields

| Field | Type | Description |
|-------|------|-------------|
| `_key` | string | Unique slug for this file. Referenced by `progression[].features[]`. Never sent to Foundry. |
| `_classes` | array | List of class `_key` values that grant this feature. The import macro uses this only for reference; the actual link is built from the class `progression` table. |
| `_level` | number | The level at which this feature is first granted. Used only for reference; the `progression` table is authoritative. |
| `name` | string | Display name. |
| `system.subType` | string | Always `"classFeature"` for class features. Use `"feat"` for normal feats. |
| `system.traitType` | string | Label shown in the feat browser. Typically `"class feature"`. |
| `system.traitCategory` | string | Sub-label for grouping, e.g. `"chakra"`, `"techniques"`, `"defensive"`. |
| `system.abilityType` | string | `"na"` · `"ex"` (extraordinary) · `"su"` (supernatural) · `"sp"` (spell-like) |
| `system.showInQuickbar` | boolean | `true` to pin the feature to the actor's quickbar. Use for actively-used abilities. |
| `system.disabled` | boolean | `true` to make the feature inactive by default (useful for conditional abilities). |
| `system.uses` | object | Charges / per-day limit. See **Uses** below. |
| `system.changes` | array | Bonuses applied while the feature is owned. See **Changes** below. |
| `system.contextNotes` | array | Situational notes shown on saving throw / skill roll dialogs. See **Context notes** below. |
| `system.tags` | array | Arbitrary string tags. |

### Uses (limited-use features)

```json
"uses": {
  "value":                  1,
  "per":                    "day",
  "autoDeductChargesCost":  "1",
  "maxFormula":             "1",
  "rechargeFormula":        ""
}
```

| `per` value | Meaning |
|-------------|---------|
| `""` | Unlimited / not tracked. Set `value` to `null`. |
| `"day"` | Resets after a full rest. |
| `"week"` | Resets weekly. |
| `"charges"` | Manual charge pool. |
| `"round"` | Resets each round (rare). |

`maxFormula` supports dice formulas and actor data paths, e.g. `"3 + @abilities.wis.mod"`.

---

## Changes (buff engine)

Use `system.changes` on a class or feature to apply passive bonuses to the actor while the item is owned.

```json
"changes": [
  {
    "formula":    "5",
    "operator":   "add",
    "target":     "chakraPool",
    "type":       "untyped",
    "priority":   0,
    "continuous": false
  }
]
```

| Field | Options | Description |
|-------|---------|-------------|
| `formula` | string / number | Dice formula or actor data path, e.g. `"@details.level.value + @abilities.wis.mod"` |
| `operator` | `"add"` · `"set"` · `"script"` | `"add"` stacks; `"set"` overrides. |
| `target` | string | Where the bonus is written. See **Buff targets** below. |
| `type` | string | Bonus type. Same-type bonuses don't stack. See **Bonus types** below. |
| `priority` | number | Higher values apply later. Default `0`. |
| `continuous` | boolean | `true` = recalculate every turn (for formulas with volatile inputs). |

### Buff targets

**Naruto D20 custom targets**

| Target key | What it modifies |
|------------|------------------|
| `chakraPool` | `flags["naruto-d20"].chakra.pool.maxBonus` |
| `chakraReserve` | `flags["naruto-d20"].chakra.reserve.maxBonus` |
| `learnCkc` | Chakra Control learn check bonus |
| `learnFui` | Fuinjutsu learn check bonus |
| `learnGnj` | Genjutsu learn check bonus |
| `learnNin` | Ninjutsu learn check bonus |
| `learnTai` | Taijutsu learn check bonus |

**Common PF1e standard targets**

| Target key | What it modifies |
|------------|------------------|
| `ac` | Armor Class |
| `aac` · `sac` · `nac` | Armored / Shield / Natural AC |
| `attack` | All attack rolls |
| `mattack` · `rattack` | Melee / ranged attack |
| `damage` | All damage rolls |
| `allSavingThrows` | Fort + Ref + Will |
| `fort` · `ref` · `will` | Individual saving throws |
| `skills` | All skill checks |
| `skill.ckc` | Chakra Control skill check |
| `skill.nin` · `skill.tai` · etc. | Individual skill check |
| `bab` | Base attack bonus |
| `cmb` · `cmd` | Combat maneuver bonus / defense |
| `init` | Initiative |
| `hp` | Maximum hit points |
| `spd` | Movement speed |

### Bonus types

Same-type bonuses do **not** stack — only the highest applies.

| Type | Notes |
|------|-------|
| `"untyped"` | Always stacks. Use when unsure. |
| `"base"` | Base value (written before other bonuses). |
| `"enh"` | Enhancement bonus. |
| `"dodge"` | Dodge bonus (always stacks). |
| `"morale"` | Morale bonus. |
| `"insight"` | Insight bonus. |
| `"sacred"` · `"profane"` | Divine bonuses. |
| `"luck"` | Luck bonus. |
| `"competence"` | Competence bonus. |
| `"circumstance"` | Circumstance bonus. |
| `"size"` | Size modifier. |
| `"trait"` | Trait bonus. |

---

## Context notes

Context notes appear as reminders in the PF1e roll dialog (e.g. "Evasion active — take no damage on successful Reflex save").

```json
"contextNotes": [
  {
    "text":      "Evasion: take no damage on successful Reflex save",
    "target":    "savingThrow",
    "subTarget": "ref",
    "type":      ""
  }
]
```

| `target` | `subTarget` options |
|----------|---------------------|
| `"savingThrow"` | `"fort"` · `"ref"` · `"will"` · `"allSavingThrows"` |
| `"skill"` | skill key, e.g. `"ckc"`, `"per"` |
| `"attack"` | `"attack"` · `"mattack"` · `"rattack"` |
| `"damage"` | `"damage"` |
| `"effect"` | (free text note shown on item use) |

---

## Import workflow

1. **Edit `classes-db.json`** — add classes and features following this guide.
2. **Reload Foundry** (`F5`) so the updated JSON is served by the module.
3. **Open the Macro editor** → create a new Script macro → paste the contents of `import-classes.mjs`.
4. **Run the macro as GM**. It upserts documents — safe to run multiple times.
5. Check the **Naruto Classes** and **Naruto Class Abilities** compendium packs.

> **Note:** These packs are not currently shipped in the public release manifest. If you want
> to run this import flow locally, first add `classes` and `class-abilities` back to
> `module.json` and create the corresponding `packs/` directories in your working copy.
