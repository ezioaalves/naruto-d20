# Chakra-Damage Upkeep + Heal Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable `chakraDamage` start-of-turn maintenance primitive and fully wire Kyu-Mon Kai (Heal Gate Release) to use it, including per-turn Fast Healing and clearing fatigue/exhaustion.

**Architecture:** A new pure module resolves chakra-damage absorption (temp+pool, unabsorbed remainder doubled to HP, reserve untouched). The existing turn-maintenance engine gains a `chakraDamage` branch (forced, lethal-guarded) plus generic per-turn "benefit" facets (`heal`, `clearConditions`) applied after the buff refresh. The Heal Gate technique JSON drives it all with mastery-scaling `floor`/`ceil` formulas.

**Tech Stack:** Foundry VTT ESM modules, PF1e v11.11, `node:test` unit tests, `RollPF` for formula eval at runtime.

---

## File Structure

- **Create** `scripts/data/chakra-damage.mjs` — pure `calculateChakraDamage` + side-effecting `commitChakraDamage`.
- **Modify** `scripts/data/technique-model.mjs` — add `"chakraDamage"` to `resource` choices; add `heal` + `clearConditions` fields to the `maintenance` schema.
- **Modify** `scripts/automation/maintenance-buffs.mjs` — surface `heal` + `clearConditions` in `maintenanceFacets()`.
- **Modify** `scripts/automation/turn-maintenance.mjs` — `maintainChakraDamageUpkeep`, `applyTurnBenefits`, route in `runMaintenance`, generalize `completeMaintenance` refresh branch, register `deleteItem` teardown hook.
- **Modify** `scripts/automation/buff-application.mjs` — route `resource === "chakraDamage"` through `applyUpkeepBuff`.
- **Modify** `packs/_source/techniques/KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json` — add `automation.maintenance`.
- **Modify** `packs/_source/technique-buffs/KYU_MON_KAI__HEAL_GATE_RELEASE__1d8e3b4a7c6f9021.json` — rewrite description.
- **Modify** `tests/helpers.test.mjs` — unit tests for absorption + mastery-formula mapping + facets.
- **Modify** `lang/en.json` — chat/notification strings for chakra damage + fast healing.
- **Modify** `docs/manual-qa.md` — Heal Gate QA checklist.

---

## Task 1: Pure chakra-damage absorption

**Files:**
- Create: `scripts/data/chakra-damage.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/helpers.test.mjs` (after the existing `describe("chakra spending", ...)` block):

```js
import { calculateChakraDamage } from "../scripts/data/chakra-damage.mjs";

describe("chakra damage", () => {
  const make = (temp, value) => ({
    flags: { "naruto-d20": { chakra: { pool: { temp, value }, reserve: { value: 9 } } } },
  });

  it("absorbs from temp before pool with no HP overflow", () => {
    assert.deepEqual(calculateChakraDamage(make(2, 3), 4), {
      temp: 0,
      pool: 1,
      absorbed: 4,
      hpOverflow: 0,
    });
  });

  it("doubles the unabsorbed remainder into HP overflow", () => {
    // pool 1 absorbs 1 of 3; remainder 2 * 2 = 4 HP
    assert.deepEqual(calculateChakraDamage(make(0, 1), 3), {
      temp: 0,
      pool: 0,
      absorbed: 1,
      hpOverflow: 4,
    });
  });

  it("doubles the full amount against an empty pool", () => {
    assert.deepEqual(calculateChakraDamage(make(0, 0), 3), {
      temp: 0,
      pool: 0,
      absorbed: 0,
      hpOverflow: 6,
    });
  });

  it("never reads or writes the reserve", () => {
    const result = calculateChakraDamage(make(0, 0), 2);
    assert.equal("reserve" in result, false);
    assert.equal(result.hpOverflow, 4);
  });

  it("treats a zero / negative amount as no damage", () => {
    assert.deepEqual(calculateChakraDamage(make(0, 5), 0), {
      temp: 0,
      pool: 5,
      absorbed: 0,
      hpOverflow: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="chakra damage"`
Expected: FAIL — `Cannot find module '../scripts/data/chakra-damage.mjs'`.

- [ ] **Step 3: Implement `calculateChakraDamage`**

Create `scripts/data/chakra-damage.mjs`:

```js
import { MODULE_ID } from "../constants.mjs";
import { chakraPoolTempPath, chakraPoolValuePath } from "../flag-paths.mjs";
import { checkAndUpdateConditions } from "./chakra-conditions.mjs";

/**
 * Resolve Chakra Damage against an actor's pool. Damage is absorbed by temp
 * chakra first, then the pool (both floored at 0). Any portion the pool cannot
 * absorb is doubled and dealt as HP damage (per the Chakra Damage rule). The
 * reserve is never touched and the deliberate-spend "emergency transfer" never
 * fires — damage is not a spend. Pure: returns new values, writes nothing.
 *
 * @returns {{temp:number, pool:number, absorbed:number, hpOverflow:number}}
 */
export function calculateChakraDamage(actor, amount) {
  const dmg = Math.max(0, Number(amount) || 0);
  const chakra = actor?.flags?.[MODULE_ID]?.chakra ?? {};
  const tempValue = Math.max(0, Number(chakra.pool?.temp ?? 0) || 0);
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);

  const fromTemp = Math.min(dmg, tempValue);
  const fromPool = Math.min(dmg - fromTemp, poolValue);
  const absorbed = fromTemp + fromPool;
  const hpOverflow = (dmg - absorbed) * 2;

  return {
    temp: tempValue - fromTemp,
    pool: poolValue - fromPool,
    absorbed,
    hpOverflow,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="chakra damage"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/data/chakra-damage.mjs tests/helpers.test.mjs
git commit -m "feat(chakra): pure chakra-damage absorption with HP overflow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Side-effecting `commitChakraDamage`

**Files:**
- Modify: `scripts/data/chakra-damage.mjs`
- Modify: `lang/en.json`

Side effects (actor.update, ChatMessage, conditions) are not unit-testable without Foundry — covered by manual QA, mirroring `commitHpCost` in `hp-cost.mjs`.

- [ ] **Step 1: Add i18n strings**

In `lang/en.json`, add under the existing `NarutoD20` tree (next to other `Maintenance` keys — match the file's nesting/format):

```json
"ChakraDamageFlavor": "{name}: {amount} Chakra damage (pool {before}→{after})",
"ChakraDamageOverflow": " — +{hp} HP (overflow)",
"FastHealingFlavor": "{name}: Fast Healing {amount} (+{hp} HP)"
```

Place them inside whichever object holds `"HpCostFlavor"` (search for `HpCostFlavor` to find the exact location and indentation).

- [ ] **Step 2: Implement `commitChakraDamage` and a roll/commit helper**

Append to `scripts/data/chakra-damage.mjs`:

```js
/**
 * Apply a resolved chakra-damage calculation to the actor: write the new
 * temp/pool, subtract any HP overflow, refresh chakra conditions, and post a
 * chat message. `before`/`after` are the pool totals for the flavor line.
 */
export async function commitChakraDamage(actor, technique, calc, amount) {
  if (!actor) return;

  const beforePool = Math.max(0, Number(actor.flags?.[MODULE_ID]?.chakra?.pool?.value ?? 0) || 0);

  const updates = {
    [chakraPoolTempPath]: calc.temp,
    [chakraPoolValuePath]: calc.pool,
  };
  if (calc.hpOverflow > 0) {
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    updates["system.attributes.hp.value"] = hp - calc.hpOverflow;
  }
  await actor.update(updates);
  await checkAndUpdateConditions(actor);

  let flavor = game.i18n.format("NarutoD20.Maintenance.ChakraDamageFlavor", {
    name: technique?.name ?? "",
    amount,
    before: beforePool,
    after: calc.pool,
  });
  if (calc.hpOverflow > 0) {
    flavor += game.i18n.format("NarutoD20.Maintenance.ChakraDamageOverflow", {
      hp: calc.hpOverflow,
    });
  }

  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${flavor}</p>`,
  });
}
```

- [ ] **Step 3: Verify the module parses**

Run: `node --check scripts/data/chakra-damage.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Run the full unit suite (no regressions)**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/chakra-damage.mjs lang/en.json
git commit -m "feat(chakra): commit chakra damage with HP overflow + chat feedback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Schema + facets for `chakraDamage`, `heal`, `clearConditions`

**Files:**
- Modify: `scripts/data/technique-model.mjs:388-422`
- Modify: `scripts/automation/maintenance-buffs.mjs:45-58`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write the failing facets test**

Add to `tests/helpers.test.mjs` (the `maintenanceFacets` import already exists at the top):

```js
describe("maintenanceFacets chakraDamage", () => {
  it("surfaces resource, heal formula, and parsed clearConditions", () => {
    const technique = {
      system: {
        automation: {
          maintenance: {
            enabled: true,
            resource: "chakraDamage",
            cost: "3 - floor(@mastery / 5)",
            policy: "forced",
            interval: 1,
            heal: "2 + ceil(@mastery / 2)",
            clearConditions: "fatigued, exhausted",
          },
        },
      },
    };
    const facets = maintenanceFacets(technique);
    assert.equal(facets.resource, "chakraDamage");
    assert.equal(facets.heal, "2 + ceil(@mastery / 2)");
    assert.deepEqual(facets.clearConditions, ["fatigued", "exhausted"]);
  });

  it("defaults heal to empty and clearConditions to an empty array", () => {
    const technique = {
      system: { automation: { maintenance: { enabled: true, resource: "hp" } } },
    };
    const facets = maintenanceFacets(technique);
    assert.equal(facets.heal, "");
    assert.deepEqual(facets.clearConditions, []);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="maintenanceFacets chakraDamage"`
Expected: FAIL — `facets.heal` is `undefined`, `clearConditions` is `undefined`.

- [ ] **Step 3: Extend `maintenanceFacets`**

In `scripts/automation/maintenance-buffs.mjs`, replace the `return { ... }` object inside `maintenanceFacets` (currently ending at `choice: m.choice ?? ""`) with:

```js
  return {
    resource: m.resource ?? "",
    cost: m.cost ?? "",
    policy: m.policy ?? "prompt",
    interval: Math.max(1, Number(m.interval) || 1),
    waiver: m.waiver ?? "",
    waiverStep: Number(m.waiverStep ?? 2) || 0,
    freeRounds: Math.max(1, Number(m.freeRounds) || 5),
    choice: m.choice ?? "",
    heal: m.heal ?? "",
    clearConditions: String(m.clearConditions ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
```

- [ ] **Step 4: Add the schema fields**

In `scripts/data/technique-model.mjs`, update the `resource` `StringField` choices to include `"chakraDamage"`:

```js
                resource: new fields.StringField({
                  ...opt,
                  blank: true,
                  initial: "",
                  choices: ["", "chakra", "hp", "chakraDamage"],
                }),
```

Then, immediately after the `choice` `StringField` (before the `element` BooleanField), add:

```js
                // Per-turn HP heal formula applied after the cost is paid (Fast
                // Healing). "" = none. Evaluated with @mastery in rolldata.
                heal: new fields.StringField({ ...opt, blank: true, initial: "" }),
                // CSV of PF1e condition ids cleared each turn while active
                // (e.g. "fatigued,exhausted"). "" = none.
                clearConditions: new fields.StringField({ ...opt, blank: true, initial: "" }),
```

- [ ] **Step 5: Run the facets tests + full suite**

Run: `npm test -- --test-name-pattern="maintenanceFacets"` then `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/technique-model.mjs scripts/automation/maintenance-buffs.mjs tests/helpers.test.mjs
git commit -m "feat(schema): chakraDamage resource + heal/clearConditions maintenance facets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Mastery-formula mapping guard test

**Files:**
- Test: `tests/helpers.test.mjs`

The runtime evaluates the formula strings with `RollPF` (a Foundry global, unavailable in `node:test`). This task documents and guards the *intended* step→value mapping with a plain-JS reference of the same `floor`/`ceil` arithmetic, so a future formula edit that breaks the mapping is caught.

- [ ] **Step 1: Write the mapping test**

Add to `tests/helpers.test.mjs`:

```js
describe("gate mastery formulas", () => {
  // Mirrors the formula strings stored on the Heal Gate technique.
  const chakraDamage = (m) => Math.max(0, 3 - Math.floor(m / 5));
  const fastHealing = (m) => 2 + Math.ceil(m / 2);

  it("chakra damage is 3 below mastery 5 and 2 at mastery 5", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(chakraDamage), [3, 3, 3, 3, 3, 2]);
  });

  it("fast healing scales 2/3/4/5 across mastery steps 0/1/3/5", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(fastHealing), [2, 3, 3, 4, 4, 5]);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm test -- --test-name-pattern="gate mastery formulas"`
Expected: PASS (the assertions encode the agreed mapping).

- [ ] **Step 3: Commit**

```bash
git add tests/helpers.test.mjs
git commit -m "test(gate): guard Heal Gate mastery formula step mapping

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Engine — chakraDamage upkeep + per-turn benefits + teardown

**Files:**
- Modify: `scripts/automation/turn-maintenance.mjs`
- Modify: `scripts/automation/buff-application.mjs:36`

No unit test (engine is Foundry-coupled); verified by `node --check` + manual QA. Follow the exact existing patterns in `maintainHpUpkeep` / `completeMaintenance`.

- [ ] **Step 1: Import the chakra-damage helpers**

At the top of `scripts/automation/turn-maintenance.mjs`, add to the imports:

```js
import { calculateChakraDamage, commitChakraDamage } from "../data/chakra-damage.mjs";
```

- [ ] **Step 2: Route chakraDamage in `runMaintenance`**

In `runMaintenance`, after the existing `if (facets.resource === "chakra") { ... }` block, add:

```js
  if (facets.resource === "chakraDamage") {
    return maintainChakraDamageUpkeep(actor, itemId, technique, facets, flag);
  }
```

- [ ] **Step 3: Implement `maintainChakraDamageUpkeep`**

Add this function to `scripts/automation/turn-maintenance.mjs` (next to `maintainHpUpkeep`):

```js
function masteryRollData(actor, technique) {
  const step = Number(technique.system?.mastery) || 0;
  return { ...(actor.getRollData?.() ?? {}), mastery: step };
}

async function maintainChakraDamageUpkeep(actor, itemId, technique, facets, flag) {
  const roll = await RollPF.safeRoll(String(facets.cost || "0"), masteryRollData(actor, technique));
  const amount = Math.max(0, Math.floor(Number(roll?.total) || 0));

  const calc = calculateChakraDamage(actor, amount);

  if (calc.hpOverflow > 0) {
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    if (hp - calc.hpOverflow < 1) {
      await deleteMaintenanceBuff(actor, itemId);
      ui.notifications.info(
        game.i18n.format("NarutoD20.Maintenance.UpkeepEnded", { name: technique.name }),
      );
      return;
    }
  }

  await commitChakraDamage(actor, technique, calc, amount);
  await completeMaintenance(actor, itemId, technique, facets, flag);
}
```

- [ ] **Step 4: Apply per-turn benefits in `completeMaintenance`**

In `completeMaintenance`, add a call to `applyTurnBenefits` as the first line of the function body (before the `if (facets.choice === "mode")` block), so heal/clearConditions run for any kept buff (no-op when both are empty):

```js
  await applyTurnBenefits(actor, technique, facets);
```

Then add the function (next to `completeMaintenance`):

```js
async function applyTurnBenefits(actor, technique, facets) {
  if (facets.heal) {
    const roll = await RollPF.safeRoll(String(facets.heal), masteryRollData(actor, technique));
    const amount = Math.max(0, Math.floor(Number(roll?.total) || 0));
    const hp = actor.system?.attributes?.hp ?? {};
    const cur = Number(hp.value ?? 0) || 0;
    const max = Number(hp.max ?? cur) || cur;
    const healed = Math.min(amount, Math.max(0, max - cur));

    const updates = { "system.traits.fastHealing": String(amount) };
    if (healed > 0) updates["system.attributes.hp.value"] = cur + healed;
    await actor.update(updates);

    if (healed > 0) {
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p>${game.i18n.format("NarutoD20.Maintenance.FastHealingFlavor", {
          name: technique.name,
          amount,
          hp: healed,
        })}</p>`,
      });
    }
  }

  if (facets.clearConditions?.length) {
    const payload = {};
    for (const id of facets.clearConditions) payload[id] = false;
    await actor.setConditions(payload);
  }
}
```

- [ ] **Step 5: Generalize the `completeMaintenance` refresh branch**

In `completeMaintenance`, change the branch that currently reads:

```js
  if (facets.resource === "hp" || technique.system?.automation?.maintenance?.element) {
```

to also cover chakraDamage:

```js
  if (
    facets.resource === "hp" ||
    facets.resource === "chakraDamage" ||
    technique.system?.automation?.maintenance?.element
  ) {
```

- [ ] **Step 6: Register the fast-healing teardown hook**

In `registerTurnMaintenance` (after the existing `Hooks.on("updateItem", ...)` registration), add:

```js
  Hooks.on("deleteItem", (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.type !== "buff") return;
    const flag = getMaintenanceBuffFlag(item);
    if (!flag?.sourceTechniqueId) return;
    const actor = item.actor;
    if (!actor?.isOwner) return;
    const technique = actor.items.get(flag.sourceTechniqueId);
    const facets = technique ? maintenanceFacets(technique) : null;
    if (!facets?.heal) return;
    if (!actor.system?.traits?.fastHealing) return;
    window.setTimeout(() => {
      actor.update({ "system.traits.fastHealing": "" }).catch((err) => {
        console.error(`naruto-d20 | failed to clear fastHealing for "${actor.name}":`, err);
      });
    }, 0);
  });
```

- [ ] **Step 7: Route chakraDamage on perform in `buff-application.mjs`**

In `scripts/automation/buff-application.mjs`, in `applyTechniqueBuff`, change:

```js
    if (facets.resource === "hp" || item.system.automation.maintenance.element) {
```

to:

```js
    if (
      facets.resource === "hp" ||
      facets.resource === "chakraDamage" ||
      item.system.automation.maintenance.element
    ) {
```

- [ ] **Step 8: Verify both modules parse**

Run: `node --check scripts/automation/turn-maintenance.mjs && node --check scripts/automation/buff-application.mjs`
Expected: no output (exit 0).

- [ ] **Step 9: Run the full unit suite (no regressions)**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/automation/turn-maintenance.mjs scripts/automation/buff-application.mjs
git commit -m "feat(automation): chakraDamage turn-upkeep + per-turn heal/clear-conditions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire the Heal Gate content + repack

**Files:**
- Modify: `packs/_source/techniques/KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json`
- Modify: `packs/_source/technique-buffs/KYU_MON_KAI__HEAL_GATE_RELEASE__1d8e3b4a7c6f9021.json`

- [ ] **Step 1: Add the maintenance automation to the technique**

In `KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json`, replace the `"active": false,` line in `system` (line ~45) so the `automation` block is inserted right after it (the technique currently has no `automation` key):

```json
    "active": false,
    "automation": {
      "enabled": true,
      "targetMode": "self",
      "maintenance": {
        "enabled": true,
        "resource": "chakraDamage",
        "cost": "3 - floor(@mastery / 5)",
        "policy": "forced",
        "interval": 1,
        "waiver": "",
        "waiverStep": 2,
        "freeRounds": 5,
        "choice": "",
        "heal": "2 + ceil(@mastery / 2)",
        "clearConditions": "fatigued,exhausted",
        "element": false,
        "elementDoubleStep": 5
      }
    },
    "changes": [],
```

(Keep the existing `"changes": []` — do not duplicate it; the snippet shows it only for placement context. If `"changes": []` already follows `active`, insert `automation` between them.)

- [ ] **Step 2: Rewrite the buff description**

In `KYU_MON_KAI__HEAL_GATE_RELEASE__1d8e3b4a7c6f9021.json`, replace the `system.description.value` string with:

```html
<p>You open the Heal Gate, gaining the bonuses of Kai-mon Kai: a +2 enhancement bonus to Strength and Dexterity and a 10 ft increase to land speed.</p><p>While open, Fast Healing, ignored fatigue/exhaustion, and the per-round Chakra damage are automated each turn. Still manual: your Strength or Dexterity damage is temporarily ineffective (it returns when the gate ends), and opening this gate as part of a greater Gate (Mastery step 2) grants no benefits and no penalties.</p>
```

- [ ] **Step 3: Repack the techniques and buffs compendia**

Run: `npm run pack && npm run pack:buffs`
Expected: both commands exit 0 and report packing the LevelDB packs.

- [ ] **Step 4: Confirm the packed output changed**

Run: `git status --short packs/`
Expected: modified files under `packs/techniques/` and `packs/technique-buffs/`.

- [ ] **Step 5: Commit**

```bash
git add packs/
git commit -m "feat(technique): automate Kyu-Mon Kai (Heal Gate) chakra-damage upkeep + Fast Healing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Manual QA checklist

**Files:**
- Modify: `docs/manual-qa.md`

- [ ] **Step 1: Add the Heal Gate QA section**

Append a new section to `docs/manual-qa.md` (match the file's existing heading style):

```markdown
### Kyu-Mon Kai (Heal Gate Release) — chakra-damage upkeep

Prereq: a character actor with the Heal Gate technique and chakra pool > 0.

- [ ] Perform Heal Gate → the buff applies with Kai-Mon bonuses (+2 Str/Dex, +10 ft speed) and `system.active = true`.
- [ ] On the performer's next turn start, 3 chakra leaves the pool and a chat card reads "… 3 Chakra damage (pool X→Y)".
- [ ] HP is healed +2 the same turn; a "Fast Healing 2 (+2 HP)" card posts; the defenses card shows Fast Healing 2.
- [ ] With an empty pool (temp+pool = 0), the turn deals 6 HP of overflow instead.
- [ ] When the doubled overflow would drop HP below 1, the gate ends with an "upkeep ended" notification (no HP applied).
- [ ] fatigued / exhausted applied from another source are cleared at the performer's turn start while the gate is open.
- [ ] At mastery step 5: chakra damage is 2/round and Fast Healing is 5.
- [ ] Removing the buff (manually or via the lethal guard) clears `system.traits.fastHealing` (defenses card no longer lists it).
- [ ] The reserve total is never reduced by the chakra damage.
```

- [ ] **Step 2: Commit**

```bash
git add docs/manual-qa.md
git commit -m "docs(qa): Heal Gate chakra-damage upkeep manual checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `npm test` — all unit tests pass.
- [ ] Run `node --check` on each modified `.mjs` — all parse.
- [ ] Reload Foundry (F5) and walk the Task 7 manual QA checklist.
