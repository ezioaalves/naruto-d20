# Chakra Condition Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Low Reserve fatigue delay during combat and persistent Chakra Depletion until full Pool and Reserve recovery.

**Architecture:** Extract Chakra condition decisions into a pure resolver in `scripts/data/chakra-conditions.mjs`, then have Foundry-facing code apply the resolver result through PF1e `actor.setConditions`. Persist only minimal module state in actor flags: whether Depletion is active and whether Low Reserve fatigue is pending until encounter end.

**Tech Stack:** Foundry VTT 13 document hooks, PF1e v11.11 actor condition API, JavaScript ESM, Node test runner.

---

### Task 1: Add Resolver Tests

**Files:**
- Modify: `tests/helpers.test.mjs`
- Modify: `scripts/data/chakra-conditions.mjs`

- [ ] **Step 1: Add imports for the resolver constants**

Add this import near the existing data imports in `tests/helpers.test.mjs`:

```js
import { resolveChakraConditionState } from "../scripts/data/chakra-conditions.mjs";
```

- [ ] **Step 2: Add failing tests for the new condition rules**

Add this block near the Chakra-related tests in `tests/helpers.test.mjs`:

```js
describe("chakra condition state", () => {
  const baseState = {
    reserveValue: 10,
    reserveMax: 20,
    poolValue: 20,
    poolMax: 20,
    depletionActive: false,
    lowReserveFatiguePending: false,
  };

  it("delays low-reserve fatigue during combat above the quarter threshold", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 8,
        inCombat: true,
      }),
      {
        wantsLowReserves: true,
        wantsDepletion: false,
        wantsFatigued: false,
        wantsExhausted: false,
        depletionActive: false,
        lowReserveFatiguePending: true,
      },
    );
  });

  it("applies low-reserve fatigue immediately below the quarter threshold even in combat", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 4,
        inCombat: true,
      }),
      {
        wantsLowReserves: true,
        wantsDepletion: false,
        wantsFatigued: true,
        wantsExhausted: false,
        depletionActive: false,
        lowReserveFatiguePending: false,
      },
    );
  });

  it("keeps depletion active until reserve and pool are fully recovered", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 12,
        poolValue: 19,
        depletionActive: true,
      }),
      {
        wantsLowReserves: false,
        wantsDepletion: true,
        wantsFatigued: true,
        wantsExhausted: false,
        depletionActive: true,
        lowReserveFatiguePending: false,
      },
    );
  });

  it("clears depletion only when reserve and pool are both full", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        depletionActive: true,
      }),
      {
        wantsLowReserves: false,
        wantsDepletion: false,
        wantsFatigued: false,
        wantsExhausted: false,
        depletionActive: false,
        lowReserveFatiguePending: false,
      },
    );
  });
});
```

- [ ] **Step 3: Run the failing test**

Run: `npm test -- --test-name-pattern="chakra condition state"`

Expected: FAIL because `resolveChakraConditionState` is not exported yet.

### Task 2: Implement Pure Condition Resolution

**Files:**
- Modify: `scripts/data/chakra-conditions.mjs`

- [ ] **Step 1: Add `resolveChakraConditionState`**

Add this exported function above `checkAndUpdateConditions`:

```js
export function resolveChakraConditionState({
  reserveValue = 0,
  reserveMax = 0,
  poolValue = 0,
  poolMax = 0,
  depletionActive = false,
  lowReserveFatiguePending = false,
  inCombat = false,
} = {}) {
  const reservePct = reserveMax > 0 ? reserveValue / reserveMax : 1;
  const fullReserve = reserveMax <= 0 || reserveValue >= reserveMax;
  const fullPool = poolMax <= 0 || poolValue >= poolMax;
  const fullyRecovered = fullReserve && fullPool;

  let nextDepletionActive = depletionActive || reserveValue <= 0;
  if (nextDepletionActive && fullyRecovered) nextDepletionActive = false;

  if (nextDepletionActive) {
    return {
      wantsLowReserves: false,
      wantsDepletion: true,
      wantsFatigued: reservePct >= 0.5,
      wantsExhausted: reservePct < 0.5,
      depletionActive: true,
      lowReserveFatiguePending: false,
    };
  }

  const wantsLowReserves = reserveValue > 0 && reservePct < 0.5;
  const immediateLowReserveFatigue = wantsLowReserves && (reservePct < 0.25 || !inCombat);
  const nextPending =
    wantsLowReserves && !immediateLowReserveFatigue
      ? true
      : wantsLowReserves && lowReserveFatiguePending && inCombat;

  return {
    wantsLowReserves,
    wantsDepletion: false,
    wantsFatigued: immediateLowReserveFatigue || (wantsLowReserves && lowReserveFatiguePending && !inCombat),
    wantsExhausted: false,
    depletionActive: false,
    lowReserveFatiguePending: Boolean(nextPending && !immediateLowReserveFatigue),
  };
}
```

- [ ] **Step 2: Run resolver tests**

Run: `npm test -- --test-name-pattern="chakra condition state"`

Expected: PASS.

### Task 3: Persist Condition State Flags

**Files:**
- Modify: `scripts/flag-paths.mjs`
- Modify: `scripts/data/chakra-conditions.mjs`

- [ ] **Step 1: Add flag paths**

Add to `scripts/flag-paths.mjs` under the existing condition tracking paths:

```js
export const conditionDepletionActivePath = `${moduleFlagsPath}.conditions.depletionActive`;
export const conditionLowReserveFatiguePendingPath = `${moduleFlagsPath}.conditions.lowReserveFatiguePending`;
```

- [ ] **Step 2: Import the new paths**

Change the import in `scripts/data/chakra-conditions.mjs` to include:

```js
import {
  conditionAppliedExhaustedPath,
  conditionAppliedFatiguedPath,
  conditionDepletionActivePath,
  conditionLowReserveFatiguePendingPath,
} from "../flag-paths.mjs";
```

- [ ] **Step 3: Wire resolver into `checkAndUpdateConditions`**

Inside `checkAndUpdateConditions`, read Pool values and tracked flags, then call the resolver:

```js
const poolValue = chakra.pool?.value ?? 0;
const poolMax = chakra.pool?.max ?? 0;
const inCombat = actorIsInStartedCombat(actor);
const state = resolveChakraConditionState({
  reserveValue,
  reserveMax,
  poolValue,
  poolMax,
  depletionActive: tracked.depletionActive ?? false,
  lowReserveFatiguePending: tracked.lowReserveFatiguePending ?? false,
  inCombat,
});
```

Use `state.wantsLowReserves`, `state.wantsDepletion`, `state.wantsFatigued`, and `state.wantsExhausted` instead of the old direct Reserve checks.

- [ ] **Step 4: Persist state flags with applied-condition tracking**

Extend the final `actor.update` block so it also writes:

```js
[conditionDepletionActivePath]: state.depletionActive,
[conditionLowReserveFatiguePendingPath]: state.lowReserveFatiguePending,
```

Only update when at least one of the persisted values changed.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: PASS.

### Task 4: Add Combat End Re-Evaluation

**Files:**
- Modify: `scripts/data/chakra-conditions.mjs`
- Modify: `scripts/main.mjs`

- [ ] **Step 1: Add started-combat helper**

Add this helper to `scripts/data/chakra-conditions.mjs`:

```js
function actorIsInStartedCombat(actor) {
  return actor.getCombatants?.().some((combatant) => combatant.combat?.started) ?? false;
}
```

- [ ] **Step 2: Export combat-end listener registration**

Add this export to `scripts/data/chakra-conditions.mjs`:

```js
export function registerChakraConditionCombatHooks() {
  Hooks.on("deleteCombat", (combat) => {
    const actors = new Set();
    for (const combatant of combat.combatants ?? []) {
      if (combatant.actor) actors.add(combatant.actor);
    }
    for (const actor of actors) {
      if (!actor.activeOwner?.isSelf) continue;
      checkAndUpdateConditions(actor);
    }
  });
}
```

- [ ] **Step 3: Register the listener from setup**

Change the import in `scripts/main.mjs`:

```js
import {
  registerChakraConditionCombatHooks,
  registerChakraConditions,
} from "./data/chakra-conditions.mjs";
```

Then call it inside the `setup` hook:

```js
registerChakraConditionCombatHooks(); // combat end → apply delayed Low Reserve fatigue
```

- [ ] **Step 4: Run tests and lint**

Run: `npm test`

Expected: PASS.

Run: `npm run lint:js`

Expected: PASS.

### Task 5: Manual Foundry QA

**Files:**
- No file changes.

- [ ] **Step 1: Low Reserve delayed fatigue**

In Foundry, start a combat with a character whose Reserve max is 20. Reduce Reserve to 8 through Tap Reserves or direct sheet edit, then trigger the relevant condition check path.

Expected: `lowReserves`/pending state exists, but PF1e `fatigued` is not applied while combat is active.

- [ ] **Step 2: Low Reserve immediate quarter fatigue**

While combat is still active, reduce Reserve to 4 or lower.

Expected: PF1e `fatigued` applies immediately.

- [ ] **Step 3: Encounter-end fatigue**

Reset to Reserve 8, start combat, trigger pending Low Reserve, then delete/end the combat.

Expected: PF1e `fatigued` applies after the combat is deleted.

- [ ] **Step 4: Depletion persists**

Trigger Chakra Depletion, then rest or restore only part of Reserve/Pool.

Expected: `chakraDepletion` remains active until both Reserve and non-temp Pool are full.

- [ ] **Step 5: Depletion clears on full recovery**

Restore Reserve to max and Pool value to max.

Expected: `chakraDepletion`, module-applied `exhausted`, module-applied `fatigued`, and Low Reserve pending state clear.
