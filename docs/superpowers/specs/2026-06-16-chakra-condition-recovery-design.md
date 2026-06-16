# Chakra Condition Recovery Design

## Goal

Bring Chakra condition automation closer to `chakra_recovery_og.md` for two rules:

- Low Reserve fatigue is delayed when Reserve falls below 50% during an encounter, unless it falls below 25%.
- Chakra Depletion is not removed merely because Reserve becomes greater than 0; it persists until Pool and Reserve are fully recovered, excluding temporary chakra.

## Current Behavior

`scripts/data/chakra-conditions.mjs` currently derives condition state directly from current Reserve:

- `reserve <= 0` applies `chakraDepletion` and `exhausted`.
- `0 < reserve < 50%` applies `lowReserves` and `fatigued`.
- `reserve > 0` removes `chakraDepletion`.

This handles the simple resource thresholds but cannot represent delayed fatigue or a Depletion state that persists after Reserve rises above 0.

## Desired Behavior

Low Reserve outside Chakra Depletion:

- Reserve `>= 50%`: no Low Reserve condition and no module-applied fatigue.
- Reserve `< 25%`: immediately applies Low Reserve and module-applied fatigue, even in combat.
- Reserve `>= 25%` and `< 50%` while not in a started combat: applies Low Reserve and module-applied fatigue.
- Reserve `>= 25%` and `< 50%` while in a started combat: marks Low Reserve fatigue as pending but does not apply `fatigued` until the encounter ends.
- At encounter end, any actor with pending Low Reserve fatigue is re-evaluated; if still below 50%, fatigue applies then.

Chakra Depletion:

- Depletion starts when Reserve reaches 0.
- Once active, Depletion persists until both `chakra.pool.value >= chakra.pool.max` and `chakra.reserve.value >= chakra.reserve.max`.
- Temporary chakra does not count toward full Pool recovery.
- While Depletion is active and Reserve is below 50%, the actor has `chakraDepletion` and module-applied `exhausted`.
- While Depletion is active and Reserve is at or above 50% but not fully recovered, the actor still has `chakraDepletion`, but module-applied `exhausted` downgrades to module-applied `fatigued`.
- Once Pool and Reserve are full, `chakraDepletion`, module-applied `exhausted`, module-applied `fatigued`, and any Low Reserve pending flag are cleared.

## Architecture

Keep `chakra-conditions.mjs` responsible for condition state, but split the threshold decision into a pure exported resolver that can be covered by Node tests without Foundry globals. `checkAndUpdateConditions(actor)` will call the resolver, apply PF1e conditions via `actor.setConditions`, and persist internal tracking flags under `flags["naruto-d20"].conditions`.

Add internal flags:

- `depletionActive`: whether the actor is in a persistent Chakra Depletion episode.
- `lowReserveFatiguePending`: whether Low Reserve fatigue was delayed because Reserve fell below 50% during combat.

Combat detection should use Foundry core state, not PF1e custom hooks:

- An actor is considered in encounter if it has a combatant in a started combat.
- End-of-encounter resolution should register a core `deleteCombat` hook and re-run `checkAndUpdateConditions` for actors in the deleted combat.

## Files

- `scripts/data/chakra-conditions.mjs`: resolver, flag persistence, pending fatigue logic, Depletion persistence, `deleteCombat` registration.
- `scripts/flag-paths.mjs`: new tracking flag paths.
- `scripts/main.mjs`: register the combat-end listener during setup.
- `tests/helpers.test.mjs`: unit tests for the pure resolver and registration-side behavior where practical.

## Error Handling

Condition updates should preserve the existing safety rule: only remove `fatigued` or `exhausted` if the module previously applied that PF1e condition. If an actor has fatigue/exhaustion from another source, the module may set the condition true but must not track it as module-owned.

The `deleteCombat` hook should ignore missing actors and should only process each actor once per deleted combat.

## Verification

Automated:

- `npm test`
- `npm run lint:js`

Manual Foundry:

- In combat, reduce Reserve to 40%: `lowReserves` may show/pending state persists, but `fatigued` is not applied until combat ends.
- In combat, reduce Reserve to 20%: `fatigued` applies immediately.
- End/delete combat while Reserve remains below 50%: `fatigued` applies.
- Trigger Depletion, rest until Reserve is above 0 but not full: `chakraDepletion` remains.
- Rest until Reserve and Pool are both full: `chakraDepletion` clears.
