# Real-duration Maintenance Buffs with Per-turn Upkeep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let finite-duration maintenance techniques (Gates) carry their real multi-round duration and still take per-turn upkeep, ending automatically when the duration runs out.

**Architecture:** Split the single "buff expiry" trigger into two: a new `updateCombat` hook charges upkeep at the owner's turn start (gated on a round-count it computes itself, so it never depends on hook ordering), while the existing `updateItem`/`reason:"duration"` hook now means "technique ended" → teardown. A maintenance buff is tagged `model: "duration" | "toggle"`; only `"duration"` buffs use the new path, so stances/ranks (`"toggle"`) keep their current behavior unchanged.

**Tech Stack:** Foundry VTT module (ESM, no build step), PF1e v11.11 API. Unit tests via Node's built-in runner (`node --test tests/*.test.mjs`, `node:assert/strict`) testing pure functions with mocked `globalThis.foundry`/`globalThis.game`. Integration (Foundry hooks) verified by manual QA per `docs/manual-qa.md`. Lint via `npm run lint`. Compendia validated via `npm run validate:compendia` and repacked via `npm run pack` / `npm run pack:buffs`.

**Spec:** `docs/superpowers/specs/2026-06-14-real-duration-upkeep-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `scripts/automation/maintenance-buffs.mjs` | Maintenance facet/flag/duration helpers (pure) | Add `isFiniteRoundDuration`, `resolveMaintenanceModel`, `maintenanceRoundsRemaining`, `realMaintenanceBuffDuration`, `shouldChargeUpkeep`; extend `maintenanceBuffFlagData` with `model`/`totalRounds`/`startRound`/`interval`/`lastUpkeepRound` |
| `scripts/automation/buff-application.mjs` | Buff lookup + apply | In `applyUpkeepBuff`, branch to the duration model: resolve action duration, build the real duration + flag bookkeeping, create/refresh the buff once |
| `scripts/automation/turn-maintenance.mjs` | Turn-driven maintenance | New `updateCombat` hook → `runTurnUpkeep`; route the existing `updateItem` handler by `model` (duration → teardown, toggle → current flow); add `tearDownDurationBuff` |
| `scripts/main.mjs` | Hook orchestration | Nothing new — `registerTurnMaintenance()` already runs in `setup` [7] and will register the new hook internally |
| `tests/helpers.test.mjs` | Pure-function unit tests | Add tests for every new pure helper |
| `packs/_source/techniques/SEI_MON_KAI__LIFE_GATE_RELEASE__rr5ej5Vyiy2U4q7w.json` | Data | Fix action `duration` `inst` → `round`/`@cl` |
| `packs/_source/techniques/KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json` | Data | Verify/fix action `duration` |

**Flag shape** (`flags["naruto-d20"].maintenanceBuff`) after this work, duration model only:
```js
{
  sourceTechniqueId: "<techniqueItemId>",
  model: "duration",        // "toggle" buffs omit the new fields below
  totalRounds: 5,           // resolved from action duration (@cl)
  startRound: 1,            // game.combat.round at apply time, or null if applied out of combat
  interval: 1,              // upkeep cadence (every N rounds)
  lastUpkeepRound: 1,       // last combat round upkeep was charged (idempotency)
  // plus existing fields as applicable: elements, hasHeal, modeId, key, grantType
}
```

---

## Task 1: Pure maintenance-model helpers

**Files:**
- Modify: `scripts/automation/maintenance-buffs.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing tests**

Add to `tests/helpers.test.mjs` (append a new `describe` block; the existing imports from `../scripts/automation/maintenance-buffs.mjs` must be extended to include the new names):

```js
import {
  getRankMaintenanceFlag,
  isFiniteRoundDuration,
  maintenanceBuffFlagData,
  maintenanceFacets,
  maintenanceModeBuffName,
  maintenanceModeById,
  maintenanceRoundsRemaining,
  resolveMaintenanceModel,
  shouldChargeUpkeep,
} from "../scripts/automation/maintenance-buffs.mjs";
```

```js
describe("maintenance duration model", () => {
  it("treats finite round durations as finite", () => {
    assert.equal(isFiniteRoundDuration({ units: "round", value: "5" }), true);
    assert.equal(isFiniteRoundDuration({ units: "round", value: 5 }), true);
  });

  it("rejects non-round, zero, missing, or non-finite durations", () => {
    assert.equal(isFiniteRoundDuration(null), false);
    assert.equal(isFiniteRoundDuration({ units: "inst" }), false);
    assert.equal(isFiniteRoundDuration({ units: "round", value: "0" }), false);
    assert.equal(isFiniteRoundDuration({ units: "round", value: "" }), false);
    assert.equal(isFiniteRoundDuration({ units: "minute", value: "5" }), false);
  });

  it("resolves model from facets + duration", () => {
    const facets = { resource: "hp" };
    assert.equal(resolveMaintenanceModel(facets, { units: "round", value: "5" }), "duration");
    assert.equal(resolveMaintenanceModel(facets, { units: "inst" }), "toggle");
    assert.equal(resolveMaintenanceModel(facets, null), "toggle");
    assert.equal(resolveMaintenanceModel(null, { units: "round", value: "5" }), null);
  });

  it("computes rounds remaining as total - (current - start)", () => {
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 1 }), 5);
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 2 }), 4);
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 6 }), 0);
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 7 }), -1);
  });

  it("treats a null startRound as not-yet-started (full duration remaining)", () => {
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: null, currentRound: 3 }), 5);
  });

  it("charges upkeep only while rounds remain, on interval, once per round", () => {
    // round 2, interval 1, not yet charged this round -> charge
    assert.equal(
      shouldChargeUpkeep({ remaining: 4, currentRound: 2, startRound: 1, interval: 1, lastUpkeepRound: 1 }),
      true,
    );
    // already charged this round -> skip
    assert.equal(
      shouldChargeUpkeep({ remaining: 4, currentRound: 2, startRound: 1, interval: 1, lastUpkeepRound: 2 }),
      false,
    );
    // ending turn (remaining 0) -> skip (teardown handles it)
    assert.equal(
      shouldChargeUpkeep({ remaining: 0, currentRound: 6, startRound: 1, interval: 1, lastUpkeepRound: 5 }),
      false,
    );
    // interval 2: round 3 is off-cadence from start 1 -> skip; round 2 is on-cadence -> charge
    assert.equal(
      shouldChargeUpkeep({ remaining: 3, currentRound: 3, startRound: 1, interval: 2, lastUpkeepRound: 1 }),
      false,
    );
    assert.equal(
      shouldChargeUpkeep({ remaining: 4, currentRound: 2, startRound: 0, interval: 2, lastUpkeepRound: -1 }),
      true,
    );
  });

  it("stamps the duration model fields into the flag payload", () => {
    const flag = maintenanceBuffFlagData({
      sourceTechniqueId: "abc",
      model: "duration",
      totalRounds: 5,
      startRound: 1,
      interval: 1,
    });
    assert.deepEqual(flag, {
      sourceTechniqueId: "abc",
      model: "duration",
      totalRounds: 5,
      startRound: 1,
      interval: 1,
      lastUpkeepRound: 1,
    });
  });

  it("omits duration-model fields for toggle buffs", () => {
    const flag = maintenanceBuffFlagData({ sourceTechniqueId: "abc", modeId: "dex" });
    assert.deepEqual(flag, { sourceTechniqueId: "abc", modeId: "dex" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `isFiniteRoundDuration is not a function` (and the other new names).

- [ ] **Step 3: Implement the helpers**

In `scripts/automation/maintenance-buffs.mjs`, add after `maintenanceBuffDuration` (line 29):

```js
/** True when a resolved duration is a finite, positive, round-based duration. */
export function isFiniteRoundDuration(duration) {
  if (!duration || duration.units !== "round") return false;
  const value = Number(duration.value);
  return Number.isFinite(value) && value > 0;
}

/**
 * Decide the maintenance model for a technique.
 * `facets` = maintenanceFacets(item) (or null), `duration` = resolved { units, value }.
 * Returns "duration" (finite round duration), "toggle" (everything else), or null (no maintenance).
 */
export function resolveMaintenanceModel(facets, duration) {
  if (!facets) return null;
  return isFiniteRoundDuration(duration) ? "duration" : "toggle";
}

/**
 * Rounds left for a duration-model buff: total - (current - start).
 * A null startRound means the buff has not started counting yet (applied out of combat).
 */
export function maintenanceRoundsRemaining({ totalRounds, startRound, currentRound } = {}) {
  const total = Number(totalRounds);
  if (!Number.isFinite(total)) return Infinity;
  if (startRound === null || startRound === undefined) return total;
  const elapsed = Number(currentRound) - Number(startRound);
  if (!Number.isFinite(elapsed)) return total;
  return total - elapsed;
}

/**
 * Whether the per-turn tick should charge upkeep this round:
 * rounds still remaining, on the interval cadence, and not already charged this round.
 */
export function shouldChargeUpkeep({
  remaining,
  currentRound,
  startRound,
  interval = 1,
  lastUpkeepRound,
} = {}) {
  if (!(Number(remaining) > 0)) return false;
  if (Number(lastUpkeepRound) === Number(currentRound)) return false;
  const step = Math.max(1, Number(interval) || 1);
  const base = startRound === null || startRound === undefined ? Number(currentRound) : Number(startRound);
  const elapsed = Number(currentRound) - base;
  if (!Number.isFinite(elapsed)) return true;
  return elapsed % step === 0;
}
```

Then extend `maintenanceBuffFlagData` (currently lines 69–85) to carry the new fields. Replace its body with:

```js
export function maintenanceBuffFlagData({
  sourceTechniqueId,
  grantType,
  key,
  modeId,
  elements,
  hasHeal = false,
  model,
  totalRounds,
  startRound,
  interval,
} = {}) {
  const data = {};
  if (sourceTechniqueId) data.sourceTechniqueId = sourceTechniqueId;
  if (grantType) data.grantType = grantType;
  if (key) data.key = key;
  if (modeId) data.modeId = modeId;
  if (Array.isArray(elements)) data.elements = elements;
  if (hasHeal) data.hasHeal = true;
  if (model === "duration") {
    data.model = "duration";
    if (Number.isFinite(Number(totalRounds))) data.totalRounds = Number(totalRounds);
    data.startRound = startRound ?? null;
    data.interval = Math.max(1, Number(interval) || 1);
    data.lastUpkeepRound = startRound ?? null;
  }
  return data;
}
```

Note: `lastUpkeepRound` starts equal to `startRound` so the activation round never charges upkeep (upkeep begins on the next turn).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS for the new `maintenance duration model` block and all existing tests.

- [ ] **Step 5: Lint**

Run: `npm run lint:js`
Expected: no errors in `maintenance-buffs.mjs`.

- [ ] **Step 6: Commit**

```bash
git add scripts/automation/maintenance-buffs.mjs tests/helpers.test.mjs
git commit -m "feat(maintenance): pure helpers for real-duration upkeep model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Real-duration buff build helper

**Files:**
- Modify: `scripts/automation/maintenance-buffs.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing test**

Add to `tests/helpers.test.mjs` inside a new `describe`:

```js
import { realMaintenanceBuffDuration } from "../scripts/automation/maintenance-buffs.mjs";

describe("realMaintenanceBuffDuration", () => {
  it("builds a round duration ending at turnStart with the given worldTime start", () => {
    assert.deepEqual(realMaintenanceBuffDuration({ totalRounds: 5, worldTime: 120 }), {
      units: "round",
      value: "5",
      end: "turnStart",
      start: 120,
    });
  });

  it("clamps totalRounds to at least 1", () => {
    assert.deepEqual(realMaintenanceBuffDuration({ totalRounds: 0, worldTime: 0 }), {
      units: "round",
      value: "1",
      end: "turnStart",
      start: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `realMaintenanceBuffDuration is not a function`.

- [ ] **Step 3: Implement**

In `scripts/automation/maintenance-buffs.mjs`, add after `maintenanceBuffDuration`:

```js
/**
 * Buff system.duration for the duration model: the technique's real round count,
 * ending at turnStart so PF1e expires it (and triggers teardown) at the owner's turn.
 * `worldTime` is the start stamp PF1e uses to compute remaining seconds.
 */
export function realMaintenanceBuffDuration({ totalRounds, worldTime }) {
  return {
    units: "round",
    value: String(Math.max(1, Number(totalRounds) || 1)),
    end: "turnStart",
    start: worldTime,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/automation/maintenance-buffs.mjs tests/helpers.test.mjs
git commit -m "feat(maintenance): real-duration buff duration builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Apply duration-model buffs in buff-application.mjs

**Files:**
- Modify: `scripts/automation/buff-application.mjs:134-159` (`applyUpkeepBuff`)

This task is integration glue (uses `RollPF`, `game.combat`, document writes) — verified by manual QA, not unit tests. The pure pieces it depends on are already tested in Tasks 1–2.

- [ ] **Step 1: Add imports**

In `scripts/automation/buff-application.mjs`, extend the existing import block from `./maintenance-buffs.mjs` (lines 4–14) to include:

```js
import {
  MAINTENANCE_BUFF_FLAG,
  MAINTENANCE_BUFF_FLAG_PATH,
  MAINTENANCE_MODES,
  findMaintenanceBuffForTechnique,
  maintenanceBuffDuration,
  maintenanceBuffFlagData,
  maintenanceFacets,
  maintenanceModeBuffName,
  maintenanceModeById,
  realMaintenanceBuffDuration,
  resolveMaintenanceModel,
} from "./maintenance-buffs.mjs";
```

- [ ] **Step 2: Resolve the technique's action duration for the model decision**

`applyTechniqueBuff` already receives the triggering `action` and calls `applyUpkeepBuff(item, actor, facets.interval)` (lines 46–53). Change that call to also pass the resolved duration. Replace lines 46–53:

```js
    if (
      facets.resource === "hp" ||
      facets.resource === "chakraDamage" ||
      item.system.automation.maintenance.element
    ) {
      const duration = resolveBuffDurationFromAction(action);
      await applyUpkeepBuff(item, actor, facets.interval, duration);
      return;
    }
```

`resolveBuffDurationFromAction(action)` (already defined at line 293) returns `{ units, value }` or `null`. Note it resolves `@cl` to character level already.

- [ ] **Step 3: Branch `applyUpkeepBuff` on the model**

Replace `applyUpkeepBuff` (lines 134–159) with:

```js
export async function applyUpkeepBuff(item, actor, interval = 1, duration = null) {
  if (!actor?.isOwner) return;

  const { getActiveElements } = await import("./maintenance-element-damage.mjs");
  const elements = getActiveElements(actor, item) ?? [];

  const buffEntry = await resolveBuffMatch(item.name);
  if (!buffEntry) {
    console.warn(
      `naruto-d20 | No upkeep maintenance buff found named "${item.name}" in technique-buffs compendia.`,
    );
    return;
  }

  const buffDoc = await resolveBuffDocument(buffEntry);
  if (!buffDoc) return;

  const facets = maintenanceFacets(item);
  const model = resolveMaintenanceModel(facets, duration);

  if (model === "duration") {
    const totalRounds = Number(duration.value);
    const startRound = game.combat?.round ?? null;
    await applyBuffToTarget(buffDoc, actor, {
      duration: realMaintenanceBuffDuration({ totalRounds, worldTime: game.time.worldTime }),
      maintenanceBuff: maintenanceBuffFlagData({
        sourceTechniqueId: item.id,
        elements,
        hasHeal: !!facets?.heal,
        model: "duration",
        totalRounds,
        startRound,
        interval,
      }),
    });
    return;
  }

  await applyBuffToTarget(buffDoc, actor, {
    duration: maintenanceBuffDuration(interval),
    maintenanceBuff: maintenanceBuffFlagData({
      sourceTechniqueId: item.id,
      elements,
      hasHeal: !!facets?.heal,
    }),
  });
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint:js`
Expected: no errors.

- [ ] **Step 5: Manual smoke test (Foundry)**

Reload the world (`F5`). On a level-5 actor with Kai-Mon, perform Kai-Mon successfully. Open the applied buff and confirm `system.duration` shows **5 rounds** (not 1), and the buff flag `flags.naruto-d20.maintenanceBuff` has `model: "duration"`, `totalRounds: 5`, `startRound` = current combat round, `interval: 1`. Inspect via console:
```js
const a = game.actors.getName("<actor>");
const b = a.items.find(i => i.flags["naruto-d20"]?.maintenanceBuff?.model === "duration");
console.log(b.system.duration, b.flags["naruto-d20"].maintenanceBuff);
```
Expected: `{ units: "round", value: "5", end: "turnStart", start: <worldTime> }` and the flag fields above.

- [ ] **Step 6: Commit**

```bash
git add scripts/automation/buff-application.mjs
git commit -m "feat(maintenance): apply finite-duration gate buffs with real duration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Per-turn upkeep tick + teardown routing in turn-maintenance.mjs

**Files:**
- Modify: `scripts/automation/turn-maintenance.mjs`

Integration glue (Foundry hooks, document writes) — verified by manual QA. Gating logic uses the pure helpers tested in Task 1.

- [ ] **Step 1: Extend imports**

Replace the import from `./maintenance-buffs.mjs` (lines 4–8) with:

```js
import {
  getMaintenanceBuffFlag,
  maintenanceBuffDuration,
  maintenanceFacets,
  maintenanceRoundsRemaining,
  shouldChargeUpkeep,
} from "./maintenance-buffs.mjs";
```

- [ ] **Step 2: Route the existing expiry handler by model**

In `registerTurnMaintenance()`, the `updateItem` handler (lines 21–47) currently calls `queueMaintenance(item)` then falls back to delete. For duration-model buffs, expiry means **teardown**. Insert this check at the top of the handler body, right after the `if (!item.flags?.[MODULE_ID]?.sourceId) return;` guard (line 26) and before `const actor = item.actor;`:

```js
    const mFlag = item.flags?.[MODULE_ID]?.maintenanceBuff;
    if (mFlag?.model === "duration") {
      const tdActor = item.actor;
      if (!tdActor?.isOwner) return;
      const itemId = item.id;
      window.setTimeout(() => tearDownDurationBuff(tdActor, itemId), 0);
      return;
    }
```

- [ ] **Step 3: Register the per-turn `updateCombat` hook**

At the end of `registerTurnMaintenance()` (after the `deleteItem` hook block, before the closing brace at line 75), add:

```js
  Hooks.on("updateCombat", (combat, changed) => {
    if (changed?.turn === undefined && changed?.round === undefined) return;
    const actor = combat.combatant?.actor;
    if (!actor) return;
    // Only the active owner's client runs upkeep (mirrors PF1e's expiry guard).
    if (!actor.activeOwner?.isSelf) return;
    runTurnUpkeep(actor, combat);
  });
```

- [ ] **Step 4: Implement `runTurnUpkeep`**

Add this function to `turn-maintenance.mjs` (e.g. after `registerTurnMaintenance`):

```js
function runTurnUpkeep(actor, combat) {
  const currentRound = Number(combat.round) || 0;
  for (const item of actor.items) {
    if (item.type !== "buff") continue;
    const flag = getMaintenanceBuffFlag(item);
    if (flag?.model !== "duration") continue;
    if (!item.system?.active) continue; // expired buffs are handled by teardown

    const remaining = maintenanceRoundsRemaining({
      totalRounds: flag.totalRounds,
      startRound: flag.startRound,
      currentRound,
    });
    if (
      !shouldChargeUpkeep({
        remaining,
        currentRound,
        startRound: flag.startRound,
        interval: flag.interval,
        lastUpkeepRound: flag.lastUpkeepRound,
      })
    ) {
      continue;
    }

    queueDeferred(item, () => chargeDurationUpkeep(actor, item.id, currentRound));
  }
}
```

- [ ] **Step 5: Implement `chargeDurationUpkeep`**

This reuses the existing cost/benefit helpers (`maintainHpUpkeep`/`maintainChakraDamageUpkeep` paths) but must NOT recreate the buff — only charge cost, apply benefits, and stamp `lastUpkeepRound`. Add:

```js
async function chargeDurationUpkeep(actor, itemId, currentRound) {
  const item = actor.items.get(itemId);
  if (!item || !item.system?.active) return;

  const flag = getMaintenanceBuffFlag(item);
  const technique = flag?.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  if (!technique) return;
  const facets = maintenanceFacets(technique);
  if (!facets) return;

  // If the owner ever started counting out of combat, anchor startRound now.
  if (flag.startRound === null || flag.startRound === undefined) {
    await item.update({ [`flags.${MODULE_ID}.maintenanceBuff.startRound`]: currentRound });
  }

  const rollData = masteryRollData(actor, technique);

  if (facets.resource === "hp") {
    const { roll, amount } = await rollHpCost(actor, facets.cost || "0", rollData);
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    if (hp - amount < 1) {
      await tearDownDurationBuff(actor, itemId);
      return;
    }
    await commitHpCost(actor, roll, amount);
  } else if (facets.resource === "chakraDamage") {
    const roll = await RollPF.safeRoll(String(facets.cost || "0"), rollData);
    const amount = Math.max(0, Math.floor(Number(roll?.total) || 0));
    const calc = calculateChakraDamage(actor, amount);
    if (calc.hpOverflow > 0) {
      const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
      if (hp - calc.hpOverflow < 1) {
        await tearDownDurationBuff(actor, itemId);
        return;
      }
    }
    await commitChakraDamage(actor, technique, calc, amount);
  }

  await applyTurnBenefits(actor, technique, facets);
  await item.update({ [`flags.${MODULE_ID}.maintenanceBuff.lastUpkeepRound`]: currentRound });
}
```

- [ ] **Step 6: Implement `tearDownDurationBuff`**

Add:

```js
async function tearDownDurationBuff(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item) return;
  const flag = getMaintenanceBuffFlag(item);
  const technique = flag?.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  const name = technique?.name ?? item.name;

  // Delete the buff (the deleteItem hook clears fastHealing / temp chakra granted by it).
  await deleteMaintenanceBuff(actor, itemId);

  // Gates leave the user fatigued when they end.
  try {
    await actor.setConditions({ fatigued: true });
  } catch (err) {
    console.error(`naruto-d20 | failed to set fatigued on "${actor.name}":`, err);
  }

  ui.notifications.info(
    game.i18n.format("NarutoD20.Maintenance.UpkeepEnded", { name }),
  );
}
```

`deleteMaintenanceBuff`, `masteryRollData`, `applyTurnBenefits`, `commitHpCost`, `rollHpCost`, `calculateChakraDamage`, `commitChakraDamage`, and `queueDeferred` already exist in this file (or its imports). Confirm the imports at the top of `turn-maintenance.mjs` already include `rollHpCost`, `commitHpCost` (line 3), `calculateChakraDamage`, `commitChakraDamage` (line 16) — they do.

- [ ] **Step 7: Lint**

Run: `npm run lint:js`
Expected: no errors.

- [ ] **Step 8: Manual QA — Kai-Mon full lifecycle (Foundry)**

Reload (`F5`). Level-5 actor, in combat, perform Kai-Mon at round 1. Then advance combat turn-by-turn (Next Turn) and observe at the **start of the actor's turn** each round:
- Round 2–5: takes 2 damage each time (chat/HP drops), buff stays active, duration counts down, **no flicker**.
- Round 6: buff disappears, actor becomes **fatigued**, "upkeep ended" notification, **no** damage that turn.

Expected: 4 damage ticks total (rounds 2–5), auto-end at round 6 with fatigued.

- [ ] **Step 9: Manual QA — cannot-pay early end**

Set the actor's HP to 1. Start Kai-Mon, advance to the actor's next turn.
Expected: buff ends immediately (HP would drop below 1), fatigued applied, no negative HP.

- [ ] **Step 10: Manual QA — toggle model unaffected**

Perform a Champuru stance and a maintained rank buff (toggle model). Advance turns.
Expected: identical behavior to before this change (mode prompt / chakra upkeep via the `updateItem` path; the `updateCombat` hook ignores them).

- [ ] **Step 11: Commit**

```bash
git add scripts/automation/turn-maintenance.mjs
git commit -m "feat(maintenance): per-turn upkeep tick + auto-end teardown for gates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Fix Gate technique action durations (data)

**Files:**
- Modify: `packs/_source/techniques/SEI_MON_KAI__LIFE_GATE_RELEASE__rr5ej5Vyiy2U4q7w.json`
- Modify (verify): `packs/_source/techniques/KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json`

- [ ] **Step 1: Fix Sei-Mon action duration**

In `SEI_MON_KAI__LIFE_GATE_RELEASE__rr5ej5Vyiy2U4q7w.json`, the action (id `EdIssSaOwbxiIn4H`) currently has:
```json
        "duration": {
          "units": "inst"
        },
```
Replace with:
```json
        "duration": {
          "units": "round",
          "value": "@cl"
        },
```

- [ ] **Step 2: Verify/fix Kyu-Mon action duration**

Open `KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json`. Confirm whether the Heal Gate has a finite "1r/level" duration (check `system.duration` text and the source book entry). If it should be finite and the action `duration` is not `{ units: "round", value: "@cl" }`, fix it the same way as Sei-Mon. If the Heal Gate is intentionally indefinite, leave it (`toggle` model) and note that in the commit message.

- [ ] **Step 3: Validate compendia source**

Run: `npm run validate:compendia`
Expected: PASS (no schema errors for the edited techniques).

- [ ] **Step 4: Repack the techniques compendium**

Run: `npm run pack`
Expected: LevelDB under `packs/` updated for the techniques pack.

- [ ] **Step 5: Manual QA — Sei-Mon real duration**

Reload (`F5`). On a level-N actor, perform Sei-Mon in combat. Confirm the applied buff has `system.duration.value === "N"` (rounds) and `model: "duration"`. Advance turns: HP upkeep (`4 - floor(@mastery/5)`) each of the actor's turns, **+8 temporary chakra granted once at activation and still present each round** (the existing workaround), and on natural expiry the buff ends, fatigued is applied, and the residual temporary chakra is cleared by the `deleteItem` hook.

Verify temp chakra via console after activation and again two rounds later:
```js
game.actors.getName("<actor>").flags["naruto-d20"].chakra.pool.temp; // expect 8 both times
```
Expected: temp chakra granted once (not re-added each round), cleared on end.

- [ ] **Step 6: Commit**

```bash
git add packs/_source/techniques/ packs/techniques/
git commit -m "fix(data): give Sei-Mon (and Heal Gate if finite) a real round duration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run the full linter**

Run: `npm run lint`
Expected: JS, CSS, and format checks all PASS. (Run `npm run lint:fix` if format-only failures appear, then re-commit.)

- [ ] **Step 3: Manual QA checklist (Foundry, `docs/manual-qa.md`)**

Confirm each spec scenario one final time:
- [ ] Kai-Mon lvl 5: 5-round duration, damage rounds 2–5, ends round 6 with fatigued, no flicker.
- [ ] Cannot pay HP → ends early, no negative HP.
- [ ] Sei-Mon: real duration + temp-chakra workaround intact (granted once, cleared on teardown).
- [ ] Champuru / maintained ranks (toggle): behavior identical to current.
- [ ] Out of combat: buff persists with no upkeep; on entering combat, counting anchors to the current round.
- [ ] Skipped turns (advance multiple turns at once): charged at most once per the actor's turn.

- [ ] **Step 4: Update manual-QA doc if needed**

If any Gate scenario above is not already represented in `docs/manual-qa.md`, add a short checklist entry for the real-duration upkeep behavior so future releases re-test it.

- [ ] **Step 5: Final commit (if docs changed)**

```bash
git add docs/manual-qa.md
git commit -m "docs(qa): add real-duration gate upkeep checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **No build step.** Foundry loads `scripts/*.mjs` directly; reload with `F5` (full) or `Ctrl+R` (module-only) to pick up changes. Do **not** restart Docker.
- **PF1e is pinned to v11.11.** Before touching any `pf1.*` / `CONFIG.PF1.*` / `system.*` / `"PF1.*"` reference, use the `pf1e-api-check` skill. Relevant facts for this plan are already recorded in `.claude/skills/pf1e-api-check/references/verified-api.md` under "Combat / per-turn hooks & buff duration expiry".
- **Order-independence is the core invariant.** The `updateCombat` tick gates purely on its own `maintenanceRoundsRemaining`/`shouldChargeUpkeep` calc and on `item.system.active`; it never assumes PF1e's expiry ran first or hasn't run yet. Teardown is driven by the `updateItem`/`reason:"duration"` handler. The two cannot double-charge because the tick skips when `remaining <= 0` and when the buff is already inactive.
- **`i18n` key `NarutoD20.Maintenance.UpkeepEnded`** already exists (used by the current end path). No new lang keys are required by this plan.
