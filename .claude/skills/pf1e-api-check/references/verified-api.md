# Verified PF1e v11.11 API facts

Auto-growing cache. Each entry was checked against the pinned source root
`/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11`.

**Entry format:** `` `symbol` → `path/under/source/root:line` → note ``
Append new verified facts under the matching section. Never add a guessed entry.

## Globals (`pf1.*`)

- `pf1.components.ItemChange` → `module/components/change.mjs:12` → real class. NOT
  `pf1.models.components.Change` (that path is dev-branch only).
- `pf1.applications.ActorSheetPFCharacter` → `module/applications/actor/character-sheet.mjs:9`
  (re-exported at `module/applications/actor/_module.mjs:2`). The actor sheet class
  is `ActorSheetPFCharacter`, NOT `pf1.applications.actor.CharacterSheetPF`.
- `pf1.dice.d20Roll` → `module/dice/d20roll.mjs:661` → `async function d20Roll(options = {})`.

## CONFIG.PF1

- `CONFIG.PF1.buffTargets` → `module/config.mjs:2623` → exported `buffTargets` const.

## Data models (`system.*`)

- `system.changes` is an `ArrayField` in v11.11 (NOT a `TypedObjectField` record —
  that's the dev branch). Source under `module/models/`.

## i18n (`"PF1.*"`)

- i18n keys are mostly **flat** in v11.11: use `PF1.Changes`, NOT `PF1.Changes.many`.
  Keys live in `lang/en.json`.
