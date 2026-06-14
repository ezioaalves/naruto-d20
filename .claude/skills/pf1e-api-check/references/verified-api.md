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

## Damage types & damage-roll hook

- Core energy damage-type ids (the strings in `action.damage.parts[].types[]`):
  `fire`, `cold`, `electric` (note: `_id:"electric"` though its label is "electricity"),
  `acid`, `sonic` → `module/registry/damage-types.mjs:106-159`.
- Registry `register(namespace, id, value)` keys by the **bare** `id`, NOT
  `namespace.id` → `module/registry/base-registry.mjs:131`
  (`set(id, new model({...value, namespace, _id:id}))`); `namespace` is only used by
  `unregister`. So module-registered custom damage types are looked up bare — naruto-d20's
  are `earth`/`water`/`wind`/`holy` (NOT `naruto-d20.earth`). Confirmed by existing content:
  every technique stores bare ids in `types[]`.
- `Hooks.call("pf1PreDamageRoll", action, rollData, parts, changes)` →
  `module/components/action.mjs:1704`. `parts` is a mutable array; each entry is
  `{ base: <formula>, extra: [], damageType: <types array>, type }`
  (`action.mjs:1651-1659`). Mutate `parts` here to inject/retype damage at roll time without
  editing stored `item.system.actions`.

## Data models (`system.*`)

- `system.changes` is an `ArrayField` in v11.11 (NOT a `TypedObjectField` record —
  that's the dev branch). Source under `module/models/`.

## i18n (`"PF1.*"`)

- i18n keys are mostly **flat** in v11.11: use `PF1.Changes`, NOT `PF1.Changes.many`.
  Keys live in `lang/en.json`.

- `system.traits.fastHealing` → **string** field (default `""`), `public/template.json:717`.
  Display-only: rendered in the defenses chat card and exposed as the `@traits.fastHealing`
  rolldata path (`module/applications/actor/actor-sheet.mjs:1806`,
  `module/documents/actor/actor-pf.mjs:3528-3531`). PF1e does **NOT** auto-apply fast healing
  each round, and there is **no numeric buff change target** for it — to actually heal HP per
  round you must run your own turn hook. `system.traits.regen` is the analogous string field.
