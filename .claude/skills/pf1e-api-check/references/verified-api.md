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
- `CONFIG.PF1.weaponProficiencies` → `module/config.mjs:355` → `{ simple, martial, firearm, siege, heavy }` keyed by proficiency id, values are i18n keys. Passed as `weaponProf` to class/actor sheet templates. Adding a key here makes it appear as a checkbox in the "Weapon Proficiencies" dialog.
- `CONFIG.PF1.weaponTypes` → `module/config.mjs:2274` → outer keys are weapon category ids (`simple`, `martial`, `exotic`, `firearm`, …). Each entry `{ _label, light, "1h", "2h", ranged }`. `item-weapon.mjs:45` reads `weaponTypes[item.system.subType]._label` — if `system.subType` points to a missing key this throws. Must register a custom category here alongside `weaponProficiencies`.
- `actor.hasWeaponProficiency(item)` → `module/documents/actor/actor-pf.mjs:619` → checks `actor.system.traits.weaponProf.standard.has(item.subType)`. `item.subType` = `item.system.subType`. Proficiency granted when class/actor has the matching id in `traits.weaponProf.base`; ids in `weaponProficiencies` map go into `standard`, unknown ids go into `custom`.

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

## Roll-time change injection — `ItemChange.applyChange` & `changeOverrides`

- `Hooks.call("pf1PreAttackRoll", action, config, rollData, rollOptions, parts, changes)` →
  `module/components/action.mjs:1550`. Like the damage hook, `changes` is a mutable
  `ItemChange[]`; after the hook PF1e runs `changes.filter(c => { c.applyChange(actor); return c.operator !== "set"; })`
  then `getHighestChanges(..., { ignoreTarget: true })` and pushes `value[flavor]` parts
  (`action.mjs:1552-1568` attack, `1706-1718` damage). Because of `ignoreTarget: true`, the
  change's `target` is cosmetic at roll time — only its `value` matters.
- **`ItemChange#applyChange` short-circuits when the actor has no `changeOverride` for the
  target's flat path** → `module/components/change.mjs:355-370`: it does
  `const override = overrides[t]; … if (!override) continue;` BEFORE computing the value, so
  `this.value` stays at its prior/initial value (0 for a fresh change). `changeOverrides` is
  only seeded during data-prep change application; **deferred** targets like `attack`
  (→`system.attributes.attack.general`, `apply-changes.mjs:316`) and `damage`
  (→`system.attributes.damage.general`, `:556`) get NO override unless some other change
  already wrote there. ⇒ A change you build and inject at roll time will silently resolve to
  **0** if you rely on `applyChange` to evaluate its `formula`.
- **Fix / native pattern:** pre-compute the numeric value yourself and pass `value` in the
  `ItemChange` data (PF1e does exactly this for the enhancement-bonus change,
  `action.mjs:1684-1692`: `new ItemChange({ formula, operator:"add", target:"damage", type:"enh", value: this.enhancementBonus, … })`). Setting both a literal numeric `formula`
  AND `value` is robust either way: if an override happens to exist, the literal formula
  re-evaluates to the same number.
- `applyChange(actor, targets, { rollData })` defaults `rollData` to
  `this.parent?.getRollData({ refresh: true })` (`change.mjs:359`) — i.e. the change's
  **parent item** roll data, NOT the action's. So `@item.*` in a change formula resolves
  against the buff/item that owns the change; action-scoped vars like `@ablMult` are NOT
  available there. `rollData.ablMult` is set on the action roll data before the damage hook
  (`action.mjs:1642-1647`), so read it from the hook's `rollData` arg if you need it.
- A custom buff target NOT in any attack/damage context stack is filtered OUT of the per-roll
  `changes` array: `getContextChanges` does `actor.changes.filter(c => targets.has(c.target))`
  (`module/documents/item/item-pf.mjs:1915-1919`), and `getContextStack` only adds
  `attack`/`damage` for known sub-targets (`:1928-1951`). So read such changes directly off
  `action.item.actor.changes` and push retargeted copies — no double-counting risk.

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

## Combat / per-turn hooks & buff duration expiry

- `actor.expireActiveEffects({ combat, worldTime, timeOffset, event, initiative }, context)` →
  `module/documents/actor/actor-pf.mjs:253`. Filters `_effectsWithDuration` whose remaining
  duration ≤ 0 (rounds compared against `combat.round - startRound`), respects each buff's
  `system.duration.end` (`turnStart` / `turnEnd` / `initiative`), then sets expired **buffs**
  to `{ "system.active": false }` via `updateEmbeddedDocuments("Item", ...)`. It stamps
  `context.pf1.reason = "duration"` (`actor-pf.mjs:334`) — this is the exact signal
  naruto-d20's turn-maintenance hook listens for.
- Driver: `Combat._onUpdate` → `_onNewTurn` → `_processTurnStart` / `_processEndTurn`
  (`module/documents/combat.mjs:234,271,411,382`). `_processTurnStart` calls
  `expireActiveEffects({ event: "turnStart" })` for the **current** combatant only, and
  `_processEndTurn` calls it with `event: "turnEnd"` for the **previous** combatant.
- Both run **only on the actor's active owner client**: guarded by
  `actor.activeOwner?.isSelf` (`combat.mjs:387,416`). Skipped turns expire via
  `_handleSkippedTurns` on the active GM (`combat.mjs:343`).
- `_processTurnStart` also calls `actor.rechargeItems({ period: "round", exact: true })`
  (`combat.mjs:434`) — PF1e's native per-round item processing, a model for per-turn upkeep.
- **No `pf1CombatTurnStart`/`pf1CombatTurnEnd` hook exists.** The only PF1e combat hook is
  `Hooks.callAll("pf1CombatTurnSkip", combat, skippedSet, context)` (`combat.mjs:331`). For a
  per-turn trigger independent of buff expiry, listen to core Foundry `updateCombat` (check
  `changed.turn`/`changed.round`) or core `combatTurn`/`combatRound` hooks and read
  `combat.combatant.actor`.
- **`end: "turnStart"` cross-fires on "turnEnd" (BUG TRIGGER)** → `actor-pf.mjs:297-298`:
  `case "turnStart": if (remaining === 0 && !["turnStart","turnEnd"].includes(event)) return false;`
  When `remaining === 0`, this guard is bypassed for BOTH "turnStart" AND "turnEnd" events.
  Consequence: a 1-round buff with `end:"turnStart"` applied on the last combatant's turn
  expires in `_processEndTurn` (turnEnd, new world time, remaining=0) — not in the actor's
  own `_processTurnStart` in the next round. Use `units:"perm"` + manual tracking to avoid.
- **Round-based remaining** → `actor-pf.mjs:277-279`:
  `elapsed = combat.round - (startRound ?? 0)`, `remaining = (rounds - elapsed) * CONFIG.time.roundTime`.
  Rounds advance only at round boundaries; world time snapshots to new time in `_onUpdate:240`
  before `_onNewTurn` runs.

## Buff duration — `system.duration.units: "perm"`

- `"perm"` is a valid `system.duration.units` value → `module/config.mjs:1554` (`timePeriods`).
- `getDuration()` with `units:"perm"` + empty `value:""` → hits `if (!formula) return null`
  (`module/documents/item/item-buff.mjs:226`) → returns `null` → `createData.duration.seconds`
  is never set (`getRawEffectData:267`).
- `AE._hasDuration` → `module/documents/active-effect.mjs:74`:
  `return Number.isFinite(seconds ?? rounds ?? turns) && duration >= 0`. Without `seconds`/`rounds`
  this is `false` → perm-buff AEs are excluded from `_effectsWithDuration` entirely
  (`actor-base.mjs:143-148`) → PF1e never auto-expires them, regardless of `end` setting.
