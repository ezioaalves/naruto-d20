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
- After each task: `npm test` and `npm run lint` must pass before committing.
- Vocabulary map (apply consistently): `stance`→`maintenance`, `stanceBuff` flag → `maintenanceBuff`, `STANCE_MODES`→`MAINTENANCE_MODES`, `stanceModeById`→`maintenanceModeById`, `stanceBuffName`→`maintenanceModeBuffName`, `stanceBuffDuration`→`maintenanceBuffDuration`, `getStanceBuffFlag`→`getMaintenanceBuffFlag`, `findStanceBuffForTechnique`→`findMaintenanceBuffForTechnique`, `applyStanceModeBuff`→`applyModeBuff`, `applyUpkeepStanceBuff`→`applyUpkeepBuff`, `promptStanceMode`→`promptModeChoice`, `getActiveStanceElements`→`getActiveElements`, `promptStanceElements`→`promptElements`, `stanceElementCount`→`elementCount`, `setPendingCastElements`/`clearPendingCastElements` keep their names. `NarutoD20.StanceBuff.*`→`NarutoD20.Maintenance.*`, `NarutoD20.StanceElement.*`→`NarutoD20.MaintenanceElement.*`.

---

## File structure

**Create:**
- `scripts/automation/turn-maintenance.mjs` — the engine (listener + queue + generic `runMaintenance` + helpers + handler dispatch).
- `scripts/automation/maintenance-buffs.mjs` — unified `maintenanceBuff` flag, modes, facet resolvers (renames `stance-buffs.mjs`).
- `scripts/automation/maintenance-element-damage.mjs` — entry-time element pick + damage typing (renames `stance-element-damage.mjs`).

**Modify:**
- `scripts/data/technique-model.mjs` — `automation.maintenance` schema block.
- `scripts/data/technique-defaults.mjs` — backfill the new `automation.maintenance` defaults.
- `scripts/automation/buff-application.mjs` — renamed apply fns, schema-driven dispatch, `maintenanceBuff` apply option.
- `scripts/automation/rank-buff-maintenance.mjs` — expose a handler entry the engine calls (Phase 1 keeps logic; Phase 2 folds in).
- `scripts/use-technique.mjs` — renamed helpers, `stanceFree`→`upkeepFree`.
- `scripts/ui/technique-sheet.mjs` — unified maintenance `getData` choices.
- `templates/item/technique-sheet.hbs` — unified maintenance controls.
- `scripts/main.mjs` — swap `registerExpiredBuffCleanup()` → `registerTurnMaintenance()`.
- `lang/en.json`, `lang/pt-BR.json` — i18n namespace rename + the "Upkeep:" flavour fix.
- `tests/helpers.test.mjs` — update the synckit automation-field test; add new unit tests.
- `packs/_source/techniques/*` (Amatsu, Kai-Mon, Champuru; Phase 2: rank techniques) + repacked `packs/techniques/*`.

**Delete (Phase 1):**
- `scripts/automation/buff-expiry.mjs` (listener absorbed into `turn-maintenance.mjs`).
- `scripts/automation/stance-buff-maintenance.mjs`.

**Delete (Phase 2):**
- name-driven rank dispatch in `rank-buff-maintenance.mjs` (file may be removed entirely once folded in); slim `rank-buffs.mjs` to the migration seed table.

---

# PHASE 1 — Generic engine + de-stance (HP/mode), ranks routed through engine with name-driven config

## Task 1: Unified `automation.maintenance` schema

**Files:**
- Modify: `scripts/data/technique-model.mjs:370-414`
- Modify: `scripts/data/technique-defaults.mjs:47-56`
- Test: `tests/helpers.test.mjs` (the `applyTechniqueSystemDefaults` + synckit tests)

- [ ] **Step 1: Update the failing unit test for defaults**

In `tests/helpers.test.mjs`, replace the synckit no-op test's `automation` objects (currently referencing `stanceMode/stanceUpkeep/elementChoice/upkeepFormula/upkeepMode/upkeepWaiverStep/elementDoubleStep`, lines ~381-400) with the new nested block, and add an assertion in the "technique defaults" describe block:

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

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: FAIL — `system.automation.maintenance` is `undefined` and the synckit diff is not equal.

- [ ] **Step 3: Replace the schema fields**

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

- [ ] **Step 4: Update the defaults backfill**

In `scripts/data/technique-defaults.mjs`, replace lines 50-56 (`system.automation.stanceMode ??= false` … `system.automation.elementDoubleStep ??= 5`) with:

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

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/technique-model.mjs scripts/data/technique-defaults.mjs tests/helpers.test.mjs
git commit -m "refactor(technique): unify automation.maintenance schema block

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `maintenance-buffs.mjs` — unified flag + facet resolvers

**Files:**
- Create: `scripts/automation/maintenance-buffs.mjs` (git-rename from `stance-buffs.mjs`)
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing unit tests**

Add to `tests/helpers.test.mjs` (and add the import at top):

```js
import {
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module/exports do not exist.

- [ ] **Step 3: Rename and rewrite the module**

```bash
git mv scripts/automation/stance-buffs.mjs scripts/automation/maintenance-buffs.mjs
```

Rewrite `scripts/automation/maintenance-buffs.mjs` to:
- export `MAINTENANCE_BUFF_FLAG = "maintenanceBuff"` and `MAINTENANCE_BUFF_FLAG_PATH = flags.${MODULE_ID}.${MAINTENANCE_BUFF_FLAG}`.
- export `MAINTENANCE_MODES` (renamed `STANCE_MODES`), `ELEMENTS` + `ELEMENT_IDS` (renamed `STANCE_ELEMENTS`/`STANCE_ELEMENT_IDS`), and the helpers below.
- keep `maintenanceBuffDuration()` (renamed `stanceBuffDuration`, body unchanged).

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
 * Unified maintenance-buff flag payload. `grantType` is carried for rank buffs;
 * modeId/elements for mode/element techniques.
 */
export function maintenanceBuffFlagData({ sourceTechniqueId, grantType, modeId, elements } = {}) {
  const data = { sourceTechniqueId: sourceTechniqueId ?? null };
  if (grantType) data.grantType = grantType;
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

Drop the old `stanceBuffFlagData`/`stanceBuffKind`/`isStanceBuffItem`/`isModeChoiceStance`/`isUpkeepStance`/`isElementStance` "kind" discriminator — facet reads from the schema now make the discriminated flag-kind obsolete. Keep `MAINTENANCE_MODES` shape `{ id, suffix, labelKey }` with the labelKey pointed at `NarutoD20.Maintenance.Dexterity`/`.Strength` (renamed in Task 9). Keep `ELEMENTS` labelKeys pointed at `NarutoD20.MaintenanceElement.*`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: PASS for the new `maintenance facets` describe block. (Other modules still importing the old names will be fixed in later tasks — if `npm test` imports break, those imports are updated in Tasks 3/6; run `node --check` per-file as you go.)

- [ ] **Step 5: Commit**

```bash
git add scripts/automation/maintenance-buffs.mjs tests/helpers.test.mjs
git commit -m "refactor(automation): maintenance-buffs flag + facet resolver (was stance-buffs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `maintenance-element-damage.mjs` rename + schema reads

**Files:**
- Create: `scripts/automation/maintenance-element-damage.mjs` (git-rename from `stance-element-damage.mjs`)
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing unit test for the element count**

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

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Rename and update reads**

```bash
git mv scripts/automation/stance-element-damage.mjs scripts/automation/maintenance-element-damage.mjs
```

In the new file: rename exports `getActiveStanceElements`→`getActiveElements`, `promptStanceElements`→`promptElements`, `stanceElementCount`→`elementCount`, `registerStanceElementDamage`→`registerElementDamage`. Update the element-source reads from `item.system.automation.elementChoice` / `elementDoubleStep` to `item.system.automation.maintenance.element` / `.maintenance.elementDoubleStep`. Update i18n keys to `NarutoD20.MaintenanceElement.*`. Update the `ELEMENTS`/`ELEMENT_IDS` import to come from `maintenance-buffs.mjs`.

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

- [ ] **Step 4: Run tests + check imports**

Run: `npm test`
Expected: PASS for `maintenance element count`.
Run: `node --check scripts/automation/maintenance-element-damage.mjs`
Expected: no output (valid).

- [ ] **Step 5: Commit**

```bash
git add scripts/automation/maintenance-element-damage.mjs tests/helpers.test.mjs
git commit -m "refactor(automation): maintenance-element-damage rename + schema reads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: The engine — `turn-maintenance.mjs`

**Files:**
- Create: `scripts/automation/turn-maintenance.mjs`
- Modify: `scripts/automation/rank-buff-maintenance.mjs` (export `resolveRankMaintenanceHandler`)
- Delete: `scripts/automation/buff-expiry.mjs`, `scripts/automation/stance-buff-maintenance.mjs`
- Modify: `scripts/main.mjs:40,206`

> No unit test: this is entirely Foundry-wired (Hooks/Dialog/actor docs). Verified via `node --check`, `npm run lint`, and the Phase 1 manual-QA gate (Task 12).

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
import { maintainRankBuff, queueRankBuffMaintenance } from "./rank-buff-maintenance.mjs";

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

    // Phase 1: ranks keep their own (name-driven) handler, routed through here.
    if (queueRankBuffMaintenance(item)) return;
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
  const key = `${actor.uuid}:${item.id}`;
  if (pending.has(key)) return true;
  pending.add(key);
  const itemId = item.id;
  window.setTimeout(async () => {
    try {
      await runMaintenance(actor, itemId);
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

  // Mode choice (no cost — Champuru): prompt keep/switch/break.
  if (facets.choice === "mode" && facets.resource === "") {
    const choice = await promptModeChoice(technique, { current: flag.modeId, allowBreak: true });
    if (!choice || choice === "break") return deleteMaintenanceBuff(actor, itemId);
    await applyModeBuff(technique, actor, choice); // re-applies + drops old variant
    return;
  }

  // Cost facet. HP only in Phase 1 (chakra-cost ranks go through the rank handler).
  if (facets.resource === "hp") return maintainHpUpkeep(actor, itemId, technique, facets);

  // No recognised facet to act on → keep it simple and refresh.
  await refreshMaintenanceBuff(actor, itemId, facets.interval);
}

async function maintainHpUpkeep(actor, itemId, technique, facets) {
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
    await applyUpkeepBuff(technique, actor);
    return;
  }

  // policy "prompt" with optional step waiver.
  if (facets.waiver === "step") {
    const mastery = Number(technique.system?.mastery ?? 0) || 0;
    if (mastery >= facets.waiverStep) {
      await applyUpkeepBuff(technique, actor);
      return;
    }
  }

  const choice = await promptHpUpkeep(technique, formula);
  if (choice !== "pay") return deleteMaintenanceBuff(actor, itemId);
  await applyHpCost(actor, formula);
  await applyUpkeepBuff(technique, actor);
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

Note: `maintenanceBuffDuration(interval)` takes an interval (default 1). Update its body in `maintenance-buffs.mjs` to accept `interval = 1` and set `value: String(interval)`.

- [ ] **Step 2: Keep the rank handler callable from the engine**

`scripts/automation/rank-buff-maintenance.mjs` already exports `queueRankBuffMaintenance`. Leave its logic intact (Phase 1). Confirm it still reads its own `rankBuff` flag and name config. No edit required beyond confirming the export.

- [ ] **Step 3: Delete the superseded files**

```bash
git rm scripts/automation/buff-expiry.mjs scripts/automation/stance-buff-maintenance.mjs
```

- [ ] **Step 4: Wire it in `main.mjs`**

In `scripts/main.mjs`: change the import on line 40 from
`import { registerExpiredBuffCleanup } from "./automation/buff-expiry.mjs";` to
`import { registerTurnMaintenance } from "./automation/turn-maintenance.mjs";`
and line 206 from `registerExpiredBuffCleanup();` to
`registerTurnMaintenance(); // unified start-of-turn maintenance + spent-buff cleanup`.

- [ ] **Step 5: Static checks**

Run: `node --check scripts/automation/turn-maintenance.mjs && node --check scripts/main.mjs`
Expected: no output.
Run: `npm run lint`
Expected: PASS (after Tasks 5-9 land the renamed imports this module references; if lint flags missing exports from `buff-application.mjs`, proceed to Task 5 before committing this group — these tasks land together).

- [ ] **Step 6: Commit (with Task 5)**

Commit after Task 5 so the `buff-application.mjs` exports the engine imports exist.

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
    await applyModeBuff(item, actor);
    return;
  }
  if (facets.resource === "hp" || item.system.automation.maintenance.element) {
    await applyUpkeepBuff(item, actor);
    return;
  }
}
```

- [ ] **Step 3: Rename apply fns + flag option**

- `applyStanceModeBuff` → `applyModeBuff`; inside, `promptStanceMode`→`promptModeChoice`, `removeStanceBuff`→`removeMaintenanceBuff`, `stanceModeById`→`maintenanceModeById`, `stanceBuffName`→`maintenanceModeBuffName`, `findStanceBuffForTechnique`→`findMaintenanceBuffForTechnique`, `stanceBuffDuration()`→`maintenanceBuffDuration(1)`, and the apply option `stanceBuff: stanceBuffFlagData({...modeId})` → `maintenanceBuff: maintenanceBuffFlagData({ sourceTechniqueId: item.id, modeId: mode.id })`. Update the warn string to `"No mode buff found named …"`.
- `applyUpkeepStanceBuff` → `applyUpkeepBuff`; `getActiveStanceElements`→`getActiveElements` (import from `maintenance-element-damage.mjs`), `stanceBuffDuration()`→`maintenanceBuffDuration(1)`, apply option → `maintenanceBuff: maintenanceBuffFlagData({ sourceTechniqueId: item.id, elements })`.
- `promptStanceMode` → `promptModeChoice`; `STANCE_MODES`→`MAINTENANCE_MODES`, `stanceModeById`→`maintenanceModeById`, i18n `NarutoD20.StanceBuff.*`→`NarutoD20.Maintenance.*`.
- `removeStanceBuff` → `removeMaintenanceBuff` (body unchanged).

- [ ] **Step 4: Unified apply option in the low-level apply path**

In `normalizeBuffApplyOptions`, `refreshExistingBuff`, `createBuffOnTarget`, and `applyBuffToTarget`: replace the `stanceBuff` option with `maintenanceBuff`, writing to `MAINTENANCE_BUFF_FLAG_PATH` (refresh) / `itemData.flags[SOURCE_FLAG][MAINTENANCE_BUFF_FLAG]` (create). **Keep** the `rankBuff` option/path untouched (Phase 1). Example for `refreshExistingBuff`:

```js
if (maintenanceBuff) updates[MAINTENANCE_BUFF_FLAG_PATH] = maintenanceBuff;
```

Leave the `isSelfTargetingTechnique` stance-subtype check at line 271 **unchanged** (out of scope).

- [ ] **Step 5: Static + lint**

Run: `node --check scripts/automation/buff-application.mjs && npm run lint`
Expected: PASS (with Task 4's engine in place).
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit Tasks 4 + 5 together**

```bash
git add scripts/automation/turn-maintenance.mjs scripts/automation/buff-application.mjs scripts/automation/rank-buff-maintenance.mjs scripts/main.mjs
git commit -m "refactor(automation): unified turn-maintenance engine; de-stance buff application

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `use-technique.mjs` — renamed helpers + upkeepFree

**Files:**
- Modify: `scripts/use-technique.mjs:19-29,47-51,71-81,108,127,141,343-344`

- [ ] **Step 1: Update imports + helper calls**

- Imports: from `maintenance-buffs.mjs` use `findMaintenanceBuffForTechnique`, `maintenanceFacets`; from `maintenance-element-damage.mjs` use `getActiveElements`, `promptElements`, `setPendingCastElements`, `clearPendingCastElements`, `elementCount`.
- `isUpkeepStance(currentItem)` → `maintenanceFacets(currentItem)?.resource === "hp"`.
- `isElementStance(currentItem)` → `currentItem.system.automation.maintenance?.element === true`.
- `findStanceBuffForTechnique` → `findMaintenanceBuffForTechnique`.
- Rename local `stanceFree` → `upkeepFree` throughout (lines 49-51, 108, 127, 141, 343-344).
- `getActiveStanceElements`→`getActiveElements`, `promptStanceElements`→`promptElements`, `stanceElementCount`→`elementCount`.
- Card footer key: `NarutoD20.Cards.Perform.StanceFree` → `NarutoD20.Cards.Perform.UpkeepFree`.

- [ ] **Step 2: Static + tests**

Run: `node --check scripts/use-technique.mjs && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/use-technique.mjs
git commit -m "refactor(use-technique): maintenance-named helpers, upkeepFree

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

<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Resource.Label"}}</label>
  <select name="system.automation.maintenance.resource">
    {{selectOptions maintenanceResourceChoices selected=system.automation.maintenance.resource}}
  </select>
</div>
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
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.Waiver.Label"}}</label>
  <select name="system.automation.maintenance.waiver">
    {{selectOptions maintenanceWaiverChoices selected=system.automation.maintenance.waiver}}
  </select>
</div>
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.WaiverStep.Label"}}</label>
  <input type="number" step="1" min="0" name="system.automation.maintenance.waiverStep" value="{{system.automation.maintenance.waiverStep}}">
</div>
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.FreeRounds.Label"}}</label>
  <input type="number" step="1" min="1" name="system.automation.maintenance.freeRounds" value="{{system.automation.maintenance.freeRounds}}">
</div>
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
<div class="form-group">
  <label>{{localize "NarutoD20.Automation.Maintenance.ElementDoubleStep.Label"}}</label>
  <input type="number" step="1" min="0" name="system.automation.maintenance.elementDoubleStep" value="{{system.automation.maintenance.elementDoubleStep}}">
</div>
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

- [ ] **Step 2: Rename the `StanceBuff`/`StanceElement` blocks**

Rename `NarutoD20.StanceBuff` → `NarutoD20.Maintenance` and `NarutoD20.StanceElement` → `NarutoD20.MaintenanceElement` in both files. Keep all sub-keys (`Title`, `Message`, `MessageInitial`, `Dexterity`, `Strength`, `DexHint`, `StrHint`, `Break`, `UpkeepTitle`, `UpkeepMessage`, `PayHp`, `UpkeepEnded`, `HpCostFlavor`; element `Title`/`Prompt`/…). **Change `HpCostFlavor`** EN value `"Stance upkeep: {amount} HP lost."` → `"Upkeep: {amount} HP lost."` (PT-BR: `"Manutenção: {amount} de HP perdido."`). Update the Champuru-specific wording in `Message`/`MessageInitial` to drop "stance" (e.g. EN `"{name} continues at the start of your turn. Keep your mode, switch, or break it:"`).

- [ ] **Step 3: Rename the perform-card key**

Rename `NarutoD20.Cards.Perform.StanceFree` → `NarutoD20.Cards.Perform.UpkeepFree` in both files (value EN: `"Upkeep active — no chakra spent."`).

- [ ] **Step 4: Validate JSON + lint**

Run: `python3 -c "import json; json.load(open('lang/en.json')); json.load(open('lang/pt-BR.json')); print('ok')"`
Expected: `ok`.
Run: `npm run lint:format`
Expected: PASS (prettier-clean).
Run: `grep -rn "StanceBuff\|StanceElement\|StanceMode\|StanceUpkeep\|stanceMode\|stanceUpkeep\|StanceFree\|UpkeepFormula\|UpkeepMode\b" scripts lang templates`
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
- Modify source JSON: `packs/_source/techniques/*AMATSU*`, `*KAI*MON*`, `*CHAMPURU*`
- Repack: `packs/techniques/*`
- Modify: `scripts/main.mjs` `ready` hook (add a one-time owned-technique migration)

- [ ] **Step 1: Unpack, locate the three source files**

```bash
npm run unpack
grep -rl "AmatsuKarada\|Amatsu no Karada" packs/_source/techniques | head
grep -rl "Kai-Mon\|KAI-MON\|Initial Gate" packs/_source/techniques | head
grep -rl "Champuru" packs/_source/techniques | head
```

- [ ] **Step 2: Rewrite each technique's `system.automation`**

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

- [ ] **Step 3: Repack + validate**

```bash
npm run pack
npm run validate:compendia
```
Expected: `validate:compendia` reports 0 errors.

- [ ] **Step 4: Add the owned-item migration**

In `scripts/main.mjs` `ready` hook (GM-only block, alongside the existing migrations), add a one-time migration that maps any actor-owned technique item's legacy automation fields → the `maintenance` block. Gate it behind a world-setting flag like the other migrations (follow the existing migration pattern in `main.mjs`). Mapping:

```js
// for each owned item of type "naruto-d20.technique" whose system.automation
// still has legacy keys (stanceUpkeep/stanceMode/elementChoice/upkeep*):
const a = item.system.automation ?? {};
const maintenance = {
  enabled: Boolean(a.stanceUpkeep || a.stanceMode),
  resource: a.stanceUpkeep ? "hp" : "",
  cost: a.upkeepFormula ?? "1d4",
  policy: a.upkeepMode ?? "prompt",
  interval: 1,
  waiver: a.stanceUpkeep && (a.upkeepMode ?? "prompt") === "prompt" ? "step" : "",
  waiverStep: a.upkeepWaiverStep ?? 2,
  freeRounds: 5,
  choice: a.stanceMode ? "mode" : "",
  element: Boolean(a.elementChoice),
  elementDoubleStep: a.elementDoubleStep ?? 5,
};
// update: { "system.automation.maintenance": maintenance,
//   "system.automation.-=stanceMode": null, … } to strip legacy keys
```

Synckit re-sync from the repacked compendium also covers owned copies; this migration is the belt-and-suspenders for actors who never re-sync.

- [ ] **Step 5: Commit**

```bash
git add packs/_source/techniques packs/techniques scripts/main.mjs
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

- [ ] **Step 3: Update the manual-QA doc vocabulary**

In `docs/manual-qa.md`, rename "stance" maintenance entries to "maintenance/upkeep" to match. Commit:

```bash
git add docs/manual-qa.md
git commit -m "docs: manual-qa maintenance vocabulary"
```

---

# PHASE 2 — Migrate rank config into the schema; collapse the rank handler

## Task 11: Seed rank techniques with `automation.maintenance` (chakra) + repack

**Files:**
- Modify source JSON: `packs/_source/techniques/*` (the 10 rank techniques: `{SHODAN,NIDAN,SANDAN,YONDAN,GODAN} {KOUSOKU,JOURYOKU}`)
- Repack: `packs/techniques/*`

The rank level→cost/interval table (from `rank-buffs.mjs`): level 1 `{cost:1,interval:5}`, 2 `{2,5}`, 3 `{3,5}`, 4 `{4,5}`, 5 `{1,1}`. (SHODAN..GODAN = levels 1..5.)

- [ ] **Step 1: Unpack + locate rank techniques**

```bash
npm run unpack
grep -rln "KOUSOKU\|JOURYOKU" packs/_source/techniques
```

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
- Modify: `scripts/automation/buff-application.mjs` (rank apply uses unified flag)
- Modify: `scripts/automation/maintenance-buffs.mjs` (`grantType` aware)
- Modify: `scripts/automation/rank-buffs.mjs` (slim to free-use helpers + name table for migration)
- Delete: `scripts/automation/rank-buff-maintenance.mjs`
- Modify: `scripts/main.mjs` ready migration (rank buffs → unified flag)
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing unit tests for the chakra facet + free-use waiver gating**

```js
describe("maintenance chakra facet", () => {
  const rank = (mastery) => ({
    name: "SHODAN KOUSOKU (SPEED RANK)",
    system: { mastery, automation: { maintenance: {
      enabled: true, resource: "chakra", cost: "1", policy: "prompt", interval: 5,
      waiver: "freeUse", waiverStep: 5, freeRounds: 5, choice: "", element: false,
    } } },
  });
  it("exposes chakra cost and freeUse waiver", () => {
    const f = maintenanceFacets(rank(5));
    assert.equal(f.resource, "chakra");
    assert.equal(f.waiver, "freeUse");
    assert.equal(f.cost, "1");
    assert.equal(f.interval, 5);
  });
});
```

- [ ] **Step 2: Run to verify failure/pass**

Run: `npm test`
Expected: PASS already if Task 11's schema is read generically — this test only exercises `maintenanceFacets`, which is resource-agnostic. (If it passes immediately, keep it as a regression guard and proceed.)

- [ ] **Step 3: Add the chakra branch to `runMaintenance`**

In `turn-maintenance.mjs`, extend `runMaintenance` to handle `facets.resource === "chakra"` via a `maintainChakraUpkeep(actor, itemId, technique, facets, flag)` that reproduces the rank prompt (pay chakra / use-free if `waiver==="freeUse"` and a daily charge is available / deactivate), using `canPayChakra`/`payChakra` (from `data/chakra-spend.mjs`) and the free-use helpers retained in `rank-buffs.mjs` (`hasRankMasteryFreeUseAvailable`, `consumeRankMasteryFreeUse`, `ensureRankMasteryDailyUse`, `findRankTechniqueForBuff`). On pay → `refreshMaintenanceBuff(actor, itemId, facets.interval)`; on free → refresh for `facets.freeRounds`; on deactivate → delete. Reuse the dialog/strings under `NarutoD20.RankBuffMaintenance.*` / `NarutoD20.RankMasteryFreeUse.*` (or migrate them under `NarutoD20.Maintenance.*` if you prefer one namespace — keep value strings).

- [ ] **Step 4: Route rank buffs through the unified flag**

- In `buff-application.mjs` `resolveTechniqueBuffContext`: when `resolveRankTechnique(item.name)` matches, apply via `applyBuffToTarget(..., { duration, maintenanceBuff: maintenanceBuffFlagData({ sourceTechniqueId: item.id, grantType: "paid" }) })` and stop writing the separate `rankBuff` option. Remove the `rankBuff` option from `normalizeBuffApplyOptions`/`refreshExistingBuff`/`createBuffOnTarget`.
- In the engine listener, delete the `queueRankBuffMaintenance(item)` call — rank buffs now carry the `maintenanceBuff` flag and a maintained source technique, so `queueMaintenance` picks them up. `grantType` of `temp`/`bonus` → `queueMaintenance` returns false (no maintenance), matching prior behaviour. Update `queueMaintenance`/`runMaintenance` to read `flag.grantType` and bail to generic-delete for non-`paid` grants.

- [ ] **Step 5: Delete the rank maintenance file + slim rank-buffs**

```bash
git rm scripts/automation/rank-buff-maintenance.mjs
```
In `rank-buffs.mjs`, remove `rankBuffFlagData`/`rankBuffDuration`/`getRankBuffFlag`/`isRankBuffItem`/`getRankGrantType`/`rankGrantLevel` paths no longer referenced; keep `resolveRankTechnique` (migration seed) and the free-use helpers used by the chakra branch. Remove dead `RANK_BUFF_FLAG` exports and the `rank-buffs` imports from `buff-application.mjs` that are no longer used.

- [ ] **Step 6: Migrate live rank buffs in `ready`**

Extend the `ready` migration to convert any owned buff carrying the legacy `flags.naruto-d20.rankBuff` into the unified `flags.naruto-d20.maintenanceBuff` (`{ sourceTechniqueId, grantType }`) and strip `rankBuff`. (Clean-break still applies to in-flight buffs; this just avoids orphaning a 5-round rank buff mid-combat.)

- [ ] **Step 7: Static + tests + lint**

Run: `node --check scripts/automation/turn-maintenance.mjs scripts/automation/buff-application.mjs scripts/automation/rank-buffs.mjs scripts/main.mjs && npm test && npm run lint`
Expected: PASS.
Run: `grep -rn "rankBuff\|RANK_BUFF_FLAG\|queueRankBuffMaintenance" scripts`
Expected: only the intended migration reads remain.

- [ ] **Step 8: Commit**

```bash
git add scripts
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

- [ ] **Step 3: Final cleanup commit (if any QA fixes)**

```bash
git add -A && git commit -m "fix: rank maintenance QA follow-ups"
```

---

## Self-review notes

- **Spec coverage:** concept facets → Task 1/2; engine → Task 4; de-stance buff app → Task 5; use-technique → Task 6; sheet → Task 7; i18n + flavour fix → Task 8; repack + owned migration → Task 9 (HP/mode) + Task 11 (rank); unified flag + collapse → Task 12; phasing & verification → Tasks 10/13. The technique `stance` subtype + `isSelfTargetingTechnique` heuristic are explicitly left unchanged (Task 5 Step 4).
- **Synckit coupling:** handled via `applyTechniqueSystemDefaults` (Task 1) which is the backfill the synckit normalizer uses; the existing synckit test is updated in Task 1.
- **Type consistency:** the vocabulary map at the top is the single source for renamed identifiers; `maintenanceFacets` shape (resource/cost/policy/interval/waiver/waiverStep/freeRounds/choice) is defined once in Task 2 and consumed identically in Tasks 4/5/6/12.
