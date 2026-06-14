# Design: Real-duration maintenance buffs with per-turn upkeep

Date: 2026-06-14
Status: Approved (design); implementation plan pending
Branch: `feat-real-duration-upkeep`

## Problem

Maintenance techniques (Kai-Mon, Sei-Mon, Kyu-Mon, Champuru stances, maintained ranks)
currently force their buff duration to **1 round** so the buff expires every turn. The
expiry event (`updateItem` with `options.pf1.reason === "duration"`) is the *only* trigger
for upkeep, so a 1-round duration is the only way to make upkeep fire each turn.

Consequences:

- The buff visibly "blinks" (deactivate → reactivate) each round.
- The ficha/buff card never shows the technique's real remaining duration.
- One-shot grants (Sei-Mon's `+8` temporary chakra) needed a manual workaround
  (`flags.naruto-d20.temporaryChakra.remaining` tracking) because the changes-engine target
  `temporaryChakra` (→ `chakra.pool.tempBonus`) is reset to 0 every `prepareBaseData` and only
  re-applied while the buff is active.
- Techniques with a real "1r/level (D)" duration never end on their own — they run until the
  cost can't be paid or the encounter ends.

## Goal

Decouple the upkeep trigger from buff expiry so a maintenance buff can carry its **real
multi-round duration** and still take per-turn upkeep. When the real duration runs out, the
technique **ends automatically** (teardown: fatigued, delete, cleanup).

### Decisions (from brainstorming)

1. **End of real duration → auto-end** (teardown). This is the literal book behavior
   (`1r/level (D)`) and is an intentional behavior change from "runs until you can't pay".
2. **Scope: techniques whose duration resolves to a finite round count** (Gates). Stances with
   no fixed duration (Champuru mode) and indefinitely-maintained ranks stay on the current
   model. The model is decided automatically per technique.
3. **Sei-Mon temp-chakra workaround stays as-is** (separate future cleanup). This redesign must
   **not break** it.

## Verified PF1e v11.11 facts (grounding)

Recorded in `.claude/skills/pf1e-api-check/references/verified-api.md`:

- `actor.expireActiveEffects({ event, ... }, context)` (`module/documents/actor/actor-pf.mjs:253`)
  filters effects whose remaining duration ≤ 0, respects each buff's `system.duration.end`
  (`turnStart`/`turnEnd`/`initiative`), sets expired buffs to `{ "system.active": false }`, and
  stamps `context.pf1.reason = "duration"` (`actor-pf.mjs:334`).
- Driver: `Combat._onUpdate` → `_onNewTurn` → `_processTurnStart`/`_processEndTurn`
  (`module/documents/combat.mjs:234,271,411,382`). `_processTurnStart` expires the **current**
  combatant's effects (`event:"turnStart"`); `_processEndTurn` the **previous** combatant's
  (`event:"turnEnd"`). Both run only on `actor.activeOwner?.isSelf` (`combat.mjs:387,416`).
  It also calls `actor.rechargeItems({ period: "round", exact: true })` (`combat.mjs:434`).
- **No `pf1CombatTurnStart` hook exists.** Only `pf1CombatTurnSkip` (`combat.mjs:331`). The
  idiomatic per-turn trigger is the core Foundry `updateCombat` (inspect `changed.turn`/
  `changed.round`) reading `combat.combatant.actor`.

## Chosen approach: per-turn `updateCombat` trigger, buff keeps real duration

One trigger today does two jobs. Split into two:

| Trigger | Hook | Role |
|---|---|---|
| **Upkeep tick** | `updateCombat` (new) | On owner's turn start, charge cost + apply benefits. Does **not** recreate or deactivate the buff. |
| **End of technique** | `updateItem`, `reason:"duration"` (existing) | Real duration ran out → **teardown** (fatigued, delete, cleanup). |

A maintenance buff is tagged with `maintenanceBuff.model`:

- `"duration"` — finite-duration technique (Gates). New behavior.
- `"toggle"` — stance/indefinite rank. **Current behavior fully preserved** — `updateCombat`
  ignores it; `updateItem` keeps doing upkeep+refresh as today.

Rejected alternatives:

- **B — keep toggle but track real rounds in a flag.** Keeps the flicker and per-round
  recreation, so the Sei-Mon workaround stays necessary. Treats a symptom, not the cause.
- **C — separate Active Effect for the tick.** Two documents per technique, duplicated expiry
  logic, no advantage over the chosen approach.

## Duration source

The technique's real duration comes from the **action's structured `duration`**, resolved with
`@cl` → character level (reusing the logic in `resolveBuffDurationFromAction`):

```
action.duration = { units: "round", value: "@cl" }  → finite → model "duration"
action.duration = { units: "inst"|"perm"|... }       → not finite → model "toggle"
```

**Decision rule (per technique, automatic):** if `automation.maintenance.enabled` **and** the
action `duration` resolves to `units:"round"` with a finite `value > 0` → model `"duration"`;
otherwise `"toggle"`.

**Concept separation made explicit:**

- `maintenance.interval` = how often **upkeep** fires (every N rounds; Gates = 1).
- action duration = **total rounds** the technique lasts before teardown.

Today both are conflated in `maintenanceBuffDuration(interval)`. In the `"duration"` model the
buff is created with `value = resolved total rounds`, not the interval.

### Data fixes (part of this work)

Audit `packs/_source/techniques/*` with `automation.maintenance.enabled` and fix action
durations of finite-duration Gates whose data doesn't reflect the book:

- **Sei-Mon** (`rr5ej5Vyiy2U4q7w`): action `duration` is `{ units: "inst" }` and
  `system.duration` is `""`. Book: "As Kai-mon Kai, except…" → `1r/level`. Fix action duration
  to `{ units: "round", value: "@cl" }`.
- **Kyu-Mon** (`8PfCntX00bnLgvtE`): verify and fix if needed.
- **Kai-Mon** (`LK2D9Wq8YIgih9Ms`): already correct (`{ units: "round", value: "@cl" }`).

## Upkeep tick vs teardown — ordering and edge cases

On the owner's turn start, both PF1e's expiry processing (`_processTurnStart` →
`expireActiveEffects`) and our `updateCombat` handler run. The order between core Foundry's
`updateCombat` hook and PF1e's internal `_onNewTurn` is **not guaranteed**, so the tick must
**not** depend on whether PF1e has already flipped `active` to `false`.

Instead, the tick computes remaining duration itself (the same arithmetic PF1e uses:
`remaining = totalRounds - (combat.round - startRound)`):

- **remaining > 0 after this turn** → run **upkeep** (charge cost, apply benefits); buff stays.
- **remaining ≤ 0** (this is the ending turn) → charge **nothing**; let teardown handle the end.

Teardown itself is driven by the existing `updateItem`/`reason:"duration"` handler whenever
PF1e fires it (this turn or next). Because the tick is gated on its own remaining-rounds
calc rather than on `active`, the two handlers cannot double-charge or race regardless of which
fires first.

Example — Kai-Mon level 5 (5 rounds), opened round 1: upkeep damage fires at the start of the
owner's turns in rounds 2–5; round 6 (duration hits zero) ends the technique with fatigued, no
damage charged on the ending turn. Matches "while the technique lasts".

Edge cases:

- **Cannot pay cost** (HP would drop < 1, or insufficient chakra): teardown immediately in the
  tick, before natural end (same as today).
- **Skipped turns** (`pf1CombatTurnSkip` / multi-round advance): charge upkeep **once per
  effective owner turn**, ignore skips. Simple and predictable.
- **Out of combat**: no turns → no upkeep and no natural expiry (identical to current
  behavior). Buff stays active until combat resumes or it's removed manually.
- **Idempotency**: guard `(actorUuid, buffId, round)` so the tick charges once per owner round.
- **Owner client only**: mirror PF1e's `actor.activeOwner?.isSelf` guard.
- **`"toggle"` model**: `updateCombat` ignores these; they remain entirely on the current
  `updateItem` flow.

## Files & changes

| File | Change |
|---|---|
| `scripts/automation/maintenance-buffs.mjs` | Add `resolveMaintenanceModel(item, action)` → `"duration"`\|`"toggle"`. Add `maintenanceBuffRealDuration(action, actor)` (resolves `@cl`). `maintenanceBuffFlagData` writes `model` and, in duration model, `interval`. |
| `scripts/automation/buff-application.mjs` | `applyUpkeepBuff`/`applyModeBuff`: in `"duration"` model, create the buff **once** with the real resolved duration (not `maintenanceBuffDuration(interval)`); tag `model:"duration"`. Toggle model unchanged. |
| `scripts/automation/turn-maintenance.mjs` | New `Hooks.on("updateCombat", …)` → `runTurnUpkeep(actor)` for active `model:"duration"` buffs (cost + benefits, **no** recreate). `updateItem`/`reason:"duration"`: model `"duration"` → **teardown**; model `"toggle"` → current flow. Idempotency `(actorUuid, buffId, round)`; `activeOwner?.isSelf` guard. |
| `scripts/main.mjs` | Register the new hook in the `setup` [7] phase with the other automation hooks. |

**Teardown (duration model):** apply `fatigued` per the technique, delete the buff (the existing
`deleteItem` hook already clears `fastHealing`/temp chakra), notify. Reuses the end logic that
today lives on the "cannot pay" path.

**No actor migration:** `model` is derived at runtime on each application; buffs already active
in saved games follow the old flow until re-applied.

## Testing / QA

No build step → manual QA per `docs/manual-qa.md`:

- Kai-Mon lvl 5: lasts 5 rounds, damage on turns 2–5, ends round 6 with fatigued, no flicker.
- Cannot pay HP → ends early.
- Sei-Mon: real duration + temp-chakra workaround **intact** (granted once, cleared on teardown).
- Champuru / maintained ranks (toggle): behavior identical to current.
- Out of combat: buff persists with no upkeep.
- Skipped turns: charged once per owner turn.

## Out of scope

- Removing the Sei-Mon temp-chakra workaround (separate future PR).
- Changing stance/rank (toggle) maintenance behavior.
