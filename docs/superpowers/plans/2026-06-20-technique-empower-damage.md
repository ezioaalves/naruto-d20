# Technique Empower Damage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-phase generic Empower automation for techniques that spend extra chakra to add damage to the current technique roll.

**Architecture:** Add explicit `system.automation.empower` metadata to technique items, default it through the same normalizer used by Synckit, and resolve an Empower context during `performTechnique()`. Apply the selected extra damage through PF1e's action-use hook for direct technique actions and delegated `weaponAttack` actions, then spend base plus Empower chakra through the existing chakra spend path.

**Tech Stack:** Foundry VTT 13, PF1e v11.11, JavaScript ESM, Node test runner, Handlebars, compendium source JSON

---

### Task 1: Add Empower schema and defaults

**Files:**
- Modify: `scripts/data/technique-model.mjs`
- Modify: `scripts/data/technique-defaults.mjs`
- Modify: `tests/helpers.test.mjs`

- [ ] **Step 1: Write the failing defaults test**

In `tests/helpers.test.mjs`, inside `describe("technique defaults", ...)`, extend the first defaults test with:

```js
assert.deepEqual(system.automation.empower, {
  enabled: false,
  mode: "damageBonus",
  costPerStep: 1,
  formulaPerStep: "1d6",
  damageTypes: [],
  maxStepsFormula: "",
  performIncreaseEvery: 0,
  performIncreaseAmount: 0,
});
```

Add a parity guard after the existing maintenance parity test:

```js
it("backfills every automation.empower field declared in the schema", () => {
  const leaf = class {};
  const prevData = globalThis.foundry.data;
  const prevAbstract = globalThis.foundry.abstract;
  globalThis.foundry.abstract = { TypeDataModel: class {} };
  globalThis.foundry.data = {
    fields: {
      SchemaField: class {
        constructor(schema) {
          this.fields = schema;
        }
      },
      ArrayField: class {
        constructor(element) {
          this.element = element;
        }
      },
      SetField: class {
        constructor(element) {
          this.element = element;
        }
      },
      StringField: leaf,
      NumberField: leaf,
      BooleanField: leaf,
      HTMLField: leaf,
      ObjectField: leaf,
    },
  };

  let schemaKeys;
  try {
    const schema = createTechniqueDataModel().defineSchema();
    schemaKeys = Object.keys(schema.automation.fields.empower.fields).sort();
  } finally {
    globalThis.foundry.data = prevData;
    globalThis.foundry.abstract = prevAbstract;
  }

  const normalizerKeys = Object.keys(applyTechniqueSystemDefaults({}).automation.empower).sort();

  assert.deepEqual(
    normalizerKeys,
    schemaKeys,
    "applyTechniqueSystemDefaults must default every automation.empower schema field " +
      "(see scripts/data/technique-defaults.mjs) or synckit will flag unedited techniques out-of-date",
  );
});
```

- [ ] **Step 2: Run the focused failing test**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "technique defaults"`

Expected: FAIL because `system.automation.empower` and `schema.automation.fields.empower` do not exist yet.

- [ ] **Step 3: Add the TypeDataModel schema**

In `scripts/data/technique-model.mjs`, inside the existing `automation: new fields.SchemaField({ ... })` block, add this sibling next to `targetMode` and `maintenance`:

```js
empower: new fields.SchemaField(
  {
    enabled: new fields.BooleanField({ ...opt, initial: false }),
    mode: new fields.StringField({
      ...opt,
      blank: false,
      initial: "damageBonus",
      choices: ["damageBonus"],
    }),
    costPerStep: new fields.NumberField({ ...opt, integer: true, initial: 1, min: 1 }),
    formulaPerStep: new fields.StringField({ ...opt, blank: true, initial: "1d6" }),
    damageTypes: new fields.ArrayField(
      new fields.StringField({ blank: false, required: true }),
      { ...opt, initial: [] },
    ),
    maxStepsFormula: new fields.StringField({ ...opt, blank: true, initial: "" }),
    performIncreaseEvery: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    performIncreaseAmount: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
  },
  opt,
),
```

- [ ] **Step 4: Add normalizer defaults**

In `scripts/data/technique-defaults.mjs`, after `system.automation.targetMode ??= "auto";`, add:

```js
system.automation.empower ??= {};
const e = system.automation.empower;
e.enabled ??= false;
e.mode ??= "damageBonus";
e.costPerStep ??= 1;
e.formulaPerStep ??= "1d6";
e.damageTypes ??= [];
e.maxStepsFormula ??= "";
e.performIncreaseEvery ??= 0;
e.performIncreaseAmount ??= 0;
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "technique defaults"`

Expected: PASS for the defaults and schema/default parity checks.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/technique-model.mjs scripts/data/technique-defaults.mjs tests/helpers.test.mjs
git commit -m "feat(techniques): add empower automation schema"
```

### Task 2: Add pure Empower resolution helpers

**Files:**
- Create: `scripts/automation/technique-empower.mjs`
- Modify: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing helper tests**

In `tests/helpers.test.mjs`, add this import:

```js
import {
  buildEmpowerDamageFormula,
  empowerPerformIncrease,
  normalizeEmpowerConfig,
  resolveEmpowerStepLimit,
} from "../scripts/automation/technique-empower.mjs";
```

Add this test block near other pure helper tests:

```js
describe("technique empower helpers", () => {
  it("normalizes disabled and enabled config", () => {
    assert.equal(normalizeEmpowerConfig({})?.enabled, false);
    assert.deepEqual(
      normalizeEmpowerConfig({
        enabled: true,
        mode: "damageBonus",
        costPerStep: 2,
        formulaPerStep: "1d8",
        damageTypes: ["fire"],
        maxStepsFormula: "@cl - 5",
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      }),
      {
        enabled: true,
        mode: "damageBonus",
        costPerStep: 2,
        formulaPerStep: "1d8",
        damageTypes: ["fire"],
        maxStepsFormula: "@cl - 5",
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      },
    );
  });

  it("builds readable damage formulas", () => {
    assert.equal(buildEmpowerDamageFormula({ steps: 0, formulaPerStep: "1d6" }), "");
    assert.equal(buildEmpowerDamageFormula({ steps: 3, formulaPerStep: "1d6" }), "3d6[Empower]");
    assert.equal(buildEmpowerDamageFormula({ steps: 2, formulaPerStep: "1d8" }), "2d8[Empower]");
    assert.equal(buildEmpowerDamageFormula({ steps: 2, formulaPerStep: "1d6+1" }), "2 * (1d6+1)[Empower]");
  });

  it("computes perform DC increases by complete groups", () => {
    assert.equal(
      empowerPerformIncrease({
        steps: 5,
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      }),
      2,
    );
    assert.equal(
      empowerPerformIncrease({
        steps: 5,
        performIncreaseEvery: 0,
        performIncreaseAmount: 1,
      }),
      0,
    );
  });

  it("caps steps by formula, available chakra, and cost per step", async () => {
    assert.equal(
      await resolveEmpowerStepLimit({
        config: { maxStepsFormula: "@cl - 7", costPerStep: 1 },
        rollData: { cl: 11 },
        availableExtraChakra: 10,
      }),
      4,
    );
    assert.equal(
      await resolveEmpowerStepLimit({
        config: { maxStepsFormula: "", costPerStep: 2 },
        rollData: { cl: 20 },
        availableExtraChakra: 5,
      }),
      2,
    );
  });
});
```

- [ ] **Step 2: Run the failing helper tests**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "technique empower helpers"`

Expected: FAIL with module/function not found errors.

- [ ] **Step 3: Create the helper module**

Create `scripts/automation/technique-empower.mjs`:

```js
const SUPPORTED_MODES = new Set(["damageBonus"]);
const SIMPLE_DIE_RE = /^1d(\d+)$/i;

export function normalizeEmpowerConfig(raw = {}) {
  const mode = String(raw.mode ?? "damageBonus").trim() || "damageBonus";
  return {
    enabled: raw.enabled === true,
    mode: SUPPORTED_MODES.has(mode) ? mode : "damageBonus",
    costPerStep: Math.max(1, Number(raw.costPerStep ?? 1) || 1),
    formulaPerStep: String(raw.formulaPerStep ?? "1d6").trim() || "1d6",
    damageTypes: Array.isArray(raw.damageTypes)
      ? raw.damageTypes.map((t) => String(t).trim()).filter(Boolean)
      : [],
    maxStepsFormula: String(raw.maxStepsFormula ?? "").trim(),
    performIncreaseEvery: Math.max(0, Number(raw.performIncreaseEvery ?? 0) || 0),
    performIncreaseAmount: Math.max(0, Number(raw.performIncreaseAmount ?? 0) || 0),
  };
}

export function buildEmpowerDamageFormula({ steps, formulaPerStep }) {
  const count = Math.max(0, Number(steps) || 0);
  if (count <= 0) return "";

  const formula = String(formulaPerStep ?? "").trim();
  const die = formula.match(SIMPLE_DIE_RE);
  if (die) return `${count}d${die[1]}[Empower]`;
  return `${count} * (${formula})[Empower]`;
}

export function empowerPerformIncrease({
  steps,
  performIncreaseEvery,
  performIncreaseAmount,
}) {
  const every = Math.max(0, Number(performIncreaseEvery) || 0);
  const amount = Math.max(0, Number(performIncreaseAmount) || 0);
  if (!every || !amount) return 0;
  return Math.floor((Math.max(0, Number(steps) || 0) / every)) * amount;
}

export async function resolveEmpowerStepLimit({ config, rollData = {}, availableExtraChakra }) {
  const costPerStep = Math.max(1, Number(config?.costPerStep ?? 1) || 1);
  const chakraLimit = Math.floor(Math.max(0, Number(availableExtraChakra) || 0) / costPerStep);
  const formula = String(config?.maxStepsFormula ?? "").trim();
  if (!formula) return chakraLimit;

  const total = await evaluateFormula(formula, rollData);
  return Math.max(0, Math.min(chakraLimit, Math.floor(Number(total) || 0)));
}

function evaluateFormula(formula, rollData) {
  const normalized = String(formula).replace(/@([a-zA-Z0-9_.]+)/g, (_, path) => {
    const value = path.split(".").reduce((obj, key) => obj?.[key], rollData);
    return Number(value ?? 0);
  });
  return Function("min", "max", "floor", "ceil", `return (${normalized})`)(
    Math.min,
    Math.max,
    Math.floor,
    Math.ceil,
  );
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "technique empower helpers"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/automation/technique-empower.mjs tests/helpers.test.mjs
git commit -m "feat(empower): add damage helper utilities"
```

### Task 3: Integrate Empower into direct technique use

**Files:**
- Modify: `scripts/use-technique.mjs`
- Modify: `scripts/automation/technique-empower.mjs`
- Modify: `tests/helpers.test.mjs`

- [ ] **Step 1: Add failing tests for runtime context helpers**

In `tests/helpers.test.mjs`, extend the Empower import:

```js
import {
  buildEmpowerDamageFormula,
  empowerPerformIncrease,
  normalizeEmpowerConfig,
  resolveEmpowerStepLimit,
  resolveEmpowerUse,
  shouldPromptEmpowerBeforePerform,
} from "../scripts/automation/technique-empower.mjs";
```

Add these tests inside `describe("technique empower helpers", ...)`:

```js
it("knows when empower must be chosen before perform", () => {
  assert.equal(shouldPromptEmpowerBeforePerform({ performIncreaseEvery: 2 }), true);
  assert.equal(shouldPromptEmpowerBeforePerform({ performIncreaseEvery: 0 }), false);
});

it("builds a use context with total cost and damage formula", () => {
  assert.deepEqual(
    resolveEmpowerUse({
      config: {
        enabled: true,
        mode: "damageBonus",
        costPerStep: 1,
        formulaPerStep: "1d8",
        damageTypes: ["untyped"],
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      },
      steps: 3,
      baseCost: 11,
    }),
    {
      steps: 3,
      extraCost: 3,
      totalCost: 14,
      damageFormula: "3d8[Empower]",
      damageTypes: ["untyped"],
      performIncrease: 1,
    },
  );
});
```

- [ ] **Step 2: Run the failing tests**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "technique empower helpers"`

Expected: FAIL because `resolveEmpowerUse` and `shouldPromptEmpowerBeforePerform` are missing.

- [ ] **Step 3: Add context helper exports**

In `scripts/automation/technique-empower.mjs`, add:

```js
export function shouldPromptEmpowerBeforePerform(config) {
  return Math.max(0, Number(config?.performIncreaseEvery) || 0) > 0;
}

export function resolveEmpowerUse({ config, steps, baseCost }) {
  const count = Math.max(0, Number(steps) || 0);
  const extraCost = count * Math.max(1, Number(config.costPerStep) || 1);
  return {
    steps: count,
    extraCost,
    totalCost: Math.max(0, Number(baseCost) || 0) + extraCost,
    damageFormula: buildEmpowerDamageFormula({
      steps: count,
      formulaPerStep: config.formulaPerStep,
    }),
    damageTypes: [...(config.damageTypes ?? [])],
    performIncrease: empowerPerformIncrease({
      steps: count,
      performIncreaseEvery: config.performIncreaseEvery,
      performIncreaseAmount: config.performIncreaseAmount,
    }),
  };
}
```

- [ ] **Step 4: Add direct-use runtime integration**

In `scripts/use-technique.mjs`, import helpers:

```js
import { availableChakra } from "./data/chakra-spend.mjs";
import {
  normalizeEmpowerConfig,
  resolveEmpowerStepLimit,
  resolveEmpowerUse,
  shouldPromptEmpowerBeforePerform,
} from "./automation/technique-empower.mjs";
```

Update the existing chakra-spend import instead of duplicating it:

```js
import {
  applyChakraSpend,
  availableChakra,
  calculateChakraSpend,
  canPayChakra,
} from "./data/chakra-spend.mjs";
```

Add a resolver near `resolveRankMasteryFreeUseChoice`:

```js
async function resolveEmpowerChoice(item, actor, baseCost) {
  const config = normalizeEmpowerConfig(item.system.automation?.empower);
  if (!config.enabled) return null;

  const rollData = item.getRollData?.() ?? {};
  const availableExtraChakra = Math.max(0, availableChakra(actor) - Math.max(0, Number(baseCost) || 0));
  const maxSteps = await resolveEmpowerStepLimit({ config, rollData, availableExtraChakra });
  if (maxSteps <= 0) return resolveEmpowerUse({ config, steps: 0, baseCost });

  const steps = await promptEmpowerSteps(item, config, maxSteps);
  if (steps === null) return "cancel";
  return resolveEmpowerUse({ config, steps, baseCost });
}

function promptEmpowerSteps(item, config, maxSteps) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const content = `
      <form>
        <p>${game.i18n.format("NarutoD20.Empower.Prompt", {
          name: item.name,
          cost: config.costPerStep,
          formula: config.formulaPerStep,
        })}</p>
        <div class="form-group">
          <label>${game.i18n.localize("NarutoD20.Empower.Steps")}</label>
          <input type="number" name="steps" value="0" min="0" max="${maxSteps}" step="1">
        </div>
      </form>`;

    new Dialog({
      title: game.i18n.format("NarutoD20.Empower.Title", { name: item.name }),
      content,
      buttons: {
        roll: {
          icon: '<i class="fas fa-bolt"></i>',
          label: game.i18n.localize("PF1.Roll"),
          callback: (html) => {
            const raw = Number(html.find("input[name='steps']").val());
            done(Math.max(0, Math.min(maxSteps, Math.floor(raw) || 0)));
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.Common.Cancel"),
          callback: () => done(null),
        },
      },
      default: "roll",
      close: () => done(null),
    }).render(true);
  });
}
```

Change `resolvePerformCheck(item, actor)` to accept an options object:

```js
async function resolvePerformCheck(item, actor, { dcBonus = 0, note = "" } = {}) {
```

Then compute:

```js
const performDC = derived.performDC + Math.max(0, Number(dcBonus) || 0);
const empowerNote = note ? ` ${note}` : "";
```

Append `empowerNote` to the existing `masteryNote` in returned `bypassNote` and failure display strings by using:

```js
const dcNote = `${masteryNote}${empowerNote}`;
```

Use `dcNote` wherever the function currently uses `masteryNote` in user-visible DC text, and return `masteryNote: dcNote`.

In `performTechnique()`, resolve Empower before or after Perform based on config:

```js
const empowerConfig = normalizeEmpowerConfig(currentItem.system.automation?.empower);
let empower = null;

if (!chakraFree && empowerConfig.enabled && shouldPromptEmpowerBeforePerform(empowerConfig)) {
  empower = await resolveEmpowerChoice(currentItem, actor, cost);
  if (empower === "cancel") return;
}

const perform = await resolvePerformCheck(currentItem, actor, {
  dcBonus: empower?.performIncrease ?? 0,
  note:
    empower?.performIncrease > 0
      ? game.i18n.format("NarutoD20.Empower.PerformIncrease", {
          value: empower.performIncrease,
        })
      : "",
});
```

After resolving `current` and before `useTechniqueAction(...)`, prompt for the common case:

```js
if (!chakraFree && empowerConfig.enabled && !empower) {
  empower = await resolveEmpowerChoice(current.item, actor, cost);
  if (empower === "cancel") return;
}
```

Pass the context:

```js
const useResult = await useTechniqueAction(current.item, current.action, actor, event, { empower });
```

When spending chakra, use total cost:

```js
cost = empower?.totalCost ?? current.item.system.chakraCost ?? cost;
spend = calculateChakraSpend(actor, cost);
```

Update `useTechniqueAction` signature and direct hook installation:

```js
async function useTechniqueAction(item, action, actor, event, options = {}) {
```

Add this helper near `installTechniqueAttackAdjustmentsHook`:

```js
function applyEmpowerDamage(actionUse, empower, cleanup) {
  if (!empower?.steps || !empower.damageFormula) return;

  if (empower.damageTypes?.length) {
    const parts = (actionUse.shared.action.damage.parts ??= []);
    const originalLength = parts.length;
    parts.push({ formula: empower.damageFormula, types: [...empower.damageTypes] });
    cleanup.push(() => parts.splice(originalLength));
  } else {
    actionUse.shared.damageBonus.push(empower.damageFormula);
  }
}
```

Extend `installTechniqueAttackAdjustmentsHook` to accept `empower` and call `applyEmpowerDamage(actionUse, empower, cleanup)` inside the scoped hook. Rename the helper to `installTechniqueActionUseHook` and update its only call site so the name reflects both attack adjustments and Empower damage.

- [ ] **Step 5: Run tests and lint the edited files**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "technique empower helpers|technique defaults"`

Expected: PASS.

Run: `npm run lint:js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/use-technique.mjs scripts/automation/technique-empower.mjs tests/helpers.test.mjs
git commit -m "feat(empower): prompt and apply technique damage empower"
```

### Task 4: Integrate Empower into delegated weapon attacks

**Files:**
- Modify: `scripts/ui/technique-weapon-attack.mjs`
- Modify: `scripts/use-technique.mjs`

- [ ] **Step 1: Verify the delegated path accepts no Empower context**

Run: `rg -n "rollSelectedWeaponAttackWithTechnique|applyTechniqueAttackAdjustments|damageBonus.push" scripts/ui/technique-weapon-attack.mjs scripts/use-technique.mjs`

Expected: `rollSelectedWeaponAttackWithTechnique` has no `empower` parameter yet.

- [ ] **Step 2: Thread Empower through the weapon attack call**

In `scripts/use-technique.mjs`, update the delegated call:

```js
return rollSelectedWeaponAttackWithTechnique({
  technique: item,
  techniqueAction: action,
  actor,
  config: weaponAttackConfig,
  event,
  empower: options.empower,
});
```

In `scripts/ui/technique-weapon-attack.mjs`, update the signature:

```js
export async function rollSelectedWeaponAttackWithTechnique({
  technique,
  techniqueAction,
  actor,
  config,
  event,
  empower = null,
}) {
```

Add a local helper matching the direct path:

```js
function applyEmpowerDamage(actionUse, empower, cleanup) {
  if (!empower?.steps || !empower.damageFormula) return;

  if (empower.damageTypes?.length) {
    const parts = (actionUse.shared.action.damage.parts ??= []);
    const originalLength = parts.length;
    parts.push({ formula: empower.damageFormula, types: [...empower.damageTypes] });
    cleanup.push(() => parts.splice(originalLength));
  } else {
    actionUse.shared.damageBonus.push(empower.damageFormula);
  }
}
```

Inside the existing `pf1CreateActionUse` hook, after `applyTechniqueAttackAdjustments(actionUse, technique, cleanup);`, add:

```js
applyEmpowerDamage(actionUse, empower, cleanup);
```

- [ ] **Step 3: Verify no persistent mutation is introduced**

Run: `rg -n "damage\\.parts\\.push|damageBonus\\.push|cleanup\\.push" scripts/ui/technique-weapon-attack.mjs scripts/use-technique.mjs`

Expected: typed damage pushes are paired with `cleanup.push`; untyped damage uses `shared.damageBonus`.

- [ ] **Step 4: Run JS lint**

Run: `npm run lint:js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/use-technique.mjs scripts/ui/technique-weapon-attack.mjs
git commit -m "feat(empower): support delegated weapon attack damage"
```

### Task 5: Add sheet UI and localization

**Files:**
- Modify: `scripts/ui/technique-sheet.mjs`
- Modify: `templates/item/technique-sheet.hbs`
- Modify: `lang/en.json`
- Modify: `lang/pt-BR.json`

- [ ] **Step 1: Add sheet context choices**

In `scripts/ui/technique-sheet.mjs`, after maintenance choice context setup, add:

```js
context.empowerModeChoices = {
  damageBonus: loc("NarutoD20.Empower.Mode.DamageBonus"),
};
const empower = system.automation?.empower ?? {};
context.empowerFields = {
  show: empower.enabled === true,
  hasPerformIncrease: Number(empower.performIncreaseEvery ?? 0) > 0,
};
```

- [ ] **Step 2: Add Automation tab fields**

In `templates/item/technique-sheet.hbs`, inside the Automation tab after the global automation enabled checkbox and before maintenance fields, add:

```hbs
      <h3 class="form-header">{{localize "NarutoD20.Empower.Header"}}</h3>

      <label class="checkbox">
        <input type="checkbox" name="system.automation.empower.enabled" {{checked system.automation.empower.enabled}}>
        {{localize "NarutoD20.Empower.Enabled.Label"}}
      </label>

      {{#if empowerFields.show}}
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.Mode.Label"}}</label>
        <select name="system.automation.empower.mode">
          {{selectOptions empowerModeChoices selected=system.automation.empower.mode}}
        </select>
      </div>
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.CostPerStep.Label"}}</label>
        <input type="number" step="1" min="1" name="system.automation.empower.costPerStep" value="{{system.automation.empower.costPerStep}}">
      </div>
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.FormulaPerStep.Label"}}</label>
        <input type="text" name="system.automation.empower.formulaPerStep" value="{{system.automation.empower.formulaPerStep}}">
      </div>
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.DamageTypes.Label"}}</label>
        <input type="text" name="system.automation.empower.damageTypes" value="{{system.automation.empower.damageTypes}}">
        <p class="hint">{{localize "NarutoD20.Empower.DamageTypes.Hint"}}</p>
      </div>
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.MaxStepsFormula.Label"}}</label>
        <input type="text" name="system.automation.empower.maxStepsFormula" value="{{system.automation.empower.maxStepsFormula}}">
      </div>
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.PerformIncreaseEvery.Label"}}</label>
        <input type="number" step="1" min="0" name="system.automation.empower.performIncreaseEvery" value="{{system.automation.empower.performIncreaseEvery}}">
      </div>
      <div class="form-group">
        <label>{{localize "NarutoD20.Empower.PerformIncreaseAmount.Label"}}</label>
        <input type="number" step="1" min="0" name="system.automation.empower.performIncreaseAmount" value="{{system.automation.empower.performIncreaseAmount}}">
      </div>
      {{/if}}
```

If Foundry persists `ArrayField` badly from a plain text input, replace the `damageTypes` text input with a small helper in `TechniqueItemSheet._updateObject` that splits comma-separated text:

```js
if (typeof formData["system.automation.empower.damageTypes"] === "string") {
  formData["system.automation.empower.damageTypes"] = formData[
    "system.automation.empower.damageTypes"
  ]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
```

- [ ] **Step 3: Add English localization**

In `lang/en.json`, add under `NarutoD20`:

```json
"Empower": {
  "Header": "Empower",
  "Title": "Empower {name}",
  "Prompt": "{name} can spend {cost} chakra per step to add {formula} damage.",
  "Steps": "Empower steps",
  "PerformIncrease": "+{value} Empower",
  "Enabled": {
    "Label": "Automate damage Empower"
  },
  "Mode": {
    "Label": "Mode",
    "DamageBonus": "Damage bonus"
  },
  "CostPerStep": {
    "Label": "Chakra per step"
  },
  "FormulaPerStep": {
    "Label": "Damage per step"
  },
  "DamageTypes": {
    "Label": "Damage types",
    "Hint": "Comma-separated PF1e damage type ids. Leave blank for untyped extra damage."
  },
  "MaxStepsFormula": {
    "Label": "Max steps formula"
  },
  "PerformIncreaseEvery": {
    "Label": "Perform increase every N steps"
  },
  "PerformIncreaseAmount": {
    "Label": "Perform increase amount"
  }
}
```

- [ ] **Step 4: Add Brazilian Portuguese localization**

In `lang/pt-BR.json`, add under `NarutoD20`:

```json
"Empower": {
  "Header": "Empower",
  "Title": "Empower {name}",
  "Prompt": "{name} pode gastar {cost} de chakra por passo para adicionar {formula} de dano.",
  "Steps": "Passos de Empower",
  "PerformIncrease": "+{value} Empower",
  "Enabled": {
    "Label": "Automatizar Empower de dano"
  },
  "Mode": {
    "Label": "Modo",
    "DamageBonus": "Bonus de dano"
  },
  "CostPerStep": {
    "Label": "Chakra por passo"
  },
  "FormulaPerStep": {
    "Label": "Dano por passo"
  },
  "DamageTypes": {
    "Label": "Tipos de dano",
    "Hint": "IDs de tipos de dano PF1e separados por virgula. Deixe vazio para dano extra sem tipo explicito."
  },
  "MaxStepsFormula": {
    "Label": "Formula de maximo de passos"
  },
  "PerformIncreaseEvery": {
    "Label": "Aumentar Perform a cada N passos"
  },
  "PerformIncreaseAmount": {
    "Label": "Aumento de Perform"
  }
}
```

- [ ] **Step 5: Run localization and JS lint**

Run: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8')); JSON.parse(require('fs').readFileSync('lang/pt-BR.json','utf8'))"`

Expected: exits 0.

Run: `npm run lint:js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/ui/technique-sheet.mjs templates/item/technique-sheet.hbs lang/en.json lang/pt-BR.json
git commit -m "feat(sheet): expose damage empower automation"
```

### Task 6: Validate Empower config and seed initial techniques

**Files:**
- Modify: `tools/validate-compendia.mjs`
- Modify: `tests/helpers.test.mjs`
- Modify: selected files under `packs/_source/techniques/`

- [ ] **Step 1: Add failing validation tests**

In `tests/helpers.test.mjs`, inside the compendium validation tests, add:

```js
it("reports invalid damage empower config", () => {
  const { root, sourceRoot } = makeSourceRoot({
    techniques: {
      "bad-empower.json": techniqueDoc({
        system: {
          automation: {
            empower: {
              enabled: true,
              mode: "unknown",
              costPerStep: 0,
              formulaPerStep: "",
              damageTypes: "fire",
              performIncreaseEvery: -1,
              performIncreaseAmount: -1,
            },
          },
        },
      }),
    },
  });

  const result = validateCompendia({ root, sourceRoot });
  const messages = result.issues.map((i) => i.message);

  assert.equal(result.failed, true);
  assert.ok(messages.some((m) => m.includes("unsupported automation.empower.mode")));
  assert.ok(messages.some((m) => m.includes("automation.empower.costPerStep")));
  assert.ok(messages.some((m) => m.includes("automation.empower.formulaPerStep")));
  assert.ok(messages.some((m) => m.includes("automation.empower.damageTypes")));
  assert.ok(messages.some((m) => m.includes("automation.empower.performIncreaseEvery")));
  assert.ok(messages.some((m) => m.includes("automation.empower.performIncreaseAmount")));
});
```

- [ ] **Step 2: Run the failing validation test**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "damage empower config"`

Expected: FAIL because the validator does not inspect `automation.empower` yet.

- [ ] **Step 3: Add validator constants and function**

In `tools/validate-compendia.mjs`, add near automation constants:

```js
const EMPOWER_MODES = new Set(["damageBonus"]);
```

Inside `validateTechnique`, after target mode validation, call:

```js
validateEmpower(packName, filename, system.automation?.empower, system.compEmpower === true);
```

Add:

```js
function validateEmpower(packName, filename, empower, hasComponent) {
  if (empower === undefined) {
    if (hasComponent) warn(packName, filename, "compEmpower is set but automation.empower is absent");
    return;
  }
  if (!isPlainObject(empower)) {
    error(packName, filename, "system.automation.empower must be an object");
    return;
  }
  if (hasComponent && empower.enabled !== true) {
    warn(packName, filename, "compEmpower is set but automation.empower.enabled is not true");
  }
  if (empower.enabled !== true) return;

  const mode = String(empower.mode ?? "").trim();
  if (!EMPOWER_MODES.has(mode)) {
    error(packName, filename, `unsupported automation.empower.mode "${mode}"`);
  }
  if (!Number.isInteger(empower.costPerStep) || empower.costPerStep < 1) {
    error(packName, filename, "automation.empower.costPerStep must be a positive integer");
  }
  if (!isNonEmptyString(empower.formulaPerStep)) {
    error(packName, filename, "automation.empower.formulaPerStep must be a non-empty string");
  }
  if (empower.damageTypes !== undefined && !Array.isArray(empower.damageTypes)) {
    error(packName, filename, "automation.empower.damageTypes must be an array");
  }
  if (
    empower.performIncreaseEvery !== undefined &&
    (!Number.isInteger(empower.performIncreaseEvery) || empower.performIncreaseEvery < 0)
  ) {
    error(packName, filename, "automation.empower.performIncreaseEvery must be a non-negative integer");
  }
  if (
    empower.performIncreaseAmount !== undefined &&
    (!Number.isInteger(empower.performIncreaseAmount) || empower.performIncreaseAmount < 0)
  ) {
    error(packName, filename, "automation.empower.performIncreaseAmount must be a non-negative integer");
  }
}
```

- [ ] **Step 4: Run validation tests**

Run: `node --test tests/helpers.test.mjs --test-name-pattern "damage empower config|compendium validation"`

Expected: PASS.

- [ ] **Step 5: Seed verified technique configs**

Edit these source JSON files:

- `packs/_source/techniques/RASENGAN__SPIRAL_BLAST__3L0NuE8cSAcGwpue.json`
- `packs/_source/techniques/GODAI_RANSATSU__SHODAN_JUTSU__ELEMENTAL_DESTRUCTION__RANK_ONE_TECHNIQUE__ICMRZVZMh2ZMqxfY.json`
- `packs/_source/techniques/KARYUU_ENDAN__FIRE_DRAGON_BLAST__YvpDwc0EuxOSONOf.json`

For Rasengan, set:

```json
"automation": {
  "enabled": true,
  "targetMode": "auto",
  "empower": {
    "enabled": true,
    "mode": "damageBonus",
    "costPerStep": 1,
    "formulaPerStep": "1d8",
    "damageTypes": ["untyped"],
    "maxStepsFormula": "min(@cl, 18) - 7",
    "performIncreaseEvery": 2,
    "performIncreaseAmount": 1
  }
}
```

For Godai Ransatsu Shodan, preserve existing automation fields and add:

```json
"empower": {
  "enabled": true,
  "mode": "damageBonus",
  "costPerStep": 1,
  "formulaPerStep": "1d6",
  "damageTypes": [],
  "maxStepsFormula": "min(@cl, 16) - 6",
  "performIncreaseEvery": 0,
  "performIncreaseAmount": 0
}
```

For Karyuu Endan, preserve existing automation fields and add:

```json
"empower": {
  "enabled": true,
  "mode": "damageBonus",
  "costPerStep": 1,
  "formulaPerStep": "1d6",
  "damageTypes": ["fire"],
  "maxStepsFormula": "min(@cl, 14) - 5",
  "performIncreaseEvery": 0,
  "performIncreaseAmount": 0
}
```

Do not seed Godai Taigeki Shodan in this task because the variant cap must be verified before encoding a hard limit.

- [ ] **Step 6: Run compendium validation**

Run: `npm run validate:compendia`

Expected: exits 0. Warnings for other `compEmpower` techniques without automation are acceptable unless the command reports failures.

- [ ] **Step 7: Pack the techniques compendium**

Run: `npm run pack`

Expected: exits 0 and updates `packs/techniques/`.

- [ ] **Step 8: Commit**

```bash
git add tools/validate-compendia.mjs tests/helpers.test.mjs packs/_source/techniques/RASENGAN__SPIRAL_BLAST__3L0NuE8cSAcGwpue.json packs/_source/techniques/GODAI_RANSATSU__SHODAN_JUTSU__ELEMENTAL_DESTRUCTION__RANK_ONE_TECHNIQUE__ICMRZVZMh2ZMqxfY.json packs/_source/techniques/KARYUU_ENDAN__FIRE_DRAGON_BLAST__YvpDwc0EuxOSONOf.json packs/techniques
git commit -m "feat(compendia): seed damage empower automation"
```

### Task 7: Final verification

**Files:**
- No source edits expected unless verification finds a defect.

- [ ] **Step 1: Run the automated test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run compendium validation**

Run: `npm run validate:compendia`

Expected: exits 0.

- [ ] **Step 3: Run JS lint**

Run: `npm run lint:js`

Expected: PASS.

- [ ] **Step 4: Run formatting check**

Run: `npm run lint:format`

Expected: PASS.

- [ ] **Step 5: Manual Foundry verification**

In Foundry VTT 13 with PF1e v11.11:

1. Reload the world.
2. Put `RASENGAN (SPIRAL BLAST)` on an actor with enough chakra and required learning state.
3. Use Rasengan with 0 Empower steps.
4. Confirm current behavior: normal damage, base chakra spend only.
5. Use Rasengan with 2 Empower steps.
6. Confirm the Perform DC includes `+1 Empower`, damage includes `2d8` extra, and chakra spend is base `11` plus extra `2`.
7. Use `KARYUU ENDAN (FIRE DRAGON BLAST)` with 3 Empower steps.
8. Confirm the extra damage is typed fire and total chakra spend is base `8` plus extra `3`.
9. Open the technique sheet Automation tab and confirm Empower fields are visible only when automation is enabled.
10. Cancel the Empower dialog and confirm no chakra is spent.

- [ ] **Step 6: Commit any verification fixes**

If fixes were needed, replace the file list below with the concrete files changed during verification:

```bash
git add scripts/use-technique.mjs scripts/automation/technique-empower.mjs
git commit -m "fix(empower): address verification findings"
```

If no fixes were needed, do not create an empty commit.
