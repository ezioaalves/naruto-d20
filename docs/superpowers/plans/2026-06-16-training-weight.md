# Training Weight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add equippable Training Weight items that penalize effective KOUSOKU/JOURYOKU, grant conditional Learn/Mastery bonuses for marked rank-training techniques, and ignore carried weight based on the actor's highest learned JOURYOKU technique.

**Architecture:** Add one pure helper module, `scripts/data/training-weights.mjs`, as the single source of truth for Training Weight metadata, equipped-item selection, learned JOURYOKU carry rules, and conditional Learn/Mastery bonuses. Reuse that helper from three integration points: Learn/Mastery roll assembly, effective-rank resolution, and a PF1e actor carry-weight patch. Represent Training Weights as a new PF1e `loot` compendium (`gear` subtype) and mark eligible rank techniques with explicit module flags.

**Tech Stack:** Foundry VTT 13 hooks and prototype patching, PF1e v11.11 `loot` items and actor encumbrance API, JavaScript ESM, Node test runner, Foundry CLI pack tooling.

---

## File Map

- Create: `scripts/data/training-weights.mjs`
  Responsibility: Training Weight tables, item/technique flag helpers, equipped-item normalization, learned JOURYOKU lookup, full-set Learn/Mastery bonus resolution, ignored-carry-weight math.
- Create: `scripts/automation/training-weight-carry.mjs`
  Responsibility: patch `ActorPF#getCarriedWeight()` so ignored Training Weight mass is subtracted without mutating item documents.
- Modify: `scripts/data/bonus-sources.mjs`
  Responsibility: inject Training Weight Learn/Mastery bonus into learn-breakdown assembly only for explicitly marked techniques.
- Modify: `scripts/automation/rank-effective-level.mjs`
  Responsibility: include Training Weight penalties in effective KOUSOKU/JOURYOKU computation.
- Modify: `scripts/main.mjs`
  Responsibility: register the carried-weight patch during setup.
- Modify: `module.json`
  Responsibility: add the new compendium pack to the manifest and pack folder.
- Modify: `package.json`
  Responsibility: add `pack:training-weights`, `unpack:training-weights`, and include them in `pack:all` / `unpack:all`.
- Modify: `tools/validate-compendia.mjs`
  Responsibility: validate the new Training Weight pack and the new technique/item flags.
- Modify: `tests/helpers.test.mjs`
  Responsibility: unit tests for the pure helper module, learn-breakdown injection, and effective-rank integration.
- Modify: `docs/manual-qa.md`
  Responsibility: add manual verification steps for Training Weight behavior.
- Create: `packs/_source/training-weights/*.json`
  Responsibility: the 16 fixed Training Weight items.
- Modify: the 10 rank-technique JSON files listed in Task 7
  Responsibility: add explicit `trainingWeightTechnique` flags.

### Task 1: Add Failing Tests for Training Weight State

**Files:**
- Modify: `tests/helpers.test.mjs`
- Create: `scripts/data/training-weights.mjs`

- [ ] **Step 1: Add imports for the new helper functions**

Add these imports near the other data/helper imports at the top of `tests/helpers.test.mjs`:

```js
import {
  getHighestLearnedStrengthRank,
  getIgnoredTrainingWeightTotal,
  getTrainingWeightLearnBonus,
  getTrainingWeightState,
} from "../scripts/data/training-weights.mjs";
```

- [ ] **Step 2: Add failing tests for equipped-item normalization, full-set bonus, and ignored carry weight**

Append this block near the other pure helper tests in `tests/helpers.test.mjs`:

```js
describe("training weight state", () => {
  const learned = (name, trainingWeightTechnique) => ({
    type: "naruto-d20.technique",
    name,
    system: { learning: { learned: true } },
    flags: { "naruto-d20": { trainingWeightTechnique } },
  });

  const weight = ({
    id,
    slot,
    type,
    rankPenalty,
    learnBonus,
    weightValue,
    equipped = true,
  }) => ({
    id,
    type: "loot",
    system: {
      subType: "gear",
      quantity: 1,
      carried: true,
      equipped,
      weight: { total: weightValue },
    },
    isPhysical: true,
    isActive: equipped,
    inContainer: false,
    flags: {
      "naruto-d20": {
        trainingWeightItem: { slot, type, rankPenalty, learnBonus },
      },
    },
  });

  it("chooses the highest equipped type per slot and uses the lower full-set type for learn bonus", () => {
    const actor = {
      items: [
        weight({
          id: "w1",
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
          weightValue: 50,
        }),
        weight({
          id: "w2",
          slot: "wrist",
          type: 5,
          rankPenalty: 5,
          learnBonus: 5,
          weightValue: 75,
        }),
        weight({
          id: "a1",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
        }),
      ],
    };

    assert.deepEqual(getTrainingWeightState(actor), {
      wrist: { itemId: "w2", slot: "wrist", type: 5, rankPenalty: 5, learnBonus: 5, weight: 75 },
      ankle: { itemId: "a1", slot: "ankle", type: 2, rankPenalty: 2, learnBonus: 2, weight: 37.5 },
      hasFullSet: true,
      fullSetType: 2,
      fullSetLearnBonus: 2,
      strengthRankPenalty: 5,
      speedRankPenalty: 2,
      highestLearnedStrengthRank: 0,
      ignoredCarryWeight: 0,
    });
  });

  it("reads highest learned strength rank from explicit technique metadata", () => {
    const actor = {
      items: [
        learned("SHODAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 1,
        }),
        learned("SANDAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        }),
        learned("NINJOURYOKU NO JUTSU", {
          eligibleRankKey: "",
          learnedStrengthRank: 0,
        }),
      ],
    };

    assert.equal(getHighestLearnedStrengthRank(actor), 3);
  });

  it("ignores carried weight for both halves when their type is at or below learned JOURYOKU rank", () => {
    const actor = {
      items: [
        learned("SANDAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        }),
        weight({
          id: "w3",
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
          weightValue: 50,
        }),
        weight({
          id: "a2",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
        }),
        weight({
          id: "w5",
          slot: "wrist",
          type: 5,
          rankPenalty: 5,
          learnBonus: 5,
          weightValue: 75,
        }),
      ],
    };

    assert.equal(getIgnoredTrainingWeightTotal(actor), 87.5);
  });

  it("returns a learn bonus only for explicitly eligible full-set techniques", () => {
    const actor = {
      items: [
        weight({
          id: "w4",
          slot: "wrist",
          type: 4,
          rankPenalty: 4,
          learnBonus: 4,
          weightValue: 62.5,
        }),
        weight({
          id: "a2",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
        }),
      ],
    };

    assert.deepEqual(
      getTrainingWeightLearnBonus(actor, {
        flags: {
          "naruto-d20": {
            trainingWeightTechnique: {
              eligibleRankKey: "KOUSOKU",
              learnedStrengthRank: 0,
            },
          },
        },
      }),
      { value: 2, type: 2, eligibleRankKey: "KOUSOKU" },
    );

    assert.equal(
      getTrainingWeightLearnBonus(actor, {
        flags: {
          "naruto-d20": {
            trainingWeightTechnique: {
              eligibleRankKey: "",
              learnedStrengthRank: 0,
            },
          },
        },
      }),
      null,
    );
  });
});
```

- [ ] **Step 3: Run the targeted tests to verify they fail**

Run: `npm test -- --test-name-pattern="training weight state"`

Expected: FAIL because `scripts/data/training-weights.mjs` does not exist yet.

- [ ] **Step 4: Commit the failing-test scaffold**

```bash
git add tests/helpers.test.mjs
git commit -m "test(training-weight): add helper coverage"
```

### Task 2: Implement the Pure Training Weight Helper Module

**Files:**
- Create: `scripts/data/training-weights.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Create the Training Weight tables and flag helpers**

Create `scripts/data/training-weights.mjs` with this top-level structure:

```js
import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";

export const TRAINING_WEIGHT_ITEM_FLAG = "trainingWeightItem";
export const TRAINING_WEIGHT_TECHNIQUE_FLAG = "trainingWeightTechnique";

export const TRAINING_WEIGHT_TABLE = Object.freeze({
  1: Object.freeze({ weight: 25, rankPenalty: 1, learnBonus: 1, learnedStrengthRank: 1 }),
  2: Object.freeze({ weight: 37.5, rankPenalty: 2, learnBonus: 2, learnedStrengthRank: 2 }),
  3: Object.freeze({ weight: 50, rankPenalty: 3, learnBonus: 3, learnedStrengthRank: 3 }),
  4: Object.freeze({ weight: 62.5, rankPenalty: 4, learnBonus: 4, learnedStrengthRank: 4 }),
  5: Object.freeze({ weight: 75, rankPenalty: 5, learnBonus: 5, learnedStrengthRank: 5 }),
  6: Object.freeze({ weight: 150, rankPenalty: 6, learnBonus: 5, learnedStrengthRank: 6 }),
  7: Object.freeze({ weight: 250, rankPenalty: 8, learnBonus: 5, learnedStrengthRank: 8 }),
  8: Object.freeze({ weight: 500, rankPenalty: 10, learnBonus: 5, learnedStrengthRank: 10 }),
});

export function getTrainingWeightItemFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[TRAINING_WEIGHT_ITEM_FLAG];
  if (!flag) return null;
  if (!["wrist", "ankle"].includes(flag.slot)) return null;
  if (!TRAINING_WEIGHT_TABLE[Number(flag.type)]) return null;
  return {
    slot: flag.slot,
    type: Number(flag.type),
    rankPenalty: Number(flag.rankPenalty ?? TRAINING_WEIGHT_TABLE[flag.type].rankPenalty),
    learnBonus: Number(flag.learnBonus ?? TRAINING_WEIGHT_TABLE[flag.type].learnBonus),
  };
}

export function getTrainingWeightTechniqueFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[TRAINING_WEIGHT_TECHNIQUE_FLAG];
  if (!flag) return null;
  return {
    eligibleRankKey: ["KOUSOKU", "JOURYOKU"].includes(flag.eligibleRankKey) ? flag.eligibleRankKey : "",
    learnedStrengthRank: Math.max(0, Number(flag.learnedStrengthRank) || 0),
  };
}
```

- [ ] **Step 2: Add equipped-item selection, learned JOURYOKU lookup, and carry-ignore math**

Continue the file with these exported helpers:

```js
function isEffectiveTrainingWeightItem(item) {
  const flag = getTrainingWeightItemFlag(item);
  if (!flag) return false;
  if (item?.type !== "loot") return false;
  if (item?.system?.subType !== "gear") return false;
  if (!item?.isPhysical) return false;
  if (item?.inContainer) return false;
  if (!item?.isActive) return false;
  if ((Number(item?.system?.quantity ?? 0) || 0) <= 0) return false;
  if (item?.system?.carried === false) return false;
  return true;
}

function chooseSlotItem(actor, slot) {
  let chosen = null;
  for (const item of actor?.items ?? []) {
    if (!isEffectiveTrainingWeightItem(item)) continue;
    const flag = getTrainingWeightItemFlag(item);
    if (!flag || flag.slot !== slot) continue;
    const candidate = {
      itemId: item.id ?? item._id ?? item.name,
      slot,
      type: flag.type,
      rankPenalty: flag.rankPenalty,
      learnBonus: flag.learnBonus,
      weight: Number(item.system?.weight?.total ?? item.system?.weight?.value ?? TRAINING_WEIGHT_TABLE[flag.type].weight) || 0,
    };
    if (!chosen || candidate.type > chosen.type || (candidate.type === chosen.type && String(candidate.itemId).localeCompare(String(chosen.itemId)) < 0)) {
      chosen = candidate;
    }
  }
  return chosen;
}

export function getHighestLearnedStrengthRank(actor) {
  let highest = 0;
  for (const item of actor?.items ?? []) {
    if (item?.type !== TECHNIQUE_ITEM_TYPE) continue;
    if (item?.system?.learning?.learned !== true) continue;
    const flag = getTrainingWeightTechniqueFlag(item);
    if (!flag) continue;
    highest = Math.max(highest, flag.learnedStrengthRank);
  }
  return highest;
}

export function getIgnoredTrainingWeightTotal(actor) {
  const highest = getHighestLearnedStrengthRank(actor);
  let total = 0;
  for (const item of actor?.items ?? []) {
    if (!isEffectiveTrainingWeightItem(item)) continue;
    const flag = getTrainingWeightItemFlag(item);
    const row = TRAINING_WEIGHT_TABLE[flag.type];
    if (highest >= row.learnedStrengthRank) {
      total += Number(item.system?.weight?.total ?? item.system?.weight?.value ?? row.weight) || 0;
    }
  }
  return total;
}

export function getTrainingWeightState(actor) {
  const wrist = chooseSlotItem(actor, "wrist");
  const ankle = chooseSlotItem(actor, "ankle");
  const highestLearnedStrengthRank = getHighestLearnedStrengthRank(actor);
  const hasFullSet = Boolean(wrist && ankle);
  const fullSetType = hasFullSet ? Math.min(wrist.type, ankle.type) : null;
  const fullSetLearnBonus = fullSetType ? TRAINING_WEIGHT_TABLE[fullSetType].learnBonus : 0;
  return {
    wrist,
    ankle,
    hasFullSet,
    fullSetType,
    fullSetLearnBonus,
    strengthRankPenalty: wrist?.rankPenalty ?? 0,
    speedRankPenalty: ankle?.rankPenalty ?? 0,
    highestLearnedStrengthRank,
    ignoredCarryWeight: getIgnoredTrainingWeightTotal(actor),
  };
}

export function getTrainingWeightLearnBonus(actor, technique) {
  const state = getTrainingWeightState(actor);
  if (!state.hasFullSet) return null;
  const flag = getTrainingWeightTechniqueFlag(technique);
  if (!flag?.eligibleRankKey) return null;
  return {
    value: state.fullSetLearnBonus,
    type: state.fullSetType,
    eligibleRankKey: flag.eligibleRankKey,
  };
}
```

- [ ] **Step 3: Run the targeted helper tests**

Run: `npm test -- --test-name-pattern="training weight state"`

Expected: PASS.

- [ ] **Step 4: Commit the helper module**

```bash
git add scripts/data/training-weights.mjs tests/helpers.test.mjs
git commit -m "feat(training-weight): add derived weight helpers"
```

### Task 3: Inject Training Weight Bonus into Learn and Mastery Rolls

**Files:**
- Modify: `tests/helpers.test.mjs`
- Modify: `scripts/data/bonus-sources.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Add a failing breakdown test**

Add these imports near the top of `tests/helpers.test.mjs`:

```js
import { buildLearnCheckBreakdown } from "../scripts/data/bonus-sources.mjs";
```

Add this test block below the Training Weight helper tests:

```js
describe("training weight learn breakdown", () => {
  it("injects the full-set bonus only for explicitly eligible techniques", () => {
    globalThis.game.i18n = {
      localize: (key) => key,
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
    };

    const actor = {
      flags: {
        "naruto-d20": {
          learn: {
            tai: {
              base: 7,
              abilityMod: 3,
              abilityLabel: "Str",
              buffBonus: 0,
              synergyBonus: 0,
              miscBonus: 0,
            },
          },
        },
      },
      sourceInfo: {},
      items: [
        {
          id: "w3",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 50 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "wrist", type: 3, rankPenalty: 3, learnBonus: 3 },
            },
          },
        },
        {
          id: "a2",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 37.5 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "ankle", type: 2, rankPenalty: 2, learnBonus: 2 },
            },
          },
        },
      ],
    };

    const eligible = {
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "KOUSOKU",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    const ineligible = {
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    assert.equal(
      buildLearnCheckBreakdown(actor, "tai", { item: eligible, includeConditional: true }).parts.at(-1),
      "2[NarutoD20.Breakdown.TrainingWeight]",
    );
    assert.equal(
      buildLearnCheckBreakdown(actor, "tai", { item: ineligible, includeConditional: true }).parts.at(-1),
      "3[Str]",
    );
  });
});
```

- [ ] **Step 2: Run the targeted breakdown test**

Run: `npm test -- --test-name-pattern="training weight learn breakdown"`

Expected: FAIL because `buildLearnCheckBreakdown()` does not yet add the Training Weight row.

- [ ] **Step 3: Import and inject the conditional bonus inside `buildLearnCheckBreakdown`**

In `scripts/data/bonus-sources.mjs`, add this import:

```js
import { getTrainingWeightLearnBonus } from "./training-weights.mjs";
```

Then, just before the final `return { parts, sources };`, add:

```js
  const trainingWeight = item ? getTrainingWeightLearnBonus(actor, item) : null;
  if (trainingWeight) {
    const label = game.i18n.localize("NarutoD20.Breakdown.TrainingWeight");
    parts.push(`${trainingWeight.value}[${label}]`);
    sources.push({ name: label, value: trainingWeight.value, builtIn: false });
  }
```

- [ ] **Step 4: Add the new i18n key before the test expects it**

Add this key to both `lang/en.json` and `lang/pt-BR.json`:

```json
"NarutoD20.Breakdown.TrainingWeight": "Training Weight"
```

For `pt-BR`, use:

```json
"NarutoD20.Breakdown.TrainingWeight": "Peso de Treino"
```

- [ ] **Step 5: Run the targeted test and the full test suite**

Run: `npm test -- --test-name-pattern="training weight learn breakdown"`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit the roll-breakdown integration**

```bash
git add scripts/data/bonus-sources.mjs tests/helpers.test.mjs lang/en.json lang/pt-BR.json
git commit -m "feat(training-weight): add learn and mastery bonus"
```

### Task 4: Apply Training Weight Penalties to Effective Ranks

**Files:**
- Modify: `tests/helpers.test.mjs`
- Modify: `scripts/automation/rank-effective-level.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Add a failing rank-integration test**

Add this import near the other automation imports in `tests/helpers.test.mjs`:

```js
import { computeEffectiveRank } from "../scripts/automation/rank-effective-level.mjs";
```

Add this test block near the rank-related tests:

```js
describe("training weight rank penalties", () => {
  const activeRankBuff = ({ id, key, level }) => ({
    id,
    type: "buff",
    system: { active: true, level },
    flags: {
      "naruto-d20": {
        maintenanceBuff: { key, grantType: "paid" },
      },
    },
  });

  const weight = ({ id, slot, type, rankPenalty }) => ({
    id,
    type: "loot",
    system: {
      subType: "gear",
      quantity: 1,
      carried: true,
      equipped: true,
      weight: { total: 25 },
    },
    isPhysical: true,
    isActive: true,
    inContainer: false,
    flags: {
      "naruto-d20": {
        trainingWeightItem: { slot, type, rankPenalty, learnBonus: Math.min(type, 5) },
      },
    },
  });

  it("subtracts wrist penalties from effective JOURYOKU and ankle penalties from effective KOUSOKU", () => {
    const actor = {
      items: [
        activeRankBuff({ id: "jr5", key: "JOURYOKU", level: 5 }),
        activeRankBuff({ id: "kr4", key: "KOUSOKU", level: 4 }),
        weight({ id: "w2", slot: "wrist", type: 2, rankPenalty: 2 }),
        weight({ id: "a3", slot: "ankle", type: 3, rankPenalty: 3 }),
      ],
      statuses: new Set(),
    };

    assert.deepEqual(computeEffectiveRank(actor, "JOURYOKU", { rollData: { armor: { type: 0 } } }), {
      paid: 5,
      temp: 0,
      bonus: 0,
      penalty: 2,
      effective: 3,
      carrierId: "jr5",
    });

    assert.deepEqual(computeEffectiveRank(actor, "KOUSOKU", { rollData: { armor: { type: 0 } } }), {
      paid: 4,
      temp: 0,
      bonus: 0,
      penalty: 3,
      effective: 1,
      carrierId: "kr4",
    });
  });
});
```

- [ ] **Step 2: Run the targeted rank test**

Run: `npm test -- --test-name-pattern="training weight rank penalties"`

Expected: FAIL because `computeEffectiveRank()` does not yet read Training Weight penalties.

- [ ] **Step 3: Import the Training Weight helper and fold penalties into `computeEffectiveRank`**

In `scripts/automation/rank-effective-level.mjs`, add:

```js
import { getTrainingWeightState } from "../data/training-weights.mjs";
```

Then replace the penalty computation in `computeEffectiveRank()` with:

```js
  const trainingWeight = getTrainingWeightState(actor);
  const extraPenalty =
    key === "KOUSOKU"
      ? trainingWeight.speedRankPenalty
      : key === "JOURYOKU"
        ? trainingWeight.strengthRankPenalty
        : 0;
  const basePenalty = key === "KOUSOKU" ? speedRankPenalty(actor, rollData) : 0;
  const penalty = basePenalty === Infinity ? Infinity : basePenalty + extraPenalty;
```

Leave the existing KOUSOKU armor/condition logic intact.

- [ ] **Step 4: Run the targeted rank test and the full suite**

Run: `npm test -- --test-name-pattern="training weight rank penalties"`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit the rank-penalty integration**

```bash
git add scripts/automation/rank-effective-level.mjs tests/helpers.test.mjs
git commit -m "feat(training-weight): penalize effective ranks"
```

### Task 5: Patch Actor Carry Weight Without Mutating Item Documents

**Files:**
- Create: `scripts/automation/training-weight-carry.mjs`
- Modify: `scripts/main.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Create the ActorPF carried-weight patch**

Create `scripts/automation/training-weight-carry.mjs`:

```js
import { getIgnoredTrainingWeightTotal } from "../data/training-weights.mjs";

export function registerTrainingWeightCarryPatch() {
  const ActorPF = pf1?.documents?.actor?.ActorPF;
  if (!ActorPF) return;
  if (ActorPF.prototype.__nd20TrainingWeightCarryPatched) return;

  const original = ActorPF.prototype.getCarriedWeight;
  ActorPF.prototype.getCarriedWeight = function patchedGetCarriedWeight(...args) {
    const total = original.apply(this, args);
    const ignoredRaw = getIgnoredTrainingWeightTotal(this);
    const ignored = pf1.utils.convertWeight(ignoredRaw);
    return Math.max(0, total - ignored);
  };

  Object.defineProperty(ActorPF.prototype, "__nd20TrainingWeightCarryPatched", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}
```

- [ ] **Step 2: Register the patch during setup**

In `scripts/main.mjs`, add this import:

```js
import { registerTrainingWeightCarryPatch } from "./automation/training-weight-carry.mjs";
```

Then call it inside the `Hooks.once("setup", ...)` block, near the other automation registration calls:

```js
  registerTrainingWeightCarryPatch(); // subtract ignored Training Weight mass from encumbrance
```

- [ ] **Step 3: Run the existing test suite**

Run: `npm test`

Expected: PASS. The carry-weight patch itself is Foundry-facing and is verified manually later; the pure carry-ignore math is already covered by Task 1 tests.

- [ ] **Step 4: Commit the carry-weight integration**

```bash
git add scripts/automation/training-weight-carry.mjs scripts/main.mjs
git commit -m "feat(training-weight): ignore learned weight in encumbrance"
```

### Task 6: Add the Training Weight Compendium and Validation Plumbing

**Files:**
- Modify: `module.json`
- Modify: `package.json`
- Modify: `tools/validate-compendia.mjs`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_I__TrnWtWrstT1A1.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_II__TrnWtWrstT2A2.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_III__TrnWtWrstT3A3.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_IV__TrnWtWrstT4A4.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_V__TrnWtWrstT5A5.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_VI__TrnWtWrstT6A6.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_VII__TrnWtWrstT7A7.json`
- Create: `packs/_source/training-weights/Wrist_Weight_Type_VIII__TrnWtWrstT8A8.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_I__TrnWtAnklT1B1.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_II__TrnWtAnklT2B2.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_III__TrnWtAnklT3B3.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_IV__TrnWtAnklT4B4.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_V__TrnWtAnklT5B5.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_VI__TrnWtAnklT6B6.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_VII__TrnWtAnklT7B7.json`
- Create: `packs/_source/training-weights/Ankle_Weight_Type_VIII__TrnWtAnklT8B8.json`

- [ ] **Step 1: Add manifest and package-script support for the new pack**

In `module.json`, add this pack entry:

```json
{
  "name": "training-weights",
  "label": "Training Weights",
  "path": "packs/training-weights",
  "type": "Item",
  "system": "pf1"
}
```

Also add `"training-weights"` to the `packFolders[0].packs` array.

In `package.json`, add:

```json
"pack:training-weights": "node node_modules/@foundryvtt/foundryvtt-cli/fvtt.mjs package pack --id naruto-d20 --type Module --compendiumName training-weights --in packs/_source/training-weights --out packs",
"unpack:training-weights": "node node_modules/@foundryvtt/foundryvtt-cli/fvtt.mjs package unpack --id naruto-d20 --type Module --compendiumName training-weights --in packs --out packs/_source/training-weights",
```

Update:

```json
"pack:all": "npm run pack && npm run pack:buffs && npm run pack:feats && npm run pack:classes && npm run pack:training-weights",
"unpack:all": "npm run unpack && npm run unpack:buffs && npm run unpack:feats && npm run unpack:classes && npm run unpack:training-weights",
```

- [ ] **Step 2: Extend compendium validation**

In `tools/validate-compendia.mjs`, add the new pack:

```js
  { name: "training-weights", dir: "training-weights", type: "loot" },
```

Add this validator:

```js
function validateTrainingWeight(packName, filename, doc) {
  if (doc.system?.subType !== "gear") {
    error(packName, filename, `training weight items must use loot subtype "gear"`);
  }

  const flag = doc.flags?.["naruto-d20"]?.trainingWeightItem;
  if (!isPlainObject(flag)) {
    error(packName, filename, "missing flags.naruto-d20.trainingWeightItem");
    return;
  }

  if (!["wrist", "ankle"].includes(flag.slot)) {
    error(packName, filename, `trainingWeightItem.slot must be "wrist" or "ankle"`);
  }
  if (!isIntegerInRange(Number(flag.type), 1, 8)) {
    error(packName, filename, "trainingWeightItem.type must be 1..8");
  }
  if (!Number.isFinite(Number(doc.system?.weight?.value ?? doc.system?.weight))) {
    error(packName, filename, "training weight must define numeric system.weight.value");
  }
}
```

Then call it from the pack loop:

```js
if (packName === "training-weights") validateTrainingWeight(packName, filename, doc);
```

- [ ] **Step 3: Create the 16 item JSON files**

Use this base JSON for wrist weights:

```json
{
  "type": "loot",
  "name": "Wrist Weight Type I",
  "img": "icons/tools/smithing/anvil.webp",
  "system": {
    "description": {
      "value": "<p>Training weight worn on the wrists. While equipped, it penalizes effective Strength Rank. Together with an equipped ankle weight, it grants a Learn/Mastery bonus for explicitly marked rank-training techniques.</p>",
      "unidentified": ""
    },
    "subType": "gear",
    "quantity": 1,
    "carried": true,
    "equipped": false,
    "identified": true,
    "weight": {
      "value": 25
    },
    "price": 0
  },
  "flags": {
    "naruto-d20": {
      "trainingWeightItem": {
        "slot": "wrist",
        "type": 1,
        "rankPenalty": 1,
        "learnBonus": 1
      }
    }
  },
  "ownership": {
    "default": 0
  }
}
```

Use this base JSON for ankle weights:

```json
{
  "type": "loot",
  "name": "Ankle Weight Type I",
  "img": "icons/tools/smithing/anvil.webp",
  "system": {
    "description": {
      "value": "<p>Training weight worn on the ankles. While equipped, it penalizes effective Speed Rank. Together with an equipped wrist weight, it grants a Learn/Mastery bonus for explicitly marked rank-training techniques.</p>",
      "unidentified": ""
    },
    "subType": "gear",
    "quantity": 1,
    "carried": true,
    "equipped": false,
    "identified": true,
    "weight": {
      "value": 25
    },
    "price": 0
  },
  "flags": {
    "naruto-d20": {
      "trainingWeightItem": {
        "slot": "ankle",
        "type": 1,
        "rankPenalty": 1,
        "learnBonus": 1
      }
    }
  },
  "ownership": {
    "default": 0
  }
}
```

Apply this exact table across the 16 files:

| Filename prefix | `slot` | `type` | `weight.value` | `rankPenalty` | `learnBonus` |
| --- | --- | --- | --- | --- | --- |
| `Wrist_Weight_Type_I__TrnWtWrstT1A1.json` | `wrist` | 1 | `25` | `1` | `1` |
| `Wrist_Weight_Type_II__TrnWtWrstT2A2.json` | `wrist` | 2 | `37.5` | `2` | `2` |
| `Wrist_Weight_Type_III__TrnWtWrstT3A3.json` | `wrist` | 3 | `50` | `3` | `3` |
| `Wrist_Weight_Type_IV__TrnWtWrstT4A4.json` | `wrist` | 4 | `62.5` | `4` | `4` |
| `Wrist_Weight_Type_V__TrnWtWrstT5A5.json` | `wrist` | 5 | `75` | `5` | `5` |
| `Wrist_Weight_Type_VI__TrnWtWrstT6A6.json` | `wrist` | 6 | `150` | `6` | `5` |
| `Wrist_Weight_Type_VII__TrnWtWrstT7A7.json` | `wrist` | 7 | `250` | `8` | `5` |
| `Wrist_Weight_Type_VIII__TrnWtWrstT8A8.json` | `wrist` | 8 | `500` | `10` | `5` |
| `Ankle_Weight_Type_I__TrnWtAnklT1B1.json` | `ankle` | 1 | `25` | `1` | `1` |
| `Ankle_Weight_Type_II__TrnWtAnklT2B2.json` | `ankle` | 2 | `37.5` | `2` | `2` |
| `Ankle_Weight_Type_III__TrnWtAnklT3B3.json` | `ankle` | 3 | `50` | `3` | `3` |
| `Ankle_Weight_Type_IV__TrnWtAnklT4B4.json` | `ankle` | 4 | `62.5` | `4` | `4` |
| `Ankle_Weight_Type_V__TrnWtAnklT5B5.json` | `ankle` | 5 | `75` | `5` | `5` |
| `Ankle_Weight_Type_VI__TrnWtAnklT6B6.json` | `ankle` | 6 | `150` | `6` | `5` |
| `Ankle_Weight_Type_VII__TrnWtAnklT7B7.json` | `ankle` | 7 | `250` | `8` | `5` |
| `Ankle_Weight_Type_VIII__TrnWtAnklT8B8.json` | `ankle` | 8 | `500` | `10` | `5` |

For each file, set `_id`, `_key`, and `_stats` consistently with the filename/id you chose.

- [ ] **Step 4: Validate and pack the new source**

Run: `npm run validate:compendia`

Expected: PASS with the new `training-weights` source included.

Run: `npm run pack:training-weights`

Expected: PASS and update `packs/training-weights/`.

- [ ] **Step 5: Commit pack plumbing and source items**

```bash
git add module.json package.json tools/validate-compendia.mjs packs/_source/training-weights packs/training-weights
git commit -m "feat(training-weight): add equipment compendium"
```

### Task 7: Mark Eligible Techniques and Update Manual QA

**Files:**
- Modify: `packs/_source/techniques/SHODAN_JOURYOKU__RANK_ONE_STRENGTH__7fzducOMNE63HYKB.json`
- Modify: `packs/_source/techniques/NIDAN_JOURYOKU__RANK_TWO_STRENGTH__J9xySG2rHMr9SpUW.json`
- Modify: `packs/_source/techniques/SANDAN_JOURYOKU__RANK_THREE_STRENGTH__isX30Z0iheQ8KHsX.json`
- Modify: `packs/_source/techniques/YONDAN_JOURYOKU__RANK_FOUR_STRENGTH__ujan06r0vx0nXOKm.json`
- Modify: `packs/_source/techniques/GODAN_JOURYOKU__RANK_FIVE_STRENGTH__Zvw1qeiVouLNN07R.json`
- Modify: `packs/_source/techniques/SHODAN_KOUSOKU__RANK_ONE_SPEED__TRCgxJOvq2Kk8cDI.json`
- Modify: `packs/_source/techniques/NIDAN_KOUSOKU__RANK_TWO_SPEED__T8XcfdviCklzMsnb.json`
- Modify: `packs/_source/techniques/SANDAN_KOUSOKU__RANK_THREE_SPEED__E6EsTFPCMQhE5fI0.json`
- Modify: `packs/_source/techniques/YONDAN_KOUSOKU__RANK_FOUR_SPEED__rO5N1fZdtz9vM1M7.json`
- Modify: `packs/_source/techniques/GODAN_KOUSOKU__RANK_FIVE_SPEED__Hf6OyWsMtqJF7ndD.json`
- Modify: `docs/manual-qa.md`

- [ ] **Step 1: Add explicit technique metadata to the five JOURYOKU techniques**

Add this flag object to each JOURYOKU technique file, adjusting `learnedStrengthRank` per file:

```json
"flags": {
  "naruto-d20": {
    "trainingWeightTechnique": {
      "eligibleRankKey": "JOURYOKU",
      "learnedStrengthRank": 1
    }
  }
}
```

Use these exact `learnedStrengthRank` values:

| File | `learnedStrengthRank` |
| --- | --- |
| `SHODAN_JOURYOKU__RANK_ONE_STRENGTH__7fzducOMNE63HYKB.json` | `1` |
| `NIDAN_JOURYOKU__RANK_TWO_STRENGTH__J9xySG2rHMr9SpUW.json` | `2` |
| `SANDAN_JOURYOKU__RANK_THREE_STRENGTH__isX30Z0iheQ8KHsX.json` | `3` |
| `YONDAN_JOURYOKU__RANK_FOUR_STRENGTH__ujan06r0vx0nXOKm.json` | `4` |
| `GODAN_JOURYOKU__RANK_FIVE_STRENGTH__Zvw1qeiVouLNN07R.json` | `5` |

- [ ] **Step 2: Add explicit technique metadata to the five KOUSOKU techniques**

Add this flag object to each KOUSOKU technique file:

```json
"flags": {
  "naruto-d20": {
    "trainingWeightTechnique": {
      "eligibleRankKey": "KOUSOKU",
      "learnedStrengthRank": 0
    }
  }
}
```

Do **not** mark `packs/_source/techniques/NINJOURYOKU_NO_JUTSU__EMPATHY_POWER_TECHNIQUE__MKvxJ0tMilqKZq1m.json`.

- [ ] **Step 3: Add manual QA coverage**

Append this section to `docs/manual-qa.md`:

```md
## Training Weight

1. Drag `Wrist Weight Type III` to a test actor and equip it.
   Expected: effective JOURYOKU benefits drop by 3 while equipped.

2. Drag `Ankle Weight Type II` to the same actor and equip it.
   Expected: effective KOUSOKU benefits drop by 2 while equipped.
   Expected: learning/mastering an explicitly marked KOUSOKU or JOURYOKU technique gains a +2 Training Weight row in the roll breakdown.

3. Learn `SANDAN JOURYOKU` on a test actor without activating any JOURYOKU buff.
   Expected: Type I, II, and III wrist/ankle items count as 0 carried weight.
   Expected: higher Types still count toward carried weight.

4. Equip two wrist weights of different Types and one ankle weight.
   Expected: only the highest-Type wrist weight applies; there is no stacking across duplicate halves.

5. Learn or master a technique without `trainingWeightTechnique.eligibleRankKey`.
   Expected: no Training Weight bonus appears in the breakdown even with a full set equipped.
```

- [ ] **Step 4: Run validation, pack, tests, and lint**

Run: `npm run validate:compendia`

Expected: PASS.

Run: `npm run pack`

Expected: PASS for the techniques compendium.

Run: `npm run pack:training-weights`

Expected: PASS for the Training Weights compendium.

Run: `npm test`

Expected: PASS.

Run: `npm run lint:js`

Expected: PASS.

- [ ] **Step 5: Commit metadata and QA updates**

```bash
git add packs/_source/techniques docs/manual-qa.md packs/techniques
git commit -m "feat(training-weight): mark rank techniques explicitly"
```

## Self-Review

- Spec coverage check:
  - New equippable compendium items: covered in Task 6.
  - Explicit technique metadata: covered in Task 7.
  - Conditional Learn/Mastery bonus only for explicit techniques: covered in Tasks 1, 2, and 3.
  - Rank penalties on effective JOURYOKU/KOUSOKU: covered in Task 4.
  - Highest learned JOURYOKU controls ignored carry weight, independent of active buff: covered in Tasks 1, 2, and 5.
  - Full-set lower-Type rule: covered in Tasks 1, 2, and 3.
  - Multiple same-slot items not stacking: covered in Tasks 1 and 7.
- Placeholder scan:
  - No `TODO`, `TBD`, “similar to,” or undefined helper names remain.
- Type consistency:
  - Item flag path: `trainingWeightItem`
  - Technique flag path: `trainingWeightTechnique`
  - Helper names are consistent across tests, pure module, rank integration, and carry patch.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-training-weight.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
