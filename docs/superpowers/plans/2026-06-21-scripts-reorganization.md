# Scripts Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `scripts/` so ownership is visible by feature/domain while preserving Foundry VTT/PF1e runtime behavior.

**Architecture:** Do this as a staged migration. First introduce stable core and lifecycle modules plus validation, then move one domain at a time behind temporary re-export shims. `scripts/main.mjs` remains the single Foundry entrypoint, but becomes a thin lifecycle router instead of importing every subsystem directly.

**Tech Stack:** JavaScript ESM loaded directly by Foundry VTT 13, PF1e v11.11, Handlebars templates, npm validation scripts, manual Foundry reload QA.

---

## Target Structure

Final target after all tasks:

```text
scripts/
  main.mjs
  core/
    constants.mjs
    flag-paths.mjs
    public-api.mjs
    settings.mjs
    templates.mjs
    pf1-config.mjs
  lifecycle/
    init.mjs
    pf1-post-init.mjs
    actor-data.mjs
    setup.mjs
    actor-create.mjs
    ready.mjs
    rest.mjs
  features/
    techniques/
      action-ids.mjs
      browser.mjs
      defaults.mjs
      header.mjs
      learn.mjs
      list.mjs
      master.mjs
      model.mjs
      queries.mjs
      rolldata.mjs
      save-dc.mjs
      sheet.mjs
      sync-app.mjs
      sync.mjs
      use.mjs
      weapon-attack.mjs
    chakra/
      bonus-sources.mjs
      conditions.mjs
      damage.mjs
      rest-recovery.mjs
      spend.mjs
      tap-reserves.mjs
    actor-stats/
      derived-data.mjs
      skills.mjs
      summary-stats.mjs
    automation/
      buffs/
        application.mjs
        condition-benefits.mjs
      combat/
      maintenance/
      occupations/
      ranks/
      training/
    chat/
      rerolls.mjs
      visibility.mjs
  ui/
    browser-shared.mjs
    render-patch.mjs
  utils/
    drag-drop.mjs
  dev/
    check-imports.mjs
```

Temporary compatibility shims may exist at old paths during migration. Remove them only after all internal imports are updated and Foundry manual QA passes.

## Task 1: Add Import Validation Guard

**Files:**
- Create: `scripts/dev/check-imports.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the import checker**

Create `scripts/dev/check-imports.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, "scripts");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [absolute] : [];
  });
}

const files = walk(SCRIPTS_DIR);
const missing = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));

  for (const specifier of imports) {
    const resolved = path.resolve(path.dirname(file), specifier);
    const candidates = [
      resolved,
      `${resolved}.mjs`,
      path.join(resolved, "index.mjs"),
    ];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      missing.push(`${path.relative(ROOT, file)} -> ${specifier}`);
    }
  }
}

if (missing.length) {
  console.error("Missing relative ESM imports:");
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}

console.log(`Checked ${files.length} script modules; all relative imports resolve.`);
```

- [ ] **Step 2: Add npm script**

Add this entry to `package.json` under `scripts`:

```json
"validate:imports": "node scripts/dev/check-imports.mjs"
```

- [ ] **Step 3: Run validation**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Expected:

```text
Checked ... script modules; all relative imports resolve.
```

`validate:compendia` should complete without validation errors.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/dev/check-imports.mjs
git commit -m "chore(scripts): add import validation guard"
```

## Task 2: Extract Core Runtime Modules

**Files:**
- Create: `scripts/core/constants.mjs`
- Create: `scripts/core/flag-paths.mjs`
- Create: `scripts/core/public-api.mjs`
- Modify: `scripts/constants.mjs`
- Modify: `scripts/flag-paths.mjs`
- Modify: `scripts/public-api.mjs`

- [ ] **Step 1: Move core files**

Move the current file contents:

```bash
mkdir -p scripts/core
git mv scripts/constants.mjs scripts/core/constants.mjs
git mv scripts/flag-paths.mjs scripts/core/flag-paths.mjs
git mv scripts/public-api.mjs scripts/core/public-api.mjs
```

- [ ] **Step 2: Fix core-local imports**

In `scripts/core/flag-paths.mjs`, change:

```js
import { MODULE_ID } from "./constants.mjs";
```

Keep it as:

```js
import { MODULE_ID } from "./constants.mjs";
```

No path change is needed because both files now live in `scripts/core/`.

In `scripts/core/public-api.mjs`, update imports that point to old top-level feature modules to their current compatibility paths for this task:

```js
import { TECHNIQUE_ITEM_TYPE } from "./constants.mjs";
import { attemptLearnTechnique, buildLearningView } from "../learn-technique.mjs";
import { attemptMasterTechnique, buildMasteryView } from "../master-technique.mjs";
import { listLearnable, listMasterable } from "../technique-queries.mjs";
```

- [ ] **Step 3: Add compatibility shims**

Create `scripts/constants.mjs`:

```js
export * from "./core/constants.mjs";
```

Create `scripts/flag-paths.mjs`:

```js
export * from "./core/flag-paths.mjs";
```

Create `scripts/public-api.mjs`:

```js
export * from "./core/public-api.mjs";
```

- [ ] **Step 4: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add scripts package.json
git commit -m "refactor(scripts): introduce core module namespace"
```

## Task 3: Split `main.mjs` Into Lifecycle Registrars

**Files:**
- Create: `scripts/lifecycle/init.mjs`
- Create: `scripts/lifecycle/pf1-post-init.mjs`
- Create: `scripts/lifecycle/actor-data.mjs`
- Create: `scripts/lifecycle/setup.mjs`
- Create: `scripts/lifecycle/actor-create.mjs`
- Create: `scripts/lifecycle/ready.mjs`
- Create: `scripts/lifecycle/rest.mjs`
- Modify: `scripts/main.mjs`

- [ ] **Step 1: Create lifecycle directory**

```bash
mkdir -p scripts/lifecycle
```

- [ ] **Step 2: Move hook bodies into named functions**

Create one exported function per lifecycle file:

```js
// scripts/lifecycle/init.mjs
export function registerInitHook() {
  Hooks.once("init", () => {
    // Move the current [1] init body here unchanged.
  });
}
```

```js
// scripts/lifecycle/pf1-post-init.mjs
export function registerPf1PostInitHook() {
  Hooks.once("pf1PostInit", () => {
    // Move the current [2] pf1PostInit body here unchanged.
  });
}
```

```js
// scripts/lifecycle/actor-data.mjs
export function registerActorDataHooks() {
  Hooks.on("pf1PrepareBaseActorData", (actor) => {
    prepareBaseActorData(actor);
    ensureActorSkillEntries(actor);
  });

  Hooks.on("pf1GetChangeFlat", (result, target) => {
    const entry = BUFF_TARGETS[target];
    if (entry) result.push(entry.path);
  });

  Hooks.on("pf1PrepareDerivedActorData", (actor) => {
    prepareDerivedActorData(actor);
  });
}
```

```js
// scripts/lifecycle/setup.mjs
export function registerSetupHook() {
  Hooks.once("setup", () => {
    // Move the current [7] setup registration body here unchanged.
  });

  Hooks.once("setup", () => {
    game.modules.get(MODULE_ID).api = buildPublicApi();
  });
}
```

```js
// scripts/lifecycle/actor-create.mjs
export function registerActorCreateHook() {
  Hooks.on("preCreateActor", (doc, data) => {
    // Move the current [8] body here unchanged.
  });
}
```

```js
// scripts/lifecycle/ready.mjs
export function registerReadyHook() {
  Hooks.once("ready", async () => {
    await runMaintenanceMigrations();
  });
}
```

```js
// scripts/lifecycle/rest.mjs
export function registerRestHook() {
  Hooks.on("pf1ActorRest", (actor, options) => {
    onActorRest(actor, options);
  });
}
```

- [ ] **Step 3: Replace `main.mjs` with orchestration only**

`scripts/main.mjs` should import lifecycle registrars and call them in the documented order:

```js
import { registerInitHook } from "./lifecycle/init.mjs";
import { registerPf1PostInitHook } from "./lifecycle/pf1-post-init.mjs";
import { registerActorDataHooks } from "./lifecycle/actor-data.mjs";
import { registerSetupHook } from "./lifecycle/setup.mjs";
import { registerActorCreateHook } from "./lifecycle/actor-create.mjs";
import { registerReadyHook } from "./lifecycle/ready.mjs";
import { registerRestHook } from "./lifecycle/rest.mjs";
import { registerDamageTypes } from "./data/damage-types.mjs";

registerInitHook();
registerPf1PostInitHook();
registerActorDataHooks();
Hooks.once("pf1RegisterDamageTypes", registerDamageTypes);
registerSetupHook();
registerActorCreateHook();
registerReadyHook();
registerRestHook();
```

- [ ] **Step 4: Keep private helpers near their lifecycle**

Move `_registerScriptCallCategories()` and `_registerBuffTargets()` into `scripts/lifecycle/pf1-post-init.mjs` as non-exported helper functions.

- [ ] **Step 5: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Manual Foundry check:

```text
Reload world with F5.
Confirm console has no failed module import.
Open one character actor.
Confirm Chakra tab renders.
Confirm Summary tab Hero Statistics renders.
```

- [ ] **Step 6: Commit**

```bash
git add scripts
git commit -m "refactor(scripts): split main hook lifecycle"
```

## Task 4: Move Technique Domain Behind Feature Namespace

**Files:**
- Create directory: `scripts/features/techniques/`
- Move: top-level technique workflow files
- Move: technique-specific `data/`, `ui/`, and `automation/` files
- Modify: imports across `scripts/`
- Keep temporary shims at old paths

- [ ] **Step 1: Move files with git**

```bash
mkdir -p scripts/features/techniques
git mv scripts/use-technique.mjs scripts/features/techniques/use.mjs
git mv scripts/learn-technique.mjs scripts/features/techniques/learn.mjs
git mv scripts/master-technique.mjs scripts/features/techniques/master.mjs
git mv scripts/technique-queries.mjs scripts/features/techniques/queries.mjs
git mv scripts/data/action-ids.mjs scripts/features/techniques/action-ids.mjs
git mv scripts/data/technique-defaults.mjs scripts/features/techniques/defaults.mjs
git mv scripts/data/technique-model.mjs scripts/features/techniques/model.mjs
git mv scripts/data/technique-rolldata.mjs scripts/features/techniques/rolldata.mjs
git mv scripts/data/technique-save-dc.mjs scripts/features/techniques/save-dc.mjs
git mv scripts/ui/technique-browser.mjs scripts/features/techniques/browser.mjs
git mv scripts/ui/technique-header.mjs scripts/features/techniques/header.mjs
git mv scripts/ui/technique-list.mjs scripts/features/techniques/list.mjs
git mv scripts/ui/technique-sheet.mjs scripts/features/techniques/sheet.mjs
git mv scripts/ui/technique-synckit-app.mjs scripts/features/techniques/sync-app.mjs
git mv scripts/ui/technique-weapon-attack.mjs scripts/features/techniques/weapon-attack.mjs
git mv scripts/automation/technique-sync.mjs scripts/features/techniques/sync.mjs
```

- [ ] **Step 2: Add old-path shims**

For each moved top-level file, create a shim:

```js
export * from "./features/techniques/use.mjs";
```

For each moved `data/`, `ui/`, or `automation/` file, create a shim with the correct relative path. Example:

```js
// scripts/data/technique-model.mjs
export * from "../features/techniques/model.mjs";
```

```js
// scripts/ui/technique-sheet.mjs
export * from "../features/techniques/sheet.mjs";
```

```js
// scripts/automation/technique-sync.mjs
export * from "../features/techniques/sync.mjs";
```

- [ ] **Step 3: Update lifecycle imports to new paths**

Update lifecycle modules and `scripts/core/public-api.mjs` to import from `scripts/features/techniques/*` directly.

Example:

```js
import { createTechniqueDataModel } from "../features/techniques/model.mjs";
import { createTechniqueItemSheet } from "../features/techniques/sheet.mjs";
import { registerTechniqueListListeners } from "../features/techniques/list.mjs";
```

- [ ] **Step 4: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Manual Foundry check:

```text
Open a technique item sheet.
Use one learned technique from the actor Chakra tab.
Open Technique Browser.
Run Synckit for one actor.
Confirm no console import errors.
```

- [ ] **Step 5: Commit**

```bash
git add scripts
git commit -m "refactor(techniques): group technique modules"
```

## Task 5: Move Chakra and Actor Stats Domains

**Files:**
- Create: `scripts/features/chakra/`
- Create: `scripts/features/actor-stats/`
- Move: chakra spend/damage/conditions/rest/tap-reserves/bonus files
- Move: actor derived data, skills, summary stats
- Modify: imports across `scripts/`
- Keep temporary shims at old paths

- [ ] **Step 1: Move chakra files**

```bash
mkdir -p scripts/features/chakra scripts/features/actor-stats
git mv scripts/data/chakra-spend.mjs scripts/features/chakra/spend.mjs
git mv scripts/data/chakra-damage.mjs scripts/features/chakra/damage.mjs
git mv scripts/data/chakra-conditions.mjs scripts/features/chakra/conditions.mjs
git mv scripts/data/rest-recovery.mjs scripts/features/chakra/rest-recovery.mjs
git mv scripts/ui/tap-reserves.mjs scripts/features/chakra/tap-reserves.mjs
git mv scripts/data/bonus-sources.mjs scripts/features/chakra/bonus-sources.mjs
```

- [ ] **Step 2: Move actor stats files**

```bash
git mv scripts/data/derived-data.mjs scripts/features/actor-stats/derived-data.mjs
git mv scripts/data/skills.mjs scripts/features/actor-stats/skills.mjs
git mv scripts/ui/summary-stats.mjs scripts/features/actor-stats/summary-stats.mjs
```

- [ ] **Step 3: Add shims**

Create shims at the old paths. Example:

```js
// scripts/data/chakra-spend.mjs
export * from "../features/chakra/spend.mjs";
```

```js
// scripts/ui/summary-stats.mjs
export * from "../features/actor-stats/summary-stats.mjs";
```

- [ ] **Step 4: Update lifecycle and technique imports**

Update files already moved into `scripts/lifecycle/` and `scripts/features/techniques/` to import the new chakra and actor-stats paths directly.

Example:

```js
import { DISCIPLINE_SKILL_MAP } from "../actor-stats/skills.mjs";
import { canPayChakra, payChakra } from "../chakra/spend.mjs";
```

Use `../../` where importing from lifecycle modules.

- [ ] **Step 5: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Manual Foundry check:

```text
Open actor sheet.
Roll one learn check.
Use Tap Reserves.
Rest actor and confirm chakra recovery.
Confirm Low Reserves / Chakra Depletion condition behavior still updates.
```

- [ ] **Step 6: Commit**

```bash
git add scripts
git commit -m "refactor(chakra): group chakra and actor stat modules"
```

## Task 6: Move Automation Subdomains

**Files:**
- Create: `scripts/features/automation/buffs/`
- Create: `scripts/features/automation/combat/`
- Create: `scripts/features/automation/maintenance/`
- Create: `scripts/features/automation/occupations/`
- Create: `scripts/features/automation/ranks/`
- Create: `scripts/features/automation/training/`
- Move: current `scripts/automation/*.mjs` files into matching subdomains
- Modify: lifecycle imports
- Keep temporary shims at old paths

- [ ] **Step 1: Move files**

```bash
mkdir -p scripts/features/automation/buffs scripts/features/automation/combat scripts/features/automation/maintenance scripts/features/automation/occupations scripts/features/automation/ranks scripts/features/automation/training
git mv scripts/automation/buff-application.mjs scripts/features/automation/buffs/application.mjs
git mv scripts/automation/condition-benefits.mjs scripts/features/automation/buffs/condition-benefits.mjs
git mv scripts/automation/attack-no-maneuver.mjs scripts/features/automation/combat/attack-no-maneuver.mjs
git mv scripts/automation/charge-defense.mjs scripts/features/automation/combat/charge-defense.mjs
git mv scripts/automation/speed-rank-attack.mjs scripts/features/automation/combat/speed-rank-attack.mjs
git mv scripts/automation/strength-rank-combat.mjs scripts/features/automation/combat/strength-rank-combat.mjs
git mv scripts/automation/maintenance-buffs.mjs scripts/features/automation/maintenance/buffs.mjs
git mv scripts/automation/maintenance-element-damage.mjs scripts/features/automation/maintenance/element-damage.mjs
git mv scripts/automation/turn-maintenance.mjs scripts/features/automation/maintenance/turn-maintenance.mjs
git mv scripts/automation/occupation-grants.mjs scripts/features/automation/occupations/grants.mjs
git mv scripts/automation/rank-buffs.mjs scripts/features/automation/ranks/buffs.mjs
git mv scripts/automation/rank-effective-level.mjs scripts/features/automation/ranks/effective-level.mjs
git mv scripts/automation/rank-roll-injection.mjs scripts/features/automation/ranks/roll-injection.mjs
git mv scripts/automation/rank-rolldata.mjs scripts/features/automation/ranks/rolldata.mjs
git mv scripts/automation/training-weight-carry.mjs scripts/features/automation/training/weight-carry.mjs
```

- [ ] **Step 2: Add shims**

Create shims at each old `scripts/automation/*.mjs` path. Example:

```js
// scripts/automation/buff-application.mjs
export * from "../features/automation/buffs/application.mjs";
```

- [ ] **Step 3: Update lifecycle imports**

Update `scripts/lifecycle/setup.mjs`, `scripts/lifecycle/ready.mjs`, and moved feature modules to import the new automation paths directly.

- [ ] **Step 4: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Manual Foundry check:

```text
Use a technique that applies an automatic buff.
Start a combat turn with a maintained technique active.
Perform a charge attack and confirm AC penalty buff behavior.
Drop/delete an occupation and confirm grants apply/revert.
```

- [ ] **Step 5: Commit**

```bash
git add scripts
git commit -m "refactor(automation): group automation subdomains"
```

## Task 7: Move Chat Helpers and Remaining UI

**Files:**
- Create: `scripts/features/chat/`
- Move: `scripts/chat-rerolls.mjs`
- Move: `scripts/chat-visibility.mjs`
- Evaluate: remaining `scripts/ui/*.mjs`

- [ ] **Step 1: Move chat helpers**

```bash
mkdir -p scripts/features/chat
git mv scripts/chat-rerolls.mjs scripts/features/chat/rerolls.mjs
git mv scripts/chat-visibility.mjs scripts/features/chat/visibility.mjs
```

- [ ] **Step 2: Add shims**

```js
// scripts/chat-rerolls.mjs
export * from "./features/chat/rerolls.mjs";
```

```js
// scripts/chat-visibility.mjs
export * from "./features/chat/visibility.mjs";
```

- [ ] **Step 3: Leave generic UI helpers in `scripts/ui/`**

Keep these files under `scripts/ui/` because they are cross-feature:

```text
scripts/ui/browser-shared.mjs
scripts/ui/render-patch.mjs
```

Move feature-specific UI files only if they still remain after Tasks 4 and 5.

- [ ] **Step 4: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Manual Foundry check:

```text
Roll a learn check.
Use AP/reroll context menu from a Naruto d20 chat card.
Confirm roll visibility still follows the selected roll mode.
```

- [ ] **Step 5: Commit**

```bash
git add scripts
git commit -m "refactor(chat): group chat helpers"
```

## Task 8: Remove Compatibility Shims

**Files:**
- Delete: old top-level, `scripts/data/`, `scripts/ui/`, and `scripts/automation/` shims that only re-export moved modules
- Modify: all imports still using old paths
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md` if present in the repository root

- [ ] **Step 1: Find old-path imports**

Run:

```bash
rg 'from "\\.\\.?/(data|ui|automation)/|from "\\./(learn-technique|master-technique|use-technique|technique-queries|chat-rerolls|chat-visibility|constants|flag-paths|public-api)\\.mjs"' scripts
```

Expected before editing: only shim files or a small list of remaining old imports.

- [ ] **Step 2: Update remaining imports**

Replace old paths with the new feature paths. Example replacements:

```js
import { performTechnique } from "../features/techniques/use.mjs";
import { MODULE_ID } from "../core/constants.mjs";
import { actionPointsPath } from "../core/flag-paths.mjs";
```

- [ ] **Step 3: Delete shim files**

Delete only files whose entire content is a re-export shim. Do not delete files that still contain runtime code.

- [ ] **Step 4: Update repository docs**

Update the `scripts/` tree in `CLAUDE.md` to match the final layout. If `AGENTS.md` exists in the repository root, update its Project Structure section with the same high-level organization:

```text
Runtime code lives in `scripts/`. `scripts/main.mjs` is the Foundry entrypoint; lifecycle hook registration lives in `scripts/lifecycle/`; shared constants, flags, settings, templates, and public API live in `scripts/core/`; feature-owned code lives under `scripts/features/`; cross-feature UI helpers remain in `scripts/ui/`.
```

- [ ] **Step 5: Validate**

Run:

```bash
npm run validate:imports
npm run validate:compendia
```

Manual Foundry check:

```text
Reload world with F5.
Open actor sheet.
Open technique item sheet.
Use a technique.
Learn or master a technique.
Open Technique Browser and Feat Browser.
Run Tap Reserves.
Start a combat turn with maintenance active.
Confirm browser console has no module import failures.
```

- [ ] **Step 6: Commit**

```bash
git add scripts CLAUDE.md package.json
if test -f AGENTS.md; then git add AGENTS.md; fi
git commit -m "refactor(scripts): remove legacy module shims"
```

## Task 9: Final Verification and Optional Pack Check

**Files:**
- No source edits unless verification finds a defect

- [ ] **Step 1: Run static validation**

```bash
npm run validate:imports
npm run validate:compendia
```

Expected: both pass.

- [ ] **Step 2: Run pack only if compendium source changed**

If no `packs/_source/**` files changed, skip packing.

If compendium source changed during the refactor, run:

```bash
npm run pack
```

Expected: packed data regenerates without errors.

- [ ] **Step 3: Manual Foundry smoke test**

Use Foundry VTT 13 with PF1e v11.11+:

```text
Reload world with F5.
Open a character actor.
Confirm Chakra tab, Summary tab, and Settings tab patches render.
Open a technique item sheet.
Use one technique successfully.
Use one technique that applies an automatic buff.
Roll one learn check.
Use Tap Reserves.
Start a combat turn with a maintained technique active.
Open Technique Browser.
Open Feat Browser.
Confirm no browser console module import errors.
```

- [ ] **Step 4: Review diff**

```bash
git diff --stat master...HEAD
git diff --name-status master...HEAD
```

Expected: mostly file moves, import path updates, lifecycle extraction, and docs changes.

- [ ] **Step 5: Commit any verification fixes**

If verification required fixes:

```bash
git add scripts CLAUDE.md package.json
git commit -m "fix(scripts): repair reorganized module imports"
```

## Self-Review

- Spec coverage: The plan covers the observed issues: broad `main.mjs`, feature files at top level, layer folders hiding ownership, broad automation grouping, chat helpers at top level, and missing import validation.
- Placeholder scan: No task depends on undefined future work; each task has explicit files, commands, expected checks, and commit boundaries.
- Type/path consistency: New canonical paths use `scripts/core`, `scripts/lifecycle`, and `scripts/features/*`. Temporary shims preserve old imports until Task 8 removes them.
