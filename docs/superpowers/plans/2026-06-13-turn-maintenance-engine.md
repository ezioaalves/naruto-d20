# Turn-Maintenance Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two near-duplicate start-of-turn maintenance pipelines (rank + "stance") with one generic turn-maintenance engine, and remove "stance" as a named concept from the maintenance layer so non-stance techniques (Kai-Mon Kai) stop being treated/labelled as stances.

**Architecture:** One engine file (`turn-maintenance.mjs`) owns the duration-expiry listener, dedup queue, descriptor dispatch, and deferred-delete fallback. A technique declares maintenance via a unified `automation.maintenance` schema block built from three orthogonal facets — **cost** (chakra/hp, prompt/forced), **waiver** (step/freeUse), **choice** (mode). The ex-stance buff flag becomes a generic `maintenanceBuff` flag. Phase 1 routes the existing rank pipeline through the new engine while ranks keep their name-driven cost config; Phase 2 migrates rank config into the schema and collapses it into the generic flow.

**Tech Stack:** Foundry VTT v13 module, PF1e v11.11, ESM (no build step). Unit tests via `node --test tests/*.test.mjs`. Compendium pack/unpack via `@foundryvtt/foundryvtt-cli` (`npm run unpack` / `npm run pack`). Integration verified in the `kaihou` E2E world (GM Chicó, actor Dattoumaru Ikazuchi).

**Reference spec:** `docs/superpowers/specs/2026-06-13-turn-maintenance-engine-design.md`

---

## Conventions for this plan

- **Pure logic** (facet/flag resolution, classification, name builders, migration mapping) is TDD'd with `node:test` in `tests/helpers.test.mjs`, matching the repo's existing style (plain-object inputs, no Foundry mocks).
- **Foundry-integrated code** (the `updateItem` listener, `Dialog` prompts, `actor.update`, `createEmbeddedDocuments`) is **not** unit-tested — the repo has no Foundry harness. It is verified by `npm test` + `npm run lint` (no regressions) and the manual-QA / E2E steps at the end of each phase. Do not fabricate Foundry mocks.
- New replacement modules are added before old modules are removed. This keeps every commit loadable and allows `npm test && npm run lint` to pass at each commit boundary.
- **Design clarification:** the approved spec names `elementCount`, but the existing behavior is threshold-based: one element normally and two at a configurable mastery step. Preserve that behavior as `maintenance.element` + `maintenance.elementDoubleStep`; do not introduce a fixed stored count.
- **Unified rank flag clarification:** `maintenanceBuff` must preserve rank classification as well as maintenance identity. Its complete payload is `{ sourceTechniqueId?, grantType?, key?, modeId?, elements? }`, where `key` is `KOUSOKU` or `JOURYOKU`; the granted rank remains in `buff.system.level`. Without `key`, temporary/bonus rank calculation and the rank-grant sheet cannot work.
- **Migration clarification:** the spec calls rank buff flags ephemeral, but actor/world temp and bonus grants can persist indefinitely. Migration v2 therefore converts legacy `rankBuff` flags on actor-owned, synthetic-token, and world buffs; runtime code still has no compatibility reads after migration.
- Vocabulary map (apply consistently): `stance`→`maintenance`, `stanceBuff` flag → `maintenanceBuff`, `STANCE_MODES`→`MAINTENANCE_MODES`, `stanceModeById`→`maintenanceModeById`, `stanceBuffName`→`maintenanceModeBuffName`, `stanceBuffDuration`→`maintenanceBuffDuration`, `getStanceBuffFlag`→`getMaintenanceBuffFlag`, `findStanceBuffForTechnique`→`findMaintenanceBuffForTechnique`, `applyStanceModeBuff`→`applyModeBuff`, `applyUpkeepStanceBuff`→`applyUpkeepBuff`, `promptStanceMode`→`promptModeChoice`, `getActiveStanceElements`→`getActiveElements`, `promptStanceElements`→`promptElements`, `stanceElementCount`→`elementCount`, `setPendingCastElements`/`clearPendingCastElements` keep their names. `NarutoD20.StanceBuff.*`→`NarutoD20.Maintenance.*`, `NarutoD20.StanceElement.*`→`NarutoD20.MaintenanceElement.*`.

---

## File structure

**Create:**
- `scripts/automation/turn-maintenance.mjs` — the engine (listener + queue + generic `runMaintenance` + helpers + handler dispatch).
- `scripts/automation/maintenance-buffs.mjs` — unified `maintenanceBuff` flag, modes, elements, facet and flag resolvers. Added before `stance-buffs.mjs` is removed.
- `scripts/automation/maintenance-element-damage.mjs` — entry-time element pick + damage typing. Added before `stance-element-damage.mjs` is removed.
- `scripts/data/maintenance-migration.mjs` — pure legacy mapping helpers plus the GM-only, versioned owned-document migration.

**Modify:**
- `scripts/data/technique-model.mjs` — `automation.maintenance` schema block.
- `scripts/data/technique-defaults.mjs` — backfill the new `automation.maintenance` defaults.
- `scripts/automation/buff-application.mjs` — renamed apply fns, schema-driven dispatch, `maintenanceBuff` apply option.
- `scripts/automation/rank-buff-maintenance.mjs` — expose a handler entry the engine calls (Phase 1 keeps logic; Phase 2 folds in).
- `scripts/automation/rank-buffs.mjs` — Phase 2 rank metadata helpers read the unified flag while keeping name/config and free-use helpers.
- `scripts/automation/rank-effective-level.mjs`, `scripts/automation/rank-rolldata.mjs` — Phase 2 consume rank metadata from `maintenanceBuff`.
- `scripts/ui/rank-grant-config.mjs` — Phase 2 points the existing grant form at `maintenanceBuff`.
- `scripts/use-technique.mjs` — renamed helpers, `stanceFree`→`upkeepFree`.
- `scripts/ui/technique-sheet.mjs` — unified maintenance `getData` choices.
- `templates/item/technique-sheet.hbs` — unified maintenance controls.
- `scripts/main.mjs` — swap `registerExpiredBuffCleanup()` → `registerTurnMaintenance()`, register the hidden migration version setting, run migrations at `ready`.
- `lang/en.json`, `lang/pt-BR.json` — i18n namespace rename + the "Upkeep:" flavour fix.
- `tests/helpers.test.mjs` — update the synckit automation-field test; add new unit tests.
- `packs/_source/techniques/*` (Amatsu, Kai-Mon, Champuru; Phase 2: rank techniques) + repacked `packs/techniques/*`.
- `packs/_source/technique-buffs/{SPEED_RANK_GRANT,STRENGTH_RANK_GRANT}*` + repacked `packs/technique-buffs/*` in Phase 2.

**Delete (Phase 1):**
- `scripts/automation/buff-expiry.mjs` (listener absorbed into `turn-maintenance.mjs`).
- `scripts/automation/stance-buff-maintenance.mjs`.
- `scripts/automation/stance-buffs.mjs`.
- `scripts/automation/stance-element-damage.mjs`.

**Delete (Phase 2):**
- `scripts/automation/rank-buff-maintenance.mjs`; slim `rank-buffs.mjs` to rank name/config, free-use, and unified-flag rank metadata helpers.

---

# PHASE 1 — Generic engine + de-stance (HP/mode), ranks routed through engine with name-driven config

## Task 1: Unified `automation.maintenance` schema

**Files:**
- Modify: `scripts/data/technique-model.mjs:370-414`
- Modify: `scripts/data/technique-defaults.mjs:47-56`
- Test: `tests/helpers.test.mjs` (the `applyTechniqueSystemDefaults` + synckit tests)

- [x] **Step 1: Update the failing unit test for defaults**

In `tests/helpers.test.mjs`, import `legacyAutomationToMaintenance` beside `applyTechniqueSystemDefaults`, replace the synckit no-op test's `automation` objects, and add these assertions in the `"technique defaults"` describe block:

```js
// inside describe("technique defaults", …) — new assertions in the first it()
assert.deepEqual(system.automation.maintenance, {
  enabled: false,
  resource: "",
  cost: "1d4",
  policy: "prompt",
  interval: 1,
  waiver: "",
  waiverStep: 2,
  freeRounds: 5,
  choice: "",
  element: false,
  elementDoubleStep: 5,
});
```

```js
it("maps legacy stance automation to maintenance without changing behavior", () => {
  assert.deepEqual(
    legacyAutomationToMaintenance({
      stanceMode: false,
      stanceUpkeep: true,
      elementChoice: true,
      upkeepFormula: "1d4",
      upkeepMode: "prompt",
      upkeepWaiverStep: 2,
      elementDoubleStep: 5,
    }),
    {
      enabled: true,
      resource: "hp",
      cost: "1d4",
      policy: "prompt",
      interval: 1,
      waiver: "step",
      waiverStep: 2,
      freeRounds: 5,
      choice: "",
      element: true,
      elementDoubleStep: 5,
    },
  );
  assert.equal(legacyAutomationToMaintenance({ enabled: true, targetMode: "auto" }), null);
});
```

```js
// replace the embedded/source automation objects in the synckit no-op test
automation: {
  enabled: true,
  targetMode: "auto",
  maintenance: {
    enabled: false, resource: "", cost: "1d4", policy: "prompt", interval: 1,
    waiver: "", waiverStep: 2, freeRounds: 5, choice: "", element: false, elementDoubleStep: 5,
  },
},
// source side stays minimal (predates the block):
automation: { enabled: true, targetMode: "auto" },
```

- [x] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: FAIL — `system.automation.maintenance` is `undefined` and the synckit diff is not equal.

- [x] **Step 3: Replace the schema fields**

In `scripts/data/technique-model.mjs`, replace the six stance/upkeep fields (`stanceMode`, `stanceUpkeep`, `elementChoice`, `upkeepFormula`, `upkeepMode`, `upkeepWaiverStep`, `elementDoubleStep`) inside the `automation` SchemaField with one nested `maintenance` SchemaField (keep `enabled` and `targetMode` siblings):

```js
maintenance: new fields.SchemaField(
  {
    // Turn-start maintenance on/off. A maintained buff expires at turn start;
    // the engine then runs cost/waiver/choice before refreshing or ending it.
    enabled: new fields.BooleanField({ ...opt, initial: false }),
    // Cost resource paid each turn to keep the buff. "" = no cost (e.g. Champuru).
    resource: new fields.StringField({
      ...opt, blank: true, initial: "", choices: ["", "chakra", "hp"],
    }),
    // Cost amount: an HP roll formula ("1d4", "2") or a flat chakra amount ("1").
    cost: new fields.StringField({ ...opt, blank: true, initial: "1d4" }),
    // "prompt": dialog to pay or end. "forced": auto-pay with a guard (end if it
    // would drop HP below 1 / chakra cannot be paid). Never waived under "forced".
    policy: new fields.StringField({
      ...opt, blank: false, initial: "prompt", choices: ["prompt", "forced"],
    }),
    // Rounds the refresh duration lasts (ranks use 5/2/1; HP/mode use 1).
    interval: new fields.NumberField({ ...opt, integer: true, initial: 1, min: 1 }),
    // Mastery waiver: "step" waives the cost silently at mastery >= waiverStep;
    // "freeUse" offers a daily charge of `freeRounds` free rounds as a prompt button.
    waiver: new fields.StringField({
      ...opt, blank: true, initial: "", choices: ["", "step", "freeUse"],
    }),
    waiverStep: new fields.NumberField({ ...opt, integer: true, initial: 2, min: 0 }),
    freeRounds: new fields.NumberField({ ...opt, integer: true, initial: 5, min: 1 }),
    // Per-turn choice. "mode": keep/switch/break between named variant buffs (Dex/Str).
    choice: new fields.StringField({ ...opt, blank: true, initial: "", choices: ["", "mode"] }),
    // Entry-time element selection (chosen once on entry, reused while active).
    element: new fields.BooleanField({ ...opt, initial: false }),
    // Mastery step at/above which two elements are chosen (1d6 + 1d6).
    elementDoubleStep: new fields.NumberField({ ...opt, integer: true, initial: 5, min: 0 }),
  },
  opt,
),
```

- [x] **Step 4: Update the defaults backfill**

In `scripts/data/technique-defaults.mjs`, add the pure legacy mapper before `applyTechniqueSystemDefaults`:

```js
const LEGACY_MAINTENANCE_KEYS = [
  "stanceMode",
  "stanceUpkeep",
  "elementChoice",
  "upkeepFormula",
  "upkeepMode",
  "upkeepWaiverStep",
  "elementDoubleStep",
];

export function legacyAutomationToMaintenance(automation = {}) {
  if (!LEGACY_MAINTENANCE_KEYS.some((key) => Object.hasOwn(automation, key))) return null;

  const upkeep = automation.stanceUpkeep === true;
  const element = automation.elementChoice === true;
  const choice = automation.stanceMode === true ? "mode" : "";
  const policy = automation.upkeepMode === "forced" ? "forced" : "prompt";

  return {
    enabled: upkeep || element || Boolean(choice),
    resource: upkeep ? "hp" : "",
    cost: upkeep ? String(automation.upkeepFormula ?? "1d4") : "",
    policy,
    interval: 1,
    waiver: upkeep && policy === "prompt" ? "step" : "",
    waiverStep: Number(automation.upkeepWaiverStep ?? 2) || 0,
    freeRounds: 5,
    choice,
    element,
    elementDoubleStep: Number(automation.elementDoubleStep ?? 5) || 0,
  };
}
```

Then replace the legacy defaults with:

```js
system.automation.maintenance ??= {};
const m = system.automation.maintenance;
m.enabled ??= false;
m.resource ??= "";
m.cost ??= "1d4";
m.policy ??= "prompt";
m.interval ??= 1;
m.waiver ??= "";
m.waiverStep ??= 2;
m.freeRounds ??= 5;
m.choice ??= "";
m.element ??= false;
m.elementDoubleStep ??= 5;
```

- [x] **Step 5: Translate legacy source data before schema cleaning**

In `scripts/data/technique-model.mjs`, import `legacyAutomationToMaintenance` beside `applyTechniqueSystemDefaults`. At the start of `static migrateData(source)`, before the description migration, add:

```js
const automation = source.automation ?? {};
const maintenance = legacyAutomationToMaintenance(automation);
if (maintenance && !automation.maintenance) automation.maintenance = maintenance;
for (const key of [
  "stanceMode",
  "stanceUpkeep",
  "elementChoice",
  "upkeepFormula",
  "upkeepMode",
  "upkeepWaiverStep",
  "elementDoubleStep",
]) {
  delete automation[key];
}
source.automation = automation;
```

This preserves actor-owned legacy values when the new schema first loads; the persistent one-shot migration is added in Task 9.

- [x] **Step 6: Run tests to verify pass**

Run: `npm test && npm run lint`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add scripts/data/technique-model.mjs scripts/data/technique-defaults.mjs tests/helpers.test.mjs
git commit -m "refactor(technique): unify automation.maintenance schema block

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `maintenance-buffs.mjs` — unified flag + facet resolvers

**Files:**
- Create: `scripts/automation/maintenance-buffs.mjs`
- Test: `tests/helpers.test.mjs`

- [x] **Step 1: Write failing unit tests**

Add to `tests/helpers.test.mjs` (and add the import at top):

```js
import {
  maintenanceBuffFlagData,
  maintenanceFacets,
  maintenanceModeBuffName,
  maintenanceModeById,
} from "../scripts/automation/maintenance-buffs.mjs";

describe("maintenance facets", () => {
  const tech = (maintenance) => ({ name: "T", system: { automation: { maintenance } } });

  it("returns null when maintenance is disabled", () => {
    assert.equal(maintenanceFacets(tech({ enabled: false })), null);
  });

  it("reads a forced HP upkeep with no waiver/choice (Kai-Mon)", () => {
    const f = maintenanceFacets(tech({
      enabled: true, resource: "hp", cost: "2", policy: "forced", interval: 1,
      waiver: "", choice: "",
    }));
    assert.deepEqual(f, {
      resource: "hp", cost: "2", policy: "forced", interval: 1,
      waiver: "", waiverStep: 2, freeRounds: 5, choice: "",
    });
  });

  it("reads a prompt HP upkeep with step waiver (Amatsu)", () => {
    const f = maintenanceFacets(tech({
      enabled: true, resource: "hp", cost: "1d4", policy: "prompt", interval: 1,
      waiver: "step", waiverStep: 2, choice: "",
    }));
    assert.equal(f.waiver, "step");
    assert.equal(f.waiverStep, 2);
  });

  it("reads a no-cost mode choice (Champuru)", () => {
    const f = maintenanceFacets(tech({ enabled: true, resource: "", choice: "mode", interval: 1 }));
    assert.equal(f.resource, "");
    assert.equal(f.choice, "mode");
  });

  it("builds mode-variant buff names and resolves mode ids", () => {
    assert.equal(maintenanceModeBuffName({ name: "Champuru" }, "dex"), "Champuru (Dexterity)");
    assert.equal(maintenanceModeById("str").suffix, "Strength");
    assert.equal(maintenanceModeById("nope"), null);
  });

  it("builds a unified rank maintenance flag without storing the rank level", () => {
    assert.deepEqual(
      maintenanceBuffFlagData({
        sourceTechniqueId: "tech1",
        grantType: "paid",
        key: "KOUSOKU",
      }),
      { sourceTechniqueId: "tech1", grantType: "paid", key: "KOUSOKU" },
    );
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module/exports do not exist.

- [x] **Step 3: Add the replacement module**

Create `scripts/automation/maintenance-buffs.mjs` while leaving `stance-buffs.mjs` in place until Task 6. This keeps the runtime imports valid between commits. Start the file with:

```js
import { MODULE_ID } from "../constants.mjs";

export const MAINTENANCE_BUFF_FLAG = "maintenanceBuff";
export const MAINTENANCE_BUFF_FLAG_PATH =
  `flags.${MODULE_ID}.${MAINTENANCE_BUFF_FLAG}`;

export const MAINTENANCE_MODES = [
  { id: "dex", suffix: "Dexterity", labelKey: "NarutoD20.Maintenance.Dexterity" },
  { id: "str", suffix: "Strength", labelKey: "NarutoD20.Maintenance.Strength" },
];

export const ELEMENTS = [
  { id: "cold", labelKey: "NarutoD20.MaintenanceElement.Cold" },
  { id: "earth", labelKey: "NarutoD20.MaintenanceElement.Earth" },
  { id: "electric", labelKey: "NarutoD20.MaintenanceElement.Electric" },
  { id: "fire", labelKey: "NarutoD20.MaintenanceElement.Fire" },
  { id: "water", labelKey: "NarutoD20.MaintenanceElement.Water" },
  { id: "wind", labelKey: "NarutoD20.MaintenanceElement.Wind" },
];

export const ELEMENT_IDS = ELEMENTS.map((element) => element.id);

export function maintenanceBuffDuration(interval = 1) {
  return {
    units: "round",
    value: String(Math.max(1, Number(interval) || 1)),
    end: "turnStart",
    start: game.time.worldTime,
  };
}
```

Then add the helpers:

```js
export function maintenanceModeById(id) {
  return MAINTENANCE_MODES.find((mode) => mode.id === id) ?? null;
}

export function maintenanceModeBuffName(item, mode) {
  const resolved = typeof mode === "string" ? maintenanceModeById(mode) : mode;
  if (!resolved) return null;
  return `${item.name} (${resolved.suffix})`;
}

/**
 * Read a technique's maintenance facets, or null if maintenance is disabled.
 * Pure: takes a plain technique-shaped object. Cost/interval default applied here.
 */
export function maintenanceFacets(item) {
  const m = item?.system?.automation?.maintenance;
  if (!m?.enabled) return null;
  return {
    resource: m.resource ?? "",
    cost: m.cost ?? "",
    policy: m.policy ?? "prompt",
    interval: Math.max(1, Number(m.interval) || 1),
    waiver: m.waiver ?? "",
    waiverStep: Number(m.waiverStep ?? 2) || 0,
    freeRounds: Math.max(1, Number(m.freeRounds) || 1),
    choice: m.choice ?? "",
  };
}

/**
 * Unified maintenance-buff flag payload. Rank buffs carry `key` + `grantType`;
 * mode/element techniques carry modeId/elements.
 */
export function maintenanceBuffFlagData({
  sourceTechniqueId,
  grantType,
  key,
  modeId,
  elements,
} = {}) {
  const data = {};
  if (sourceTechniqueId) data.sourceTechniqueId = sourceTechniqueId;
  if (grantType) data.grantType = grantType;
  if (key) data.key = key;
  if (modeId) data.modeId = modeId;
  if (Array.isArray(elements)) data.elements = elements;
  return data;
}

export function getMaintenanceBuffFlag(item) {
  return item?.flags?.[MODULE_ID]?.[MAINTENANCE_BUFF_FLAG] ?? null;
}

export function findMaintenanceBuffForTechnique(actor, techniqueId) {
  if (!actor || !techniqueId) return null;
  return (
    actor.items.find(
      (item) => getMaintenanceBuffFlag(item)?.sourceTechniqueId === techniqueId,
    ) ?? null
  );
}
```

Do not copy the old `stanceBuffFlagData`/`stanceBuffKind`/`isStanceBuffItem`/
`isModeChoiceStance`/`isUpkeepStance`/`isElementStance` kind discriminator; schema
facets replace it.

- [x] **Step 4: Run tests to verify pass**

Run: `npm test && npm run lint`
Expected: PASS. Existing runtime modules still import `stance-buffs.mjs`, which has deliberately not been removed yet.

- [x] **Step 5: Commit**

```bash
git add scripts/automation/maintenance-buffs.mjs tests/helpers.test.mjs
git commit -m "refactor(automation): maintenance-buffs flag + facet resolver (was stance-buffs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `maintenance-element-damage.mjs` rename + schema reads

**Files:**
- Create: `scripts/automation/maintenance-element-damage.mjs`
- Test: `tests/helpers.test.mjs`

- [x] **Step 1: Write failing unit test for the element count**

```js
import { elementCount } from "../scripts/automation/maintenance-element-damage.mjs";

describe("maintenance element count", () => {
  const tech = (mastery, elementDoubleStep) => ({
    system: { mastery, automation: { maintenance: { element: true, elementDoubleStep } } },
  });
  it("is 1 below the double step and 2 at/above it", () => {
    assert.equal(elementCount(tech(1, 5)), 1);
    assert.equal(elementCount(tech(5, 5)), 2);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module/export not found.

- [x] **Step 3: Add the replacement module**

Copy the behavior of `stance-element-damage.mjs` into a new `maintenance-element-damage.mjs`; leave the old file until Task 6. Apply this exact export and reference map:

| Existing | Replacement |
|---|---|
| `getActiveStanceElements` | `getActiveElements` |
| `promptStanceElements` | `promptElements` |
| `stanceElementCount` | `elementCount` |
| `registerStanceElementDamage` | `registerElementDamage` |
| `STANCE_ELEMENTS` | `ELEMENTS` |
| `STANCE_ELEMENT_IDS` | `ELEMENT_IDS` |
| `findStanceBuffForTechnique` | `findMaintenanceBuffForTechnique` |
| `getStanceBuffFlag` | `getMaintenanceBuffFlag` |
| `NarutoD20.StanceElement.*` | `NarutoD20.MaintenanceElement.*` |
| `name="stance-element-${i}"` | `name="maintenance-element-${i}"` |

The damage hook gate becomes:

```js
const maintenance = item?.system?.automation?.maintenance;
if (!maintenance?.enabled || !maintenance.element) return;
```

Import all constants and flag helpers from `./maintenance-buffs.mjs`.

`elementCount` body:

```js
export function elementCount(item) {
  const m = item?.system?.automation?.maintenance ?? {};
  if (!m.element) return 0;
  const mastery = Number(item?.system?.mastery ?? 0) || 0;
  const step = Number(m.elementDoubleStep ?? 5) || 0;
  return step > 0 && mastery >= step ? 2 : 1;
}
```

- [x] **Step 4: Run tests + check imports**

Run: `npm test && npm run lint`
Expected: PASS. The old runtime module remains in place until all consumers switch in Task 6.

- [x] **Step 5: Commit**

```bash
git add scripts/automation/maintenance-element-damage.mjs tests/helpers.test.mjs
git commit -m "refactor(automation): maintenance-element-damage rename + schema reads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: The engine — `turn-maintenance.mjs`

**Files:**
- Create: `scripts/automation/turn-maintenance.mjs`
- Modify: `scripts/automation/rank-buff-maintenance.mjs`

> No unit test: this is entirely Foundry-wired (Hooks/Dialog/actor docs). Verified via `node --check`, `npm run lint`, and the Phase 1 manual-QA gate (Task 10).

- [ ] **Step 1: Add the engine file**

Create `scripts/automation/turn-maintenance.mjs`. It absorbs `buff-expiry.mjs`'s listener and the maintenance flow that lived in `stance-buff-maintenance.mjs`, generalised over `maintenanceFacets`:

```js
import { MODULE_ID } from "../constants.mjs";
import { rollHpCost, commitHpCost, applyHpCost } from "../data/hp-cost.mjs";
import {
  getMaintenanceBuffFlag,
  maintenanceBuffDuration,
  maintenanceFacets,
} from "./maintenance-buffs.mjs";
import { applyModeBuff, applyUpkeepBuff, promptModeChoice } from "./buff-application.mjs";
import {
  isRankMaintenanceBuff,
  maintainRankBuff,
} from "./rank-buff-maintenance.mjs";

const pending = new Set();

export function registerTurnMaintenance() {
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if (userId !== game.user.id) return;
    if (options?.pf1?.reason !== "duration") return;
    if (changed?.system?.active !== false) return;
    if (item.type !== "buff") return;
    if (!item.flags?.[MODULE_ID]?.sourceId) return;

    const actor = item.actor;
    if (!actor?.isOwner) return;

    // Phase 1: rank cost resolution remains name-driven, but this engine owns
    // the only listener and dedup queue.
    if (isRankMaintenanceBuff(item)) {
      queueDeferred(item, () => maintainRankBuff(actor, item.id));
      return;
    }
    if (queueMaintenance(item)) return;

    // No maintenance descriptor → delete the spent buff (deferred past the
    // expiry transaction, then re-checked).
    const itemId = item.id;
    window.setTimeout(async () => {
      const current = actor.items.get(itemId);
      if (!current) return;
      try {
        await actor.deleteEmbeddedDocuments("Item", [itemId]);
      } catch (err) {
        if (actor.items.has(itemId)) {
          console.error(`naruto-d20 | failed to delete expired buff "${current.name}":`, err);
        }
      }
    }, 0);
  });
}

function queueMaintenance(item) {
  const flag = getMaintenanceBuffFlag(item);
  if (!flag?.sourceTechniqueId) return false;
  const actor = item.actor;
  const technique = actor.items.get(flag.sourceTechniqueId);
  if (!technique || !maintenanceFacets(technique)) {
    // Source gone or no longer maintained → fall through to generic delete.
    return false;
  }
  return queueDeferred(item, () => runMaintenance(actor, item.id));
}

function queueDeferred(item, run) {
  const actor = item.actor;
  const key = `${actor.uuid}:${item.id}`;
  if (pending.has(key)) return true;
  pending.add(key);
  window.setTimeout(async () => {
    try {
      await run();
    } finally {
      pending.delete(key);
    }
  }, 0);
  return true;
}

async function runMaintenance(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || item.system?.active) return;

  const flag = getMaintenanceBuffFlag(item);
  const technique = flag?.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  if (!technique) return deleteMaintenanceBuff(actor, itemId);

  const facets = maintenanceFacets(technique);
  if (!facets) return deleteMaintenanceBuff(actor, itemId);

  // Cost facet. HP only in Phase 1 (chakra-cost ranks go through the rank handler).
  if (facets.resource === "hp") {
    return maintainHpUpkeep(actor, itemId, technique, facets, flag);
  }

  // No-cost choice (Champuru), or a maintained buff with no cost/choice.
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

async function maintainHpUpkeep(actor, itemId, technique, facets, flag) {
  const formula = facets.cost || "0";

  if (facets.policy === "forced") {
    const { roll, amount } = await rollHpCost(actor, formula);
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    if (hp - amount < 1) {
      await deleteMaintenanceBuff(actor, itemId);
      ui.notifications.info(
        game.i18n.format("NarutoD20.Maintenance.UpkeepEnded", { name: technique.name }),
      );
      return;
    }
    await commitHpCost(actor, roll, amount);
    await completeMaintenance(actor, itemId, technique, facets, flag);
    return;
  }

  // policy "prompt" with optional step waiver.
  if (facets.waiver === "step") {
    const mastery = Number(technique.system?.mastery ?? 0) || 0;
    if (mastery >= facets.waiverStep) {
      await completeMaintenance(actor, itemId, technique, facets, flag);
      return;
    }
  }

  const choice = await promptHpUpkeep(technique, formula);
  if (choice !== "pay") return deleteMaintenanceBuff(actor, itemId);
  await applyHpCost(actor, formula);
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

async function completeMaintenance(
  actor,
  itemId,
  technique,
  facets,
  flag,
  interval = facets.interval,
) {
  if (facets.choice === "mode") {
    const choice = await promptModeChoice(technique, {
      current: flag.modeId,
      allowBreak: true,
    });
    if (!choice || choice === "break") {
      await deleteMaintenanceBuff(actor, itemId);
      return;
    }
    await applyModeBuff(technique, actor, choice, interval);
    return;
  }

  if (facets.resource === "hp" || technique.system?.automation?.maintenance?.element) {
    await applyUpkeepBuff(technique, actor, interval);
    return;
  }

  await refreshMaintenanceBuff(actor, itemId, interval);
}

function promptHpUpkeep(technique, formula) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    new Dialog({
      title: game.i18n.format("NarutoD20.Maintenance.UpkeepTitle", { name: technique.name }),
      content: `<p>${game.i18n.format("NarutoD20.Maintenance.UpkeepMessage", {
        name: technique.name, formula,
      })}</p>`,
      buttons: {
        pay: {
          icon: '<i class="fas fa-heart-broken"></i>',
          label: game.i18n.format("NarutoD20.Maintenance.PayHp", { formula }),
          callback: () => finish("pay"),
        },
        break: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.Maintenance.Break"),
          callback: () => finish("break"),
        },
      },
      default: "pay",
      close: () => finish("break"),
    }).render(true);
  });
}

export async function refreshMaintenanceBuff(actor, itemId, interval) {
  const current = actor.items.get(itemId);
  if (!current) return;
  const d = maintenanceBuffDuration(interval);
  await current.update({
    "system.active": true,
    "system.duration.units": d.units,
    "system.duration.value": d.value,
    "system.duration.end": d.end,
    "system.duration.start": d.start,
  });
}

async function deleteMaintenanceBuff(actor, itemId) {
  if (!actor.items.has(itemId)) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
  } catch (err) {
    if (actor.items.has(itemId)) {
      console.error(`naruto-d20 | failed to delete maintenance buff "${itemId}":`, err);
    }
  }
}
```

- [ ] **Step 2: Turn the rank module into a temporary handler**

In `scripts/automation/rank-buff-maintenance.mjs`, add this classifier:

```js
export function isRankMaintenanceBuff(item) {
  return Boolean(item?.actor?.isOwner) && getRankGrantType(item) === "paid";
}
```

Change the existing private declaration:

```js
async function maintainRankBuff(actor, itemId) {
```

to:

```js
export async function maintainRankBuff(actor, itemId) {
```

Keep `pendingMaintenance` and `queueRankBuffMaintenance` temporarily because the
old `buff-expiry.mjs` still imports them until Task 6. Keep the existing
name-driven cost lookup, prompt, chakra payment, free-use, refresh, and deletion
logic unchanged.

- [ ] **Step 3: Static checks**

Run: `node --check scripts/automation/turn-maintenance.mjs`
Expected: no output.
Run: `npm test && npm run lint`
Expected: PASS. The engine is not wired yet; Task 5 supplies its renamed imports and Task 6 switches `main.mjs`.

- [ ] **Step 4: Commit**

```bash
git add scripts/automation/turn-maintenance.mjs scripts/automation/rank-buff-maintenance.mjs
git commit -m "refactor(automation): add generic turn-maintenance engine

Centralize deferred maintenance scheduling while rank costs remain name-driven
until Phase 2 migrates their technique schema.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `buff-application.mjs` — renamed apply fns + schema dispatch + unified apply flag

**Files:**
- Modify: `scripts/automation/buff-application.mjs`

- [ ] **Step 1: Update imports**

Replace the `stance-buffs.mjs` import block (lines 9-20) with `maintenance-buffs.mjs`:

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
} from "./maintenance-buffs.mjs";
```

Keep the `rank-buffs.mjs` import (Phase 1 still uses `resolveRankTechnique` / `rankBuffDuration` / `rankBuffFlagData` for the rank apply path).

- [ ] **Step 2: Schema-driven dispatch in `applyTechniqueBuff`**

Replace the `isModeChoiceStance`/`isUpkeepStance` branch (lines 37-47) with facet-driven dispatch:

```js
const facets = maintenanceFacets(item);
if (facets) {
  if (facets.choice === "mode") {
    await applyModeBuff(item, actor, null, facets.interval);
    return;
  }
  if (facets.resource === "hp" || item.system.automation.maintenance.element) {
    await applyUpkeepBuff(item, actor, facets.interval);
    return;
  }
}
```

- [ ] **Step 3: Rename apply fns + flag option**

- `applyStanceModeBuff(item, actor, modeId = null)` → `applyModeBuff(item, actor, modeId = null, interval = 1)`; inside, `promptStanceMode`→`promptModeChoice`, `removeStanceBuff`→`removeMaintenanceBuff`, `stanceModeById`→`maintenanceModeById`, `stanceBuffName`→`maintenanceModeBuffName`, `findStanceBuffForTechnique`→`findMaintenanceBuffForTechnique`, `stanceBuffDuration()`→`maintenanceBuffDuration(interval)`, and the apply option `stanceBuff: stanceBuffFlagData({...modeId})` → `maintenanceBuff: maintenanceBuffFlagData({ sourceTechniqueId: item.id, modeId: mode.id })`. Update the warn string to `"No mode buff found named …"`.
- `applyUpkeepStanceBuff(item, actor)` → `applyUpkeepBuff(item, actor, interval = 1)`; `getActiveStanceElements`→`getActiveElements` (import from `maintenance-element-damage.mjs`), `stanceBuffDuration()`→`maintenanceBuffDuration(interval)`, apply option → `maintenanceBuff: maintenanceBuffFlagData({ sourceTechniqueId: item.id, elements })`.
- `promptStanceMode` → `promptModeChoice`; `STANCE_MODES`→`MAINTENANCE_MODES`, `stanceModeById`→`maintenanceModeById`, i18n `NarutoD20.StanceBuff.*`→`NarutoD20.Maintenance.*`.
- `removeStanceBuff` → `removeMaintenanceBuff` (body unchanged).

- [ ] **Step 4: Keep temporary exports for the old maintenance module**

At the end of the renamed function section, add:

```js
// Removed with stance-buff-maintenance.mjs in Task 6.
export const applyStanceModeBuff = applyModeBuff;
export const applyUpkeepStanceBuff = applyUpkeepBuff;
export const promptStanceMode = promptModeChoice;
```

These aliases keep the still-wired old listener loadable for one commit. They are
not compatibility reads for stored data.

- [ ] **Step 5: Unified apply option in the low-level apply path**

In `normalizeBuffApplyOptions`, `refreshExistingBuff`, `createBuffOnTarget`, and `applyBuffToTarget`: replace the `stanceBuff` option with `maintenanceBuff`, writing to `MAINTENANCE_BUFF_FLAG_PATH` (refresh) / `itemData.flags[SOURCE_FLAG][MAINTENANCE_BUFF_FLAG]` (create). **Keep** the `rankBuff` option/path untouched (Phase 1). Example for `refreshExistingBuff`:

```js
if (maintenanceBuff) updates[MAINTENANCE_BUFF_FLAG_PATH] = maintenanceBuff;
```

Leave the `isSelfTargetingTechnique` stance-subtype check at line 271 **unchanged** (out of scope).

- [ ] **Step 6: Static + lint**

Run: `node --check scripts/automation/buff-application.mjs && npm run lint`
Expected: PASS (with Task 4's engine in place).
Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/automation/buff-application.mjs
git commit -m "refactor(automation): de-stance buff application

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `use-technique.mjs` — renamed helpers + upkeepFree

**Files:**
- Modify: `scripts/use-technique.mjs:19-29,47-51,71-81,108,127,141,343-344`
- Modify: `scripts/main.mjs:40-41,206-207`
- Modify: `scripts/automation/rank-buff-maintenance.mjs`
- Modify: `scripts/automation/buff-application.mjs`
- Delete: `scripts/automation/buff-expiry.mjs`
- Delete: `scripts/automation/stance-buff-maintenance.mjs`
- Delete: `scripts/automation/stance-buffs.mjs`
- Delete: `scripts/automation/stance-element-damage.mjs`

- [ ] **Step 1: Update imports + helper calls**

- Imports: from `maintenance-buffs.mjs` use `findMaintenanceBuffForTechnique`, `maintenanceFacets`; from `maintenance-element-damage.mjs` use `getActiveElements`, `promptElements`, `setPendingCastElements`, `clearPendingCastElements`, `elementCount`.
- `isUpkeepStance(currentItem)` → `maintenanceFacets(currentItem)?.resource === "hp"`.
- `isElementStance(currentItem)` → `currentItem.system.automation.maintenance?.element === true`.
- `findStanceBuffForTechnique` → `findMaintenanceBuffForTechnique`.
- Rename local `stanceFree` → `upkeepFree` throughout (lines 49-51, 108, 127, 141, 343-344).
- `getActiveStanceElements`→`getActiveElements`, `promptStanceElements`→`promptElements`, `stanceElementCount`→`elementCount`.
- Card footer key: `NarutoD20.Cards.Perform.StanceFree` → `NarutoD20.Cards.Perform.UpkeepFree`.

- [ ] **Step 2: Wire the replacement modules**

In `scripts/main.mjs`, replace:

```js
import { registerExpiredBuffCleanup } from "./automation/buff-expiry.mjs";
import { registerStanceElementDamage } from "./automation/stance-element-damage.mjs";
```

with:

```js
import { registerTurnMaintenance } from "./automation/turn-maintenance.mjs";
import { registerElementDamage } from "./automation/maintenance-element-damage.mjs";
```

Replace the setup calls with:

```js
registerTurnMaintenance(); // start-of-turn maintenance + spent-buff cleanup
registerElementDamage(); // type configured maintenance-element attack damage at roll time
```

- [ ] **Step 3: Remove the superseded modules**

Now that `main.mjs` uses `turn-maintenance.mjs`, delete
`pendingMaintenance` and `queueRankBuffMaintenance` from
`rank-buff-maintenance.mjs`. Keep only the exported
`isRankMaintenanceBuff` classifier, exported `maintainRankBuff` handler, and its
private prompt/payment/refresh/delete helpers.

Also delete the three temporary aliases from `buff-application.mjs`:

```js
export const applyStanceModeBuff = applyModeBuff;
export const applyUpkeepStanceBuff = applyUpkeepBuff;
export const promptStanceMode = promptModeChoice;
```

```bash
git rm scripts/automation/buff-expiry.mjs \
  scripts/automation/stance-buff-maintenance.mjs \
  scripts/automation/stance-buffs.mjs \
  scripts/automation/stance-element-damage.mjs
```

- [ ] **Step 4: Static + tests**

Run: `node --check scripts/use-technique.mjs && node --check scripts/main.mjs && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Verify no runtime imports point at removed modules**

Run:

```bash
rg -n "buff-expiry|stance-buff-maintenance|stance-buffs|stance-element-damage|registerExpiredBuffCleanup|registerStanceElementDamage|queueRankBuffMaintenance" scripts
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add scripts
git commit -m "refactor(automation): switch runtime to turn maintenance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Technique sheet — unified maintenance controls

**Files:**
- Modify: `templates/item/technique-sheet.hbs:577-636`
- Modify: `scripts/ui/technique-sheet.mjs` (`getData` choices ~ the `upkeepModeChoices` block)

- [ ] **Step 1: Replace the sheet controls**

In `technique-sheet.hbs`, replace the stance/upkeep block (`system.automation.stanceMode` … `system.automation.elementDoubleStep`) with maintenance controls bound to `system.automation.maintenance.*`:

```hbs
<label class="checkbox">
  <input type="checkbox" name="system.automation.maintenance.enabled" {{checked system.automation.maintenance.enabled}}>
  {{localize "NarutoD20.Automation.Maintenance.Enabled.Label"}}
</label>

{{#if maintenanceFields.show}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Resource.Label"}}</label>
  <select name="system.automation.maintenance.resource">
    {{selectOptions maintenanceResourceChoices selected=system.automation.maintenance.resource}}
  </select>
</div>
{{#if maintenanceFields.hasCost}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Cost.Label"}}</label>
  <input type="text" name="system.automation.maintenance.cost" value="{{system.automation.maintenance.cost}}">
</div>
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Policy.Label"}}</label>
  <select name="system.automation.maintenance.policy">
    {{selectOptions maintenancePolicyChoices selected=system.automation.maintenance.policy}}
  </select>
</div>
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Interval.Label"}}</label>
  <input type="number" step="1" min="1" name="system.automation.maintenance.interval" value="{{system.automation.maintenance.interval}}">
</div>
{{/if}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Waiver.Label"}}</label>
  <select name="system.automation.maintenance.waiver">
    {{selectOptions maintenanceWaiverChoices selected=system.automation.maintenance.waiver}}
  </select>
</div>
{{#if maintenanceFields.showWaiverStep}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.WaiverStep.Label"}}</label>
  <input type="number" step="1" min="0" name="system.automation.maintenance.waiverStep" value="{{system.automation.maintenance.waiverStep}}">
</div>
{{/if}}
{{#if maintenanceFields.showFreeRounds}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.FreeRounds.Label"}}</label>
  <input type="number" step="1" min="1" name="system.automation.maintenance.freeRounds" value="{{system.automation.maintenance.freeRounds}}">
</div>
{{/if}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Choice.Label"}}</label>
  <select name="system.automation.maintenance.choice">
    {{selectOptions maintenanceChoiceChoices selected=system.automation.maintenance.choice}}
  </select>
</div>
<label class="checkbox">
  <input type="checkbox" name="system.automation.maintenance.element" {{checked system.automation.maintenance.element}}>
  {{localize "NarutoD20.Automation.Maintenance.Element.Label"}}
</label>
{{#if maintenanceFields.showElementDoubleStep}}
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.ElementDoubleStep.Label"}}</label>
  <input type="number" step="1" min="0" name="system.automation.maintenance.elementDoubleStep" value="{{system.automation.maintenance.elementDoubleStep}}">
</div>
{{/if}}
{{/if}}
```

Leave the `targetMode` select (line 633-634) unchanged.

- [ ] **Step 2: Provide the choice maps in `getData`**

In `scripts/ui/technique-sheet.mjs`, replace the `context.upkeepModeChoices = {…}` block with:

```js
context.maintenanceResourceChoices = {
  "": loc("NarutoD20.Automation.Maintenance.Resource.None"),
  chakra: loc("NarutoD20.Automation.Maintenance.Resource.Chakra"),
  hp: loc("NarutoD20.Automation.Maintenance.Resource.Hp"),
};
context.maintenancePolicyChoices = {
  prompt: loc("NarutoD20.Automation.Maintenance.Policy.Prompt"),
  forced: loc("NarutoD20.Automation.Maintenance.Policy.Forced"),
};
context.maintenanceWaiverChoices = {
  "": loc("NarutoD20.Automation.Maintenance.Waiver.None"),
  step: loc("NarutoD20.Automation.Maintenance.Waiver.Step"),
  freeUse: loc("NarutoD20.Automation.Maintenance.Waiver.FreeUse"),
};
context.maintenanceChoiceChoices = {
  "": loc("NarutoD20.Automation.Maintenance.Choice.None"),
  mode: loc("NarutoD20.Automation.Maintenance.Choice.Mode"),
};
const maintenance = system.automation?.maintenance ?? {};
context.maintenanceFields = {
  show: maintenance.enabled === true,
  hasCost: Boolean(maintenance.resource),
  showWaiverStep: maintenance.waiver === "step",
  showFreeRounds: maintenance.waiver === "freeUse",
  showElementDoubleStep: maintenance.element === true,
};
```

- [ ] **Step 3: Static + lint**

Run: `node --check scripts/ui/technique-sheet.mjs && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add templates/item/technique-sheet.hbs scripts/ui/technique-sheet.mjs
git commit -m "refactor(sheet): unified maintenance controls on the Automation tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: i18n — rename namespace + fix the flavour text

**Files:**
- Modify: `lang/en.json`, `lang/pt-BR.json`

- [ ] **Step 1: Rename the Automation labels**

In both files, under `NarutoD20.Automation`, remove `StanceMode`, `StanceUpkeep`, `ElementChoice`, `UpkeepFormula`, `UpkeepMode`, `UpkeepWaiverStep`, `ElementDoubleStep` and add a `Maintenance` object with the keys used in Task 7 (`Enabled.Label`, `Resource.{Label,None,Chakra,Hp}`, `Cost.Label`, `Policy.{Label,Prompt,Forced}`, `Interval.Label`, `Waiver.{Label,None,Step,FreeUse}`, `WaiverStep.Label`, `FreeRounds.Label`, `Choice.{Label,None,Mode}`, `Element.Label`, `ElementDoubleStep.Label`). EN values, e.g.:

```json
"Maintenance": {
  "Enabled": { "Label": "Enable start-of-turn maintenance" },
  "Resource": { "Label": "Upkeep cost resource", "None": "None", "Chakra": "Chakra", "Hp": "Hit Points" },
  "Cost": { "Label": "Upkeep cost (formula or amount)" },
  "Policy": { "Label": "Upkeep policy", "Prompt": "Prompt (pay or end)", "Forced": "Forced (auto, ends if lethal)" },
  "Interval": { "Label": "Refresh interval (rounds)" },
  "Waiver": { "Label": "Mastery waiver", "None": "None", "Step": "Step (waives the cost)", "FreeUse": "Free use (daily charge)" },
  "WaiverStep": { "Label": "Mastery step for the waiver" },
  "FreeRounds": { "Label": "Free rounds granted by a free-use waiver" },
  "Choice": { "Label": "Per-turn choice", "None": "None", "Mode": "Mode swap (Dex/Str)" },
  "Element": { "Label": "Choose damage element(s) on entry" },
  "ElementDoubleStep": { "Label": "Mastery step that allows two elements" }
}
```

PT-BR values:

```json
"Maintenance": {
  "Enabled": { "Label": "Ativar manutenção no início do turno" },
  "Resource": { "Label": "Recurso do custo de manutenção", "None": "Nenhum", "Chakra": "Chakra", "Hp": "Pontos de Vida" },
  "Cost": { "Label": "Custo de manutenção (fórmula ou valor)" },
  "Policy": { "Label": "Política de manutenção", "Prompt": "Perguntar (pagar ou encerrar)", "Forced": "Forçada (automática; encerra se for letal)" },
  "Interval": { "Label": "Intervalo de renovação (rodadas)" },
  "Waiver": { "Label": "Isenção por maestria", "None": "Nenhuma", "Step": "Degrau (remove o custo)", "FreeUse": "Uso grátis (carga diária)" },
  "WaiverStep": { "Label": "Degrau de maestria da isenção" },
  "FreeRounds": { "Label": "Rodadas grátis concedidas" },
  "Choice": { "Label": "Escolha por turno", "None": "Nenhuma", "Mode": "Troca de modo (Des/For)" },
  "Element": { "Label": "Escolher elemento(s) de dano na entrada" },
  "ElementDoubleStep": { "Label": "Degrau de maestria que permite dois elementos" }
}
```

- [ ] **Step 2: Rename the `StanceBuff`/`StanceElement` blocks**

Rename `NarutoD20.StanceBuff` → `NarutoD20.Maintenance` and `NarutoD20.StanceElement` → `NarutoD20.MaintenanceElement` in both files. Keep all sub-keys (`Title`, `Message`, `MessageInitial`, `Dexterity`, `Strength`, `DexHint`, `StrHint`, `Break`, `UpkeepTitle`, `UpkeepMessage`, `PayHp`, `UpkeepEnded`, `HpCostFlavor`; element `Title`/`Prompt`/…). **Change `HpCostFlavor`** EN value `"Stance upkeep: {amount} HP lost."` → `"Upkeep: {amount} HP lost."` and PT-BR to `"Manutenção: {amount} PV perdidos."`. Update the Champuru-specific wording in `Message`/`MessageInitial` to drop "stance" (e.g. EN `"{name} continues at the start of your turn. Keep your mode, switch, or end it:"`).

- [ ] **Step 3: Rename the perform-card key**

Rename `NarutoD20.Cards.Perform.StanceFree` → `NarutoD20.Cards.Perform.UpkeepFree` in both files. Use EN `"Upkeep active — no chakra spent."` and PT-BR `"Manutenção ativa — nenhum chakra gasto."`.

- [ ] **Step 4: Validate JSON + lint**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('lang/en.json')); JSON.parse(require('node:fs').readFileSync('lang/pt-BR.json')); console.log('ok')"`
Expected: `ok`.
Run: `npm run lint:format`
Expected: PASS (prettier-clean).
Run: `rg -n "StanceBuff|StanceElement|StanceMode|StanceUpkeep|stanceMode|stanceUpkeep|StanceFree|UpkeepFormula|UpkeepMode\\b" scripts lang templates`
Expected: no matches (all references migrated).

- [ ] **Step 5: Commit**

```bash
git add lang/en.json lang/pt-BR.json
git commit -m "i18n: rename stance maintenance strings to Maintenance; fix upkeep flavour

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Repack ex-stance techniques + owned-item migration

**Files:**
- Modify: `packs/_source/techniques/AMATSU_NO_KARADA__HEAVENLY_BODY__Eg83TQOvnreI9eeo.json`
- Modify: `packs/_source/techniques/KAI_MON_KAI__INITIAL_GATE_RELEASE__LK2D9Wq8YIgih9Ms.json`
- Modify: `packs/_source/techniques/CHAMPURU_DAICHI_SUTANSU__AYAUI_APPUKU__CHAMPURU_FIRST_STANCE__ERRATICALLY_OVERPOWER__hckDyKlm8TtdCYgG.json`
- Repack: `packs/techniques/*`
- Create: `scripts/data/maintenance-migration.mjs`
- Modify: `scripts/main.mjs`

- [ ] **Step 1: Write the failing migration-version test**

Add this import and test to `tests/helpers.test.mjs`:

```js
import { maintenanceMigrationPatch } from "../scripts/data/maintenance-migration.mjs";

describe("maintenance migration", () => {
  it("persists prepared maintenance and deletes every legacy automation key", () => {
    assert.deepEqual(
      maintenanceMigrationPatch({
        enabled: true,
        resource: "hp",
        cost: "2",
        policy: "forced",
        interval: 1,
        waiver: "",
        waiverStep: 2,
        freeRounds: 5,
        choice: "",
        element: false,
        elementDoubleStep: 5,
      }),
      {
        "system.automation.maintenance": {
          enabled: true,
          resource: "hp",
          cost: "2",
          policy: "forced",
          interval: 1,
          waiver: "",
          waiverStep: 2,
          freeRounds: 5,
          choice: "",
          element: false,
          elementDoubleStep: 5,
        },
        "system.automation.-=stanceMode": null,
        "system.automation.-=stanceUpkeep": null,
        "system.automation.-=elementChoice": null,
        "system.automation.-=upkeepFormula": null,
        "system.automation.-=upkeepMode": null,
        "system.automation.-=upkeepWaiverStep": null,
        "system.automation.-=elementDoubleStep": null,
      },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test`
Expected: FAIL because `scripts/data/maintenance-migration.mjs` does not exist.

- [ ] **Step 3: Add the versioned migration module**

Create `scripts/data/maintenance-migration.mjs`:

```js
import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";

export const MAINTENANCE_MIGRATION_SETTING = "maintenanceMigrationVersion";
export const MAINTENANCE_MIGRATION_VERSION = 1;

const LEGACY_AUTOMATION_KEYS = [
  "stanceMode",
  "stanceUpkeep",
  "elementChoice",
  "upkeepFormula",
  "upkeepMode",
  "upkeepWaiverStep",
  "elementDoubleStep",
];

export function maintenanceMigrationPatch(maintenance) {
  const patch = {
    "system.automation.maintenance": structuredClone(maintenance),
  };
  for (const key of LEGACY_AUTOMATION_KEYS) {
    patch[`system.automation.-=${key}`] = null;
  }
  return patch;
}

function collectMigrationActors() {
  const actors = new Map(game.actors.map((actor) => [actor.uuid, actor]));
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
    }
  }
  return actors;
}

async function migrateVersion1(actors) {
  for (const actor of actors.values()) {
    const updates = [];
    for (const item of actor.items) {
      if (item.type !== TECHNIQUE_ITEM_TYPE) continue;
      const maintenance = item.system?.automation?.maintenance;
      if (!maintenance) continue;
      updates.push({ _id: item.id, ...maintenanceMigrationPatch(maintenance) });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
}

export async function runMaintenanceMigrations() {
  if (!game.user.isGM) return;
  const current = Number(game.settings.get(MODULE_ID, MAINTENANCE_MIGRATION_SETTING)) || 0;
  if (current >= MAINTENANCE_MIGRATION_VERSION) return;

  const actors = collectMigrationActors();
  if (current < 1) {
    await migrateVersion1(actors);
    await game.settings.set(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, 1);
  }
}
```

- [ ] **Step 4: Register and run migration version 1**

In `scripts/main.mjs`, import:

```js
import {
  MAINTENANCE_MIGRATION_SETTING,
  runMaintenanceMigrations,
} from "./data/maintenance-migration.mjs";
```

Inside the `init` hook, register the hidden world setting:

```js
game.settings.register(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, {
  scope: "world",
  config: false,
  type: Number,
  default: 0,
});
```

After the `preCreateActor` hook and before `pf1ActorRest`, add:

```js
Hooks.once("ready", async () => {
  await runMaintenanceMigrations();
});
```

Update `main.mjs`'s lifecycle header and numbered section comments so `ready` is
step `[9]` and `pf1ActorRest` becomes step `[10]`; the comments are authoritative
for hook order per `CLAUDE.md`.

- [ ] **Step 5: Rewrite each technique's `system.automation`**

For each, replace the legacy stance fields under `system.automation` with the new `maintenance` block (delete `stanceMode`/`stanceUpkeep`/`elementChoice`/`upkeepFormula`/`upkeepMode`/`upkeepWaiverStep`/`elementDoubleStep`; keep `enabled`/`targetMode`):

```jsonc
// Amatsu no Karada
"maintenance": { "enabled": true, "resource": "hp", "cost": "1d4", "policy": "prompt",
  "interval": 1, "waiver": "step", "waiverStep": 2, "freeRounds": 5, "choice": "",
  "element": true, "elementDoubleStep": 5 }
// Kai-Mon Kai (Initial Gate Release)
"maintenance": { "enabled": true, "resource": "hp", "cost": "2", "policy": "forced",
  "interval": 1, "waiver": "", "waiverStep": 2, "freeRounds": 5, "choice": "",
  "element": false, "elementDoubleStep": 5 }
// Champuru
"maintenance": { "enabled": true, "resource": "", "cost": "", "policy": "prompt",
  "interval": 1, "waiver": "", "waiverStep": 2, "freeRounds": 5, "choice": "mode",
  "element": false, "elementDoubleStep": 5 }
```

Set `automation.targetMode` to `"self"` for Amatsu/Kai-Mon (self-buffs); leave Champuru as it was.

- [ ] **Step 6: Repack + validate**

```bash
npm run pack
npm run validate:compendia
```
Expected: `validate:compendia` reports 0 errors.

- [ ] **Step 7: Run tests and static checks**

Run:

```bash
node --check scripts/data/maintenance-migration.mjs
node --check scripts/main.mjs
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/data/maintenance-migration.mjs scripts/main.mjs tests/helpers.test.mjs \
  packs/_source/techniques packs/techniques
git commit -m "data: repack Amatsu/Kai-Mon/Champuru with maintenance schema + owned-item migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Phase 1 verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full automated suite**

Run: `npm test && npm run lint`
Expected: PASS, no `stance`-named identifiers remain in the maintenance layer (re-run the grep from Task 8 Step 4 across `scripts`).

- [ ] **Step 2: Manual QA in the `kaihou` world** (per `docs/manual-qa.md`, Dattoumaru Ikazuchi)

Verify, in combat, at the start of the actor's turn:
- **Kai-Mon Kai:** chat reads **"Upkeep: 2 HP lost."** (no "Stance"); HP drops by 2 each turn; when 2 HP would drop below 1, the buff ends with the `UpkeepEnded` notice instead of killing.
- **Amatsu no Karada:** prompt to pay `1d4` HP or end; at mastery ≥ 2 it auto-maintains silently; entry still prompts the element pick.
- **Champuru:** keep/switch/break mode prompt swaps the Dex/Str variant buff; no HP/chakra spent.
- **Speed/Strength rank:** unchanged behaviour (chakra prompt / free-use / deactivate) — confirms the rank path still works through the new engine.
- **A plain technique buff** (no maintenance) still auto-deletes on natural expiry; a manual toggle-off leaves it inactive on the sheet.

- [ ] **Step 3: Add the maintenance regression section to the manual-QA doc**

Insert this section in `docs/manual-qa.md` immediately after the automation-buff expiry checks and before `## Ranks temporarios e bonus de rank`:

```markdown
## Manutencao no inicio do turno

1. Ative KAI-MON KAI e avance ate o inicio do proximo turno.
   Resultado esperado: perde 2 PV com o flavor "Manutencao: 2 PV perdidos.";
   nenhuma mensagem chama a tecnica de stance.

2. Repita KAI-MON KAI com 2 PV.
   Resultado esperado: o buff termina sem aplicar o custo e o ator permanece com
   pelo menos 1 PV.

3. Ative AMATSU NO KARADA abaixo da maestria 2.
   Resultado esperado: escolhe o elemento na entrada e, no inicio do turno,
   oferece pagar 1d4 PV ou encerrar.

4. Repita AMATSU NO KARADA com maestria 2 ou maior.
   Resultado esperado: a manutencao renova silenciosamente, sem custo de PV, e o
   elemento escolhido continua tipando o dano.

5. Ative CHAMPURU DAICHI SUTANSU.
   Resultado esperado: no inicio do turno permite manter, trocar Destreza/Forca
   ou encerrar; apenas uma variante do buff permanece ativa.

6. Deixe expirar um buff comum criado pela automacao e desative outro manualmente.
   Resultado esperado: a expiracao natural remove o primeiro; a desativacao
   manual deixa o segundo inativo na ficha.
```

Then commit:

```bash
git add docs/manual-qa.md
git commit -m "docs: manual-qa maintenance vocabulary"
```

---

# PHASE 2 — Migrate rank config into the schema; collapse the rank handler

## Task 11: Seed rank techniques with `automation.maintenance` (chakra) + repack

**Files:**
- Modify:
  - `packs/_source/techniques/SHODAN_KOUSOKU__RANK_ONE_SPEED__TRCgxJOvq2Kk8cDI.json`
  - `packs/_source/techniques/NIDAN_KOUSOKU__RANK_TWO_SPEED__T8XcfdviCklzMsnb.json`
  - `packs/_source/techniques/SANDAN_KOUSOKU__RANK_THREE_SPEED__E6EsTFPCMQhE5fI0.json`
  - `packs/_source/techniques/YONDAN_KOUSOKU__RANK_FOUR_SPEED__rO5N1fZdtz9vM1M7.json`
  - `packs/_source/techniques/GODAN_KOUSOKU__RANK_FIVE_SPEED__Hf6OyWsMtqJF7ndD.json`
  - `packs/_source/techniques/SHODAN_JOURYOKU__RANK_ONE_STRENGTH__7fzducOMNE63HYKB.json`
  - `packs/_source/techniques/NIDAN_JOURYOKU__RANK_TWO_STRENGTH__J9xySG2rHMr9SpUW.json`
  - `packs/_source/techniques/SANDAN_JOURYOKU__RANK_THREE_STRENGTH__isX30Z0iheQ8KHsX.json`
  - `packs/_source/techniques/YONDAN_JOURYOKU__RANK_FOUR_STRENGTH__ujan06r0vx0nXOKm.json`
  - `packs/_source/techniques/GODAN_JOURYOKU__RANK_FIVE_STRENGTH__Zvw1qeiVouLNN07R.json`
- Repack: `packs/techniques/*`

The rank level→cost/interval table (from `rank-buffs.mjs`): level 1 `{cost:1,interval:5}`, 2 `{2,5}`, 3 `{3,5}`, 4 `{4,5}`, 5 `{1,1}`. (SHODAN..GODAN = levels 1..5.)

- [ ] **Step 1: Confirm the exact source set**

```bash
rg -l '"name": "(SHODAN|NIDAN|SANDAN|YONDAN|GODAN) (KOUSOKU|JOURYOKU)' \
  packs/_source/techniques | sort
```

Expected: exactly the ten files listed above. Do not run `npm run unpack`; source JSON is authoritative and unpacking would overwrite it.

- [ ] **Step 2: Write the maintenance block per rank technique**

For each, set `system.automation.maintenance` with `resource:"chakra"`, `cost` = String(level cost), `policy:"prompt"`, `interval` = level interval, `waiver:"freeUse"`, `waiverStep:5`, `freeRounds:5`, `choice:""`, `element:false`. Example for SHODAN KOUSOKU (level 1):

```json
"maintenance": { "enabled": true, "resource": "chakra", "cost": "1", "policy": "prompt",
  "interval": 5, "waiver": "freeUse", "waiverStep": 5, "freeRounds": 5, "choice": "",
  "element": false, "elementDoubleStep": 5 }
```

- [ ] **Step 3: Repack + validate**

```bash
npm run pack && npm run validate:compendia
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packs/_source/techniques packs/techniques
git commit -m "data: seed rank techniques with chakra maintenance schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Generic chakra-cost path + fold the rank handler into the engine

**Files:**
- Modify: `scripts/automation/turn-maintenance.mjs`
- Modify: `scripts/automation/buff-application.mjs`
- Modify: `scripts/automation/maintenance-buffs.mjs`
- Modify: `scripts/automation/rank-buffs.mjs`
- Modify: `scripts/automation/rank-effective-level.mjs`
- Modify: `scripts/automation/rank-rolldata.mjs`
- Modify: `scripts/ui/rank-grant-config.mjs`
- Modify: `scripts/data/maintenance-migration.mjs`
- Modify: `packs/_source/technique-buffs/SPEED_RANK_GRANT__y8EKFyT0gjQsJzlq.json`
- Modify: `packs/_source/technique-buffs/STRENGTH_RANK_GRANT__YrfCxZYnPfYGo2ok.json`
- Repack: `packs/technique-buffs/*`
- Delete: `scripts/automation/rank-buff-maintenance.mjs`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing tests for unified rank metadata and migration**

Add these imports:

```js
import { getRankMaintenanceFlag } from "../scripts/automation/maintenance-buffs.mjs";
import { getRankGrantType, rankGrantLevel } from "../scripts/automation/rank-buffs.mjs";
import {
  legacyRankBuffToMaintenance,
  rankMaintenanceFromContext,
} from "../scripts/data/maintenance-migration.mjs";
```

Add:

```js
describe("unified rank maintenance metadata", () => {
  const buff = {
    flags: {
      "naruto-d20": {
        maintenanceBuff: { key: "KOUSOKU", grantType: "bonus" },
      },
    },
    system: { level: 2 },
  };

  it("reads rank type and granted level from the unified flag", () => {
    assert.equal(getRankMaintenanceFlag(buff).key, "KOUSOKU");
    assert.equal(getRankGrantType(buff), "bonus");
    assert.equal(rankGrantLevel(buff), 2);
  });

  it("maps a legacy rankBuff payload without storing level/cost/interval", () => {
    assert.deepEqual(
      legacyRankBuffToMaintenance({
        key: "JOURYOKU",
        grantType: "paid",
        level: 3,
        cost: 3,
        interval: 5,
        sourceTechniqueId: "tech1",
      }),
      {
        key: "JOURYOKU",
        grantType: "paid",
        sourceTechniqueId: "tech1",
      },
    );
  });

  it("builds actor-owned rank maintenance from name-derived context", () => {
    assert.deepEqual(
      rankMaintenanceFromContext({ cost: 4, interval: 5 }),
      {
        enabled: true,
        resource: "chakra",
        cost: "4",
        policy: "prompt",
        interval: 5,
        waiver: "freeUse",
        waiverStep: 5,
        freeRounds: 5,
        choice: "",
        element: false,
        elementDoubleStep: 5,
      },
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL because the unified rank resolvers and version-2 migration helpers do not exist.

- [ ] **Step 3: Make `maintenanceBuff` carry rank metadata**

In `maintenance-buffs.mjs`, add:

```js
export const RANK_MAINTENANCE_KEYS = ["KOUSOKU", "JOURYOKU"];

export function getRankMaintenanceFlag(item) {
  const flag = getMaintenanceBuffFlag(item);
  return flag && RANK_MAINTENANCE_KEYS.includes(flag.key) ? flag : null;
}
```

Keep the Task 2 `maintenanceBuffFlagData` implementation that copies `key` and `grantType`.

In `rank-buffs.mjs`, remove `RANK_BUFF_FLAG`, `RANK_BUFF_FLAG_PATH`, `rankBuffFlagData`,
`rankBuffDuration`, `getRankBuffFlag`, and `isRankBuffItem`. Import
`getRankMaintenanceFlag` and retain these rank-domain helpers:

```js
export function getRankGrantType(item) {
  const flag = getRankMaintenanceFlag(item);
  if (!flag) return null;
  return RANK_GRANT_TYPES.includes(flag.grantType) ? flag.grantType : "paid";
}

export function rankGrantLevel(item) {
  const flag = getRankMaintenanceFlag(item);
  if (!flag) return 0;
  const level =
    getRankGrantType(item) === "paid"
      ? flag.level ?? item.system?.level ?? 0
      : item.system?.level ?? 0;
  return Math.max(0, Number(level) || 0);
}
```

Keep `resolveRankTechnique`, `rankMaintenanceForLevel`, mastery free-use helpers,
`RANK_GRANT_TYPES`, and mastery constants. Remove `findRankTechniqueForBuff`; after
the unified flag is live, the engine resolves the paid source directly through
`maintenanceBuff.sourceTechniqueId`.

- [ ] **Step 4: Route paid rank application through `maintenanceBuff`**

In `buff-application.mjs`:

1. Remove `RANK_BUFF_FLAG`, `RANK_BUFF_FLAG_PATH`, `rankBuffDuration`, and
   `rankBuffFlagData` imports. Keep `resolveRankTechnique`.
2. In the application loop, pass `maintenanceBuff: context.maintenanceBuff`.
3. Replace the rank branch of `resolveTechniqueBuffContext` with:

```js
const rank = resolveRankTechnique(item.name);
if (rank) {
  return {
    ...rank,
    sourceTechniqueId: item.id,
    duration: maintenanceBuffDuration(rank.interval),
    maintenanceBuff: maintenanceBuffFlagData({
      sourceTechniqueId: item.id,
      grantType: "paid",
      key: rank.key,
    }),
  };
}

return {
  buffName: item.name,
  level: null,
  duration: null,
  maintenanceBuff: null,
  selfTarget: false,
};
```

4. Change the low-level option shape everywhere from
   `{ duration, level, rankBuff, maintenanceBuff }` to
   `{ duration, level, maintenanceBuff }`.
5. Remove all writes to `RANK_BUFF_FLAG_PATH`; creation and refresh write only
   `MAINTENANCE_BUFF_FLAG_PATH` / `MAINTENANCE_BUFF_FLAG`.

- [ ] **Step 5: Fold chakra maintenance into the engine**

In `turn-maintenance.mjs`, remove the `isRankMaintenanceBuff` /
`maintainRankBuff` import and the Phase 1 rank-handler branch from the listener.
At the start of `queueMaintenance`, after reading the flag, add:

```js
if (flag?.key && (flag.grantType ?? "paid") !== "paid") return false;
```

Import:

```js
import { availableChakra, canPayChakra, payChakra } from "../data/chakra-spend.mjs";
import {
  consumeRankMasteryFreeUse,
  ensureRankMasteryDailyUse,
  hasRankMasteryFreeUseAvailable,
} from "./rank-buffs.mjs";
```

Add this branch in `runMaintenance`, after HP:

```js
if (facets.resource === "chakra") {
  return maintainChakraUpkeep(actor, itemId, technique, facets, flag);
}
```

Add:

```js
async function maintainChakraUpkeep(actor, itemId, technique, facets, flag) {
  const cost = Math.max(0, Number(facets.cost) || 0);

  if (facets.policy === "forced") {
    if (!canPayChakra(actor, cost)) {
      warnInsufficientChakra(actor, technique, cost);
      await deleteMaintenanceBuff(actor, itemId);
      return;
    }
    const payment = await payChakra(actor, cost);
    if (!payment.paid) return deleteMaintenanceBuff(actor, itemId);
    await completeMaintenance(actor, itemId, technique, facets, flag);
    return;
  }

  const source =
    facets.waiver === "freeUse"
      ? await ensureRankMasteryDailyUse(technique)
      : technique;
  const canUseFree =
    facets.waiver === "freeUse" &&
    Number(source.system?.mastery ?? 0) >= facets.waiverStep &&
    hasRankMasteryFreeUseAvailable(source);
  const choice = await promptChakraUpkeep(actor, source, cost, facets.interval, {
    canUseFree,
    freeRounds: facets.freeRounds,
  });

  if (choice === "deactivate") {
    await deleteMaintenanceBuff(actor, itemId);
    return;
  }

  if (choice === "free") {
    if (!(await consumeRankMasteryFreeUse(source))) {
      ui.notifications.warn(
        game.i18n.format("NarutoD20.Notifications.RankMasteryFreeUseUnavailable", {
          name: source.name,
        }),
      );
      await deleteMaintenanceBuff(actor, itemId);
      return;
    }
    await completeMaintenance(actor, itemId, technique, facets, flag, facets.freeRounds);
    return;
  }

  if (!canPayChakra(actor, cost)) {
    warnInsufficientChakra(actor, source, cost);
    await deleteMaintenanceBuff(actor, itemId);
    return;
  }
  const payment = await payChakra(actor, cost);
  if (!payment.paid) return deleteMaintenanceBuff(actor, itemId);
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

function warnInsufficientChakra(actor, technique, cost) {
  ui.notifications.warn(
    game.i18n.format("NarutoD20.Notifications.RankBuffMaintenanceNotEnoughChakra", {
      actor: actor.name,
      name: technique.name,
      cost,
      available: availableChakra(actor),
    }),
  );
}

function promptChakraUpkeep(
  actor,
  technique,
  cost,
  interval,
  { canUseFree = false, freeRounds = 5 } = {},
) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const buttons = {};
    if (canUseFree) {
      buttons.free = {
        icon: '<i class="fas fa-certificate"></i>',
        label: game.i18n.localize("NarutoD20.RankMasteryFreeUse.UseFree"),
        callback: () => finish("free"),
      };
    }
    buttons.maintain = {
      icon: '<i class="fas fa-fire"></i>',
      label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Maintain"),
      callback: () => finish("maintain"),
    };
    buttons.deactivate = {
      icon: '<i class="fas fa-times"></i>',
      label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Deactivate"),
      callback: () => finish("deactivate"),
    };

    new Dialog({
      title: game.i18n.format("NarutoD20.RankBuffMaintenance.Title", {
        name: technique.name,
      }),
      content: `<p>${game.i18n.format("NarutoD20.RankBuffMaintenance.Message", {
        actor: actor.name,
        name: technique.name,
        cost,
        interval,
      })}</p>${
        canUseFree
          ? `<p>${game.i18n.format("NarutoD20.RankMasteryFreeUse.MaintenanceMessage", {
              rounds: freeRounds,
            })}</p>`
          : ""
      }`,
      buttons,
      default: canUseFree ? "free" : "maintain",
      close: () => finish("deactivate"),
    }).render(true);
  });
}
```

- [ ] **Step 6: Move rank calculation and grant UI to the unified flag**

Apply these exact import/call replacements:

| File | Replace |
|---|---|
| `rank-effective-level.mjs` | import `getRankMaintenanceFlag` from `maintenance-buffs.mjs`; replace `getRankBuffFlag(item)` with `getRankMaintenanceFlag(item)` |
| `rank-rolldata.mjs` | same import and call replacement |
| `rank-grant-config.mjs` | import `MAINTENANCE_BUFF_FLAG_PATH` and `getRankMaintenanceFlag`; read `const flag = getRankMaintenanceFlag(item)`; pass `flagPath: MAINTENANCE_BUFF_FLAG_PATH` |

Keep `getRankGrantType` and `rankGrantLevel` imported from `rank-buffs.mjs`.
`templates/item/rank-grant-config.hbs` needs no edit because it already writes the
provided `flagPath`.

- [ ] **Step 7: Add migration version 2**

In `maintenance-migration.mjs`, import `resolveRankTechnique` and
`maintenanceBuffFlagData`, bump `MAINTENANCE_MIGRATION_VERSION` to `2`, and add:

```js
export function legacyRankBuffToMaintenance(flag = {}) {
  return maintenanceBuffFlagData({
    sourceTechniqueId: flag.sourceTechniqueId,
    grantType: flag.grantType ?? "paid",
    key: flag.key,
  });
}

export function rankMaintenanceFromContext(context) {
  return {
    enabled: true,
    resource: "chakra",
    cost: String(context.cost),
    policy: "prompt",
    interval: context.interval,
    waiver: "freeUse",
    waiverStep: 5,
    freeRounds: 5,
    choice: "",
    element: false,
    elementDoubleStep: 5,
  };
}
```

Refactor `runMaintenanceMigrations()` to execute version blocks in order. Version
1 remains the Task 9 technique persistence. Version 2 must:

```js
async function migrateVersion2(actors) {
  for (const actor of actors.values()) {
    const updates = [];
    for (const item of actor.items) {
      if (item.type === TECHNIQUE_ITEM_TYPE) {
        const context = resolveRankTechnique(item.name);
        if (context) {
          updates.push({
            _id: item.id,
            "system.automation.maintenance": rankMaintenanceFromContext(context),
          });
        }
        continue;
      }

      const legacy = item.flags?.[MODULE_ID]?.rankBuff;
      if (!legacy) continue;
      updates.push({
        _id: item.id,
        [`flags.${MODULE_ID}.maintenanceBuff`]: legacyRankBuffToMaintenance(legacy),
        [`flags.${MODULE_ID}.-=rankBuff`]: null,
      });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  for (const item of game.items) {
    const legacy = item.flags?.[MODULE_ID]?.rankBuff;
    if (!legacy) continue;
    await item.update({
      [`flags.${MODULE_ID}.maintenanceBuff`]: legacyRankBuffToMaintenance(legacy),
      [`flags.${MODULE_ID}.-=rankBuff`]: null,
    });
  }
}
```

The runner uses:

```js
let completed = current;
if (completed < 1) {
  await migrateVersion1(actors);
  completed = 1;
  await game.settings.set(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, completed);
}
if (completed < 2) {
  await migrateVersion2(actors);
  completed = 2;
  await game.settings.set(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, completed);
}
```

- [ ] **Step 8: Repack the two rank-grant buff sources**

In both source JSON files, replace:

```json
"rankBuff": { "key": "KOUSOKU", "grantType": "temp" }
```

or its JOURYOKU equivalent with:

```json
"maintenanceBuff": { "key": "KOUSOKU", "grantType": "temp" }
```

Preserve each file's own key. Then run:

```bash
npm run pack:buffs
npm run validate:compendia
```

Expected: 0 errors.

- [ ] **Step 9: Delete the old rank maintenance handler**

```bash
git rm scripts/automation/rank-buff-maintenance.mjs
```

- [ ] **Step 10: Static + tests + lint**

Run:

```bash
node --check scripts/automation/turn-maintenance.mjs
node --check scripts/automation/buff-application.mjs
node --check scripts/automation/maintenance-buffs.mjs
node --check scripts/automation/rank-buffs.mjs
node --check scripts/automation/rank-effective-level.mjs
node --check scripts/automation/rank-rolldata.mjs
node --check scripts/ui/rank-grant-config.mjs
node --check scripts/data/maintenance-migration.mjs
npm test
npm run lint
```

Expected: PASS.
Run:

```bash
rg -n "RANK_BUFF_FLAG|RANK_BUFF_FLAG_PATH|isRankMaintenanceBuff|maintainRankBuff|rank-buff-maintenance" scripts
```

Expected: no matches.

Run:

```bash
rg -n "rankBuff" scripts packs/_source/technique-buffs
```

Expected: only the version-2 migration's legacy read/delete paths remain.

- [ ] **Step 11: Commit**

```bash
git add scripts tests/helpers.test.mjs packs/_source/technique-buffs packs/technique-buffs
git commit -m "refactor(automation): fold rank maintenance into the generic engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Phase 2 verification gate

**Files:** none

- [ ] **Step 1: Automated suite**

Run: `npm test && npm run lint && npm run validate:compendia`
Expected: PASS.

- [ ] **Step 2: Manual QA (`kaihou` world)**

- Each rank technique (SHODAN..GODAN, both KOUSOKU and JOURYOKU): chakra upkeep prompt at the correct interval, correct cost; at mastery ≥ 5 the "use free" button appears and grants 5 free rounds consuming a daily charge; deactivate ends the buff; not-enough-chakra ends with the warning.
- Re-confirm Phase 1 behaviours (Kai-Mon/Amatsu/Champuru) still pass — no regression from the rank fold-in.
- A temp/bonus rank grant (granted by another technique) does **not** trigger maintenance and is deleted on expiry.
- Re-run `docs/manual-qa.md`'s paid/temp/bonus rank arithmetic and carrier checks; results must remain unchanged after the flag migration.
- Open SPEED RANK GRANT and STRENGTH RANK GRANT sheets: type/mode fields still edit `maintenanceBuff`, paid buffs remain read-only, and choosing type `None` removes rank behavior.

---

## Self-review notes

- **Spec coverage:** concept facets → Task 1/2; engine → Task 4; de-stance buff app → Task 5; use-technique and runtime wiring → Task 6; sheet → Task 7; i18n + flavour fix → Task 8; HP/mode source data + migration v1 → Task 9; rank technique data → Task 11; chakra flow, rank consumers, grant sources, unified flag, migration v2, and rank-handler deletion → Task 12; verification → Tasks 10/13. The technique `stance` subtype + `isSelfTargetingTechnique` heuristic are explicitly left unchanged.
- **Synckit coupling:** handled via `applyTechniqueSystemDefaults` (Task 1) which is the backfill the synckit normalizer uses; the existing synckit test is updated in Task 1.
- **Persistent-data coverage:** `TechniqueDataModel.migrateData` preserves legacy automation before schema cleaning; migration v1 persists owned technique config; migration v2 seeds actor-owned rank techniques and converts actor/world legacy rank flags; both rank-grant compendium sources are repacked.
- **Type consistency:** `maintenanceFacets` has one shape (`resource`, `cost`, `policy`, `interval`, `waiver`, `waiverStep`, `freeRounds`, `choice`). `maintenanceBuff` has one payload family (`sourceTechniqueId?`, `grantType?`, `key?`, `modeId?`, `elements?`); rank level stays in `buff.system.level`.
- **Placeholder scan:** clean. Every code-changing task names exact files, replacements, commands, and expected results; no optional implementation choice or undefined helper remains.
