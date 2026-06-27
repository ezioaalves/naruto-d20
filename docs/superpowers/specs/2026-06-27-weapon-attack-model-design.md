# Weapon-attack automation → first-class `TechniqueDataModel` field

**Date:** 2026-06-27
**Status:** Approved (design)
**Branch:** continue on `docs/technique-weapon-automation-ui`. The weapon-attack UI
work this migration depends on (`weapon-attack-sheet.mjs`, the sheet/template
changes, the 139 compendium JSONs) lives entirely on that branch — 13 commits
ahead of `master`, **not yet merged**. Basing off `master` would lose it. The
whole branch (UI + this model migration) squash-merges into `master` as one
cohesive feature when complete; the intermediate dictionary-based commits are
flattened away by the squash.

## Problem

Technique weapon-attack automation config is stored in PF1e's generic
`system.flags.dictionary` — an `ObjectField` whose keys are literal strings
(`"weaponAttack.filter"`, `"weaponAttack.mode"`, …). Two shapes exist in the
wild:

- **Dotted keys** (139 compendium source JSONs): `"weaponAttack.mode": "selected"`,
  `"weaponAttack.filter": "unarmedOnly"`, …
- **Nested object** (written by the most recent UI fix): `weaponAttack: { mode, filter, … }`.

All values are strings, including booleans (`"true"`/`"false"`), the
extra-attacks list (`"formula|name;formula|name"`), and the suppression set
(`"naturalAttack,abilityDamage"`).

Writing this field through `item.update()` collides with Foundry's
`expandObject`/`mergeObject` path-splitting: dotted keys are interpreted as
nested paths, and `mergeObject` merges rather than replaces, so keys absent from
the new value survive. Commit `25d814dd` worked around this with `-=key`
deletion markers inside the update object, but the document still lands in an
inconsistent state — the reported "a single change resets the whole sheet" bug.
Each fix has revealed another layer of the same root cause: `flags.dictionary`
is the wrong storage mechanism for a structured, first-class field.

## Goal

Move the config to a typed `SchemaField` at `system.weaponAttack` on
`TechniqueDataModel`. This makes the sheet form bind natively
(`name="system.weaponAttack.filter"`), makes updates plain atomic writes (no
deletion markers, no merge surprises), lets the schema enforce enums, and
removes the entire write-fragility class.

Non-goals: no change to the weapon-attack *runtime* behaviour (selection dialog,
roll injection, damage replacement, suppression, element/empower handling) — only
where the config is **stored and read**. The roll machinery is preserved as-is.

## New schema — `system.weaponAttack` (SchemaField)

Added to `TechniqueDataModel.defineSchema()`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `enabled` | BooleanField | `false` | Replaces the old `mode: "selected"` gate. |
| `filter` | StringField, `choices: ["meleeWeapon","rangedWeapon","unarmedOnly","meleeOrUnarmed"]`, `blank:false` | `"meleeWeapon"` | |
| `damageMode` | StringField, `choices: ["add","replace"]`, `blank:false` | `"add"` | |
| `held` | StringField, `choices: ["","onehanded","twohanded"]`, `blank:true` | `""` | |
| `charge` | BooleanField | `false` | Was string `"true"`. |
| `iteratives` | BooleanField | `true` | Was string `"false"`; default true. |
| `attackBonus` | StringField, `blank:true` | `""` | Free-text roll formula (unchanged semantics). |
| `damageBonus` | StringField, `blank:true` | `""` | |
| `nonCritDamageBonus` | StringField, `blank:true` | `""` | |
| `extraAttacks` | ArrayField(SchemaField `{ formula: StringField{blank:true}, name: StringField{blank:true} }`) | `[]` | Was csv `"f\|n;f\|n"`. Structured. |
| `suppressNaturalAttack` | BooleanField | `false` | Was a token in the csv `suppressedBonuses`. |
| `suppressAbilityDamage` | BooleanField | `false` | Was a token in the csv `suppressedBonuses`. |

Use the same `opt = { required: false }` style as the rest of the model. Wrap in
a top-level `weaponAttack: new fields.SchemaField({ … }, opt)`.

**Dropped fields:** `mode` (always `"selected"`, folded into `enabled`),
`suppressedBonuses` (csv → two booleans).

### Runtime config shape (unchanged contract)

`getTechniqueWeaponAttackConfig(item)` still returns the same object the roll
machinery consumes today:

```js
{
  filter, damageMode,
  attackBonus, damageBonus, nonCritDamageBonus,
  extraAttacks: [{ formula, name }],     // already structured in the schema
  held, charge: Boolean, iteratives: Boolean,
  suppressedBonuses: string[],           // built from the two booleans
}
```

`mode` is no longer part of the returned config (no consumer reads it).

## Migration — three vectors

### 1. `TechniqueDataModel.migrateData(source)` — in-memory, the single legacy fallback

Add a block that runs when `source.weaponAttack` is absent/empty **and**
`source.flags?.dictionary` carries `weaponAttack` (nested object) or
`weaponAttack.*` (dotted) keys. It:

- builds `source.weaponAttack` from those keys, preferring the nested object over
  dotted keys when both exist (matches the current `readWeaponAttackRaw`
  precedence);
- coerces `"true"/"false"` → Boolean for `charge`; `iteratives` is `false` only
  when the stored string is `"false"`, else `true`;
- sets `enabled = (mode === "selected")` (any legacy presence of weaponAttack
  keys with `mode:"selected"` ⇒ enabled);
- parses the extra-attacks string (`split(";")`, then `split("|")` → `{formula,
  name}`, dropping entries with empty formula) into the array;
- splits the suppression csv into `suppressNaturalAttack` /
  `suppressAbilityDamage` booleans (unknown tokens ignored);
- coerces invalid enum values to the schema default (defensive; the schema would
  otherwise reject them);
- deletes `weaponAttack` and every `weaponAttack.*` key from
  `source.flags.dictionary`.

Idempotent: after it runs (or on already-typed data) there are no dictionary
weaponAttack keys, so a second pass is a no-op. Because `migrateData` runs on
every document instantiation (world, compendium, embedded), **all** old data
works at runtime immediately — even before it is persisted.

Place this logic in a **dedicated, dependency-free module**
`scripts/features/techniques/weapon-attack-migrate.mjs` exporting
`migrateLegacyWeaponAttack(source)`. It must import **no** Foundry/pf1 globals
(no `foundry.*`, no `pf1.*`) so the offline node compendium script (vector 2) and
the unit tests can import it directly. `model.mjs#migrateData`,
`ready.mjs` (vector 3), and `tools/migrate-weapon-attack.mjs` (vector 2) all call
this one helper, guaranteeing identical transforms.

### 2. Compendium source — 139 JSONs + rebuilt LevelDB

One-off node script under `tools/` (e.g. `tools/migrate-weapon-attack.mjs`) that
rewrites `packs/_source/techniques/*.json`: for each file with dictionary
`weaponAttack`/`weaponAttack.*` keys, write the typed `system.weaponAttack`
object and strip the dictionary keys. Then `npm run pack` rebuilds
`packs/techniques` (LevelDB). Commit both the rewritten source JSONs and the
rebuilt pack (matches the repo convention — built packs are committed). Do **not**
use `npm run unpack` (known duplicate-filename landmine).

The script should reuse the same transform as `migrateData` to guarantee parity.

### 3. `ready.mjs` — persist on already-embedded actor techniques

GM-only one-time pass (mirror the existing maintenance migration in
`scripts/data/maintenance-migration.mjs` + its `ready.mjs` call). For every
embedded technique whose `flags.dictionary` still holds weaponAttack keys,
**replace the whole `system` subtree** with the migrated copy — the
syncTechnique-proven pattern, which sidesteps all dotted-key-deletion fragility:

```js
const data = item.toObject();
migrateLegacyWeaponAttack(data.system); // adds system.weaponAttack, strips dict keys
await item.update({ system: data.system }, { diff: false, recursive: false });
```

`{ recursive: false }` with the complete `system` object replaces
`flags.dictionary` wholesale (no leftover keys survive — unlike a merge), and sets
the typed `system.weaponAttack`. Guard with a migration flag so it runs once.

> Correctness does **not** depend on this pass: `migrateData` (vector 1)
> neutralizes legacy keys at runtime, and `normalizeSystem` strips them for synckit
> (see Synckit section). This pass is the physical-cleanup belt to those
> suspenders. We deliberately avoid the `"system.flags.dictionary.-=weaponAttack.<key>"`
> surgical-deletion form: top-level update paths get `expandObject`-split on the
> dot in the literal key — the exact landmine behind the original bug.

## Code changes (file by file)

### `scripts/features/techniques/model.mjs`
- Add the `weaponAttack` SchemaField to `defineSchema()`.
- Add the legacy-migration block to `migrateData()` (or call the shared helper).

### `scripts/features/techniques/weapon-attack.mjs`
- Rewrite `getTechniqueWeaponAttackConfig(item)` to read `item.system.weaponAttack`;
  return `null` unless `enabled === true`; build the runtime config (extraAttacks
  already structured; `suppressedBonuses` assembled from the two booleans).
- **Delete** `readWeaponAttackRaw`, `parseWeaponAttackConfig`,
  `reportWeaponAttackWarnings`, `formatWeaponAttackIssue`, `formatIssueTemplate`,
  `ISSUE_TEMPLATES`, `KNOWN_KEYS`, `SUPPORTED_MODES`, `SUPPORTED_FILTERS`,
  `SUPPORTED_DAMAGE_MODES`, `SUPPORTED_SUPPRESSED_BONUSES`, `CONFIG_PREFIX`, and
  related constants that only served dictionary parsing/validation. (Schema
  `choices` now enforce enums; formula fields are free text and were never
  validated.)
- **Keep unchanged:** `rollSelectedWeaponAttackWithTechnique` and everything it
  calls — `selectTechniqueWeaponAttack`, `collectTechniqueWeaponAttackChoices`,
  `addItemAttackChoices`, `renderWeaponAttackSelectorContent`, `escapeHTML`,
  `deriveAttackCategories`, `categoriesFromFilter`, `chooseExtraAttacksType`,
  `applyTechniqueBonusSuppressions`, `applyTechniqueElementDamageToActionUse`,
  `replaceActionDetails`, the chat-decoration and save helpers, etc.
- Optionally add/keep `DEFAULT_FILTER`/`DEFAULT_DAMAGE_MODE` if still referenced.

### `scripts/features/techniques/weapon-attack-migrate.mjs` (new, dependency-free)
- Export `migrateLegacyWeaponAttack(source)` implementing the vector-1 transform
  with no Foundry/pf1 imports. Shared by `model.mjs#migrateData`, `ready.mjs`, the
  offline `tools/migrate-weapon-attack.mjs`, and the unit tests.

### `scripts/features/techniques/sheet.mjs`
- In `_updateObject`: remove the entire `hasWeaponAttackFormData` block (dict
  build, `-=` markers, `removeSyntheticWeaponAttackFormFields`). Keep the
  existing `empower.damageTypes` split. Add a single conversion: if the synthetic
  textarea field (`weaponAttack-extraAttacksText`) is present, parse it into
  `formData["system.weaponAttack.extraAttacks"]` as an array of `{formula,name}`
  and delete the synthetic key.
- Remove the `WEAPON_ATTACK_REQUIRED_FORM_KEYS` constant and adjust
  `_onWeaponAttackPreset` to read/write the now-native sibling inputs (their
  `name` is `system.weaponAttack.*`), plus the synthetic textarea/preset names.
  The preset `<select>` stays client-side only; it does not persist.
- `getData`: replace `buildWeaponAttackFormData(item)` usage with a direct read of
  `system.weaponAttack` plus a computed `extraAttacksText` (array→text) for the
  textarea: `context.weaponAttack = { ...system.weaponAttack, extraAttacksText }`.
  Keep `context.weaponAttackSummary` and the `*Choices` context entries.

### `scripts/features/techniques/weapon-attack-sheet.mjs`
- **Delete:** `buildWeaponAttackDictionaryUpdates`, `weaponAttackFormDataFromForm`,
  `removeSyntheticWeaponAttackFormFields`, `WEAPON_ATTACK_FIELD_KEYS`,
  `DEFAULT_FORM_DATA`'s dictionary-reading path, and the
  `readWeaponAttackRaw`/`parseWeaponAttackConfig` import + `buildWeaponAttackFormData`
  (now trivial / inlined in the sheet).
- **Keep:** `WEAPON_ATTACK_FILTER_CHOICES`, `WEAPON_ATTACK_DAMAGE_MODE_CHOICES`,
  `WEAPON_ATTACK_HELD_CHOICES`, `WEAPON_ATTACK_PRESET_CHOICES`,
  `applyWeaponAttackPreset`, `buildWeaponAttackSummary` (and its `*Summary`
  helpers), `normalizeExtraAttacksText`.
- **Add:** `extraAttacksTextFromArray(array)` and
  `extraAttacksArrayFromText(text)` helpers (one source of truth for the text↔array
  conversion used by both the sheet getData and `_updateObject`).
- `buildWeaponAttackSummary` keeps consuming the form-data-shaped object; the sheet
  feeds it `context.weaponAttack` (now derived from the typed field), so its
  signature is unchanged.

### `templates/item/technique-sheet.hbs`
- Field `name="system.weaponAttack.*"` inputs already match the schema — keep.
- Change preset select `name="system.weaponAttack.preset"` → a non-system name
  (e.g. `name="weaponAttack-preset"`), since `preset` is not a schema field.
- Change extra-attacks textarea `name="system.weaponAttack.extraAttacksText"` → the
  synthetic name `name="weaponAttack-extraAttacksText"`, bound to
  `weaponAttack.extraAttacksText`.
- Remove the `weaponAttack.warnings` block (no warnings system anymore).
- Summary tags (lines ~281–283, ~540–542) unchanged.

### `scripts/features/techniques/defaults.mjs`
- In `applyTechniqueSystemDefaults`, add a `system.weaponAttack` default block that
  fills **every** schema field (`enabled`, `filter`, `damageMode`, `held`,
  `charge`, `iteratives`, `attackBonus`, `damageBonus`, `nonCritDamageBonus`,
  `extraAttacks`, `suppressNaturalAttack`, `suppressAbilityDamage`), so synckit
  normalization produces the same shape on both sides of a diff. Keep this in sync
  with the schema (a parity guard test enforces it).

### `scripts/lifecycle/ready.mjs` + `scripts/data/maintenance-migration.mjs`
- Add the GM-only embedded-technique migration (vector 3), gated by a migration
  flag, alongside the existing maintenance migration.

### `scripts/features/techniques/sync.mjs`
- In `normalizeSystem`, after the defaults pass, strip any residual
  `flags.dictionary.weaponAttack` / `weaponAttack.*` keys before diffing. This
  guarantees synckit parity even for actors a GM has not yet loaded (so vector 3
  has not run): the migrated source side has no dictionary keys, and the
  not-yet-physically-cleaned embedded side's leftover keys are ignored. Combined
  with the `applyTechniqueSystemDefaults` `weaponAttack` block, both diff sides
  reduce to the same typed shape.

### `lang/en.json`, `lang/pt-BR.json`
- Remove `NarutoD20.WeaponAttackIssues.*` and
  `NarutoD20.Notifications.WeaponAttackConfig`. Remove
  `NarutoD20.WeaponAttack.Warnings.*` if no longer referenced. Keep all field /
  summary / preset labels.

## Tests

- **`tests/helpers.test.mjs`** — replace the `weaponAttack parsing` describe block
  (which exercises `readWeaponAttackRaw` / `parseWeaponAttackConfig`) with:
  - `migrateLegacyWeaponAttack` tests: dotted-key legacy → typed object;
    nested-object legacy → typed; nested precedence over dotted; dictionary keys
    stripped; idempotent on already-typed data; string-bool and csv coercions.
  - a schema-parity guard ("backfills every `weaponAttack` field declared in the
    schema") mirroring the existing maintenance/empower guards.
- **`tests/weapon-attack-sheet.test.mjs`** — drop the
  `buildWeaponAttackDictionaryUpdates` and `weaponAttackFormDataFromForm` tests;
  add tests for `extraAttacksTextFromArray` / `extraAttacksArrayFromText` round
  trips, `applyWeaponAttackPreset`, and `buildWeaponAttackSummary` fed the typed
  shape.
- **`tests/technique-bonus-suppression.test.mjs`,
  `tests/weapon-attack-iteratives.test.mjs`,
  `tests/technique-damage-transform.test.mjs`** — update fixtures that build items
  with `flags.dictionary` weaponAttack data to instead set `system.weaponAttack`
  (and/or route through `migrateLegacyWeaponAttack` where they intend to exercise
  legacy data).
- **`tests/synckit*` / normalizeSystem coverage** — add a test that an embedded
  technique with leftover `flags.dictionary.weaponAttack*` keys and a migrated
  source (typed `system.weaponAttack`) diff as **equal** (no false out-of-date).
- Run `npm test`, `npm run lint`, and `npm run validate:compendia` green.

## Acceptance criteria

1. A technique's weapon-attack config is stored at `item.system.weaponAttack` (a
   typed object), never in `flags.dictionary`.
2. Editing one weapon-attack field on the sheet persists only that change; no other
   field (weapon-attack or otherwise) is reset. Disabling clears `enabled` only;
   re-enabling restores the saved values.
3. Compendium techniques carry the typed shape in source JSON and in the built
   pack; importing one onto an actor yields working weapon-attack automation.
4. A pre-existing actor technique created before this change (dictionary data) is
   migrated automatically: it works at runtime immediately (via `migrateData`) and
   is physically cleaned on the GM `ready` pass.
5. The weapon-attack roll flow (selection dialog, attack/damage bonuses, replace
   mode + element damage, suppression, extra attacks, charge, held, iteratives,
   empower) behaves exactly as before.
6. Synckit reports a migrated technique as up-to-date against its (migrated)
   compendium source — no false "out of date".
7. `npm test`, `npm run lint`, `npm run validate:compendia` pass.

## Risks / notes

- **Synckit parity** — the schema and `applyTechniqueSystemDefaults` must agree on
  the `weaponAttack` shape, or unedited techniques will be flagged out-of-date.
  `normalizeSystem` operates on `toObject().system` (raw — it does **not** run
  `migrateData`), so it must (a) get a `weaponAttack` default block in
  `applyTechniqueSystemDefaults` and (b) strip residual dictionary weaponAttack
  keys. The parity guard test enforces (a). (See the synckit-backfill convention
  used for `automation.maintenance`.)
- **Pack rebuild** — rebuild via `npm run pack` only; never `npm run unpack`
  (duplicate-filename landmine). Verify a couple of rewritten JSONs by eye before
  packing.
- **Enum coercion** — `migrateData` should coerce any unexpected legacy enum value
  to the schema default rather than letting `DataModel` validation drop the whole
  field.
