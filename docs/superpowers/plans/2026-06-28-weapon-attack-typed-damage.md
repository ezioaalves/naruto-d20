# Technique Weapon-Attack Typed Damage Bonuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace technique weapon-attack free-form damage bonus strings with structured typed damage parts so technique bonus damage rolls as separate typed PF1e damage instances.

**Architecture:** Keep the configuration in `system.weaponAttack`. Add pure helpers for normalizing damage part rows, extend the typed schema/default/migration path, then inject those parts into PF1e `action.damage.parts` and `action.damage.nonCritParts` during delegated weapon rolls. The first UI uses repeatable formula + CSV damage-type rows to minimize coupling to PF1e's action-sheet app; this preserves the data model needed for a later visual type selector.

**Tech Stack:** Foundry VTT v13, PF1e v11.11, JavaScript ESM, Handlebars, `node:test`, Foundry CLI compendium packing.

---

## File Map

- **Create** `scripts/features/techniques/weapon-attack-damage-parts.mjs` — pure normalization helpers for `{ formula, types }` rows and legacy formula conversion.
- **Modify** `scripts/features/techniques/model.mjs` — add `damageParts` and `nonCritDamageParts` schema fields; keep legacy string fields only long enough for migration if needed.
- **Modify** `scripts/features/techniques/defaults.mjs` — default the new arrays and migrate old string fields into untyped rows.
- **Modify** `scripts/features/techniques/weapon-attack-migrate.mjs` — convert legacy dictionary and typed legacy strings into structured rows.
- **Modify** `scripts/features/techniques/weapon-attack-sheet.mjs` — expose editable rows, type CSV helpers, and summary behavior.
- **Modify** `scripts/features/techniques/sheet.mjs` — parse submitted damage-part rows, add/remove row controls in the sheet DOM, and update the preset field list.
- **Modify** `scripts/features/techniques/weapon-attack.mjs` — return and inject structured damage parts; stop using `shared.damageBonus` for weapon-attack bonus damage.
- **Modify** `templates/item/technique-sheet.hbs` — replace the two string inputs with repeatable damage-part editors.
- **Modify** `styles/item/technique-sheet.css` — add compact row styling for formula/types/delete controls.
- **Modify** `lang/en.json`, `lang/pt-BR.json` — update labels/hints from string bonus fields to damage-part instance fields.
- **Modify** `tools/migrate-weapon-attack.mjs` — reuse the migration helper for source data containing legacy string fields.
- **Modify** `packs/_source/techniques/*.json`, `packs/techniques/*` — migrate source compendium JSON and repack LevelDB.
- **Modify tests** `tests/weapon-attack-damage-parts.test.mjs`, `tests/weapon-attack-migrate.test.mjs`, `tests/helpers.test.mjs`, `tests/weapon-attack-sheet.test.mjs`, `tests/technique-bonus-suppression.test.mjs`.

## Global Constraints

- Do not target `master` directly. Continue from the current feature/spec branch or create an implementation branch from it.
- Do not hand-edit packed LevelDB files under `packs/techniques`; use `npm run pack`.
- Do not run `npm run unpack`.
- Before changing PF1e-specific runtime assumptions, verify against the installed PF1e v11.11 source mirror under `/home/joelfmjr/.foundrydata/Data/modules/foundryvtt-pathfinder1/`.
- The new helper module must stay dependency-free: no `foundry`, no `pf1`, no `game`.
- Preserve existing legacy formulas exactly. Do not split on `+` and do not infer types from bracket labels.

---

### Task 1: Pure Damage-Part Helpers

**Files:**
- Create: `scripts/features/techniques/weapon-attack-damage-parts.mjs`
- Create: `tests/weapon-attack-damage-parts.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/weapon-attack-damage-parts.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  damagePartRowsFromForm,
  damagePartRowsToForm,
  legacyFormulaToDamageParts,
  normalizeDamagePartRows,
  typeCsvToArray,
  typeArrayToCsv,
} from "../scripts/features/techniques/weapon-attack-damage-parts.mjs";

describe("weapon attack damage part helpers", () => {
  it("normalizes formula and type rows without inferring labels", () => {
    assert.deepEqual(
      normalizeDamagePartRows([
        { formula: " 2[cold] ", types: [" cold ", "", "electricity"] },
        { formula: "", types: ["fire"] },
        { formula: "1d4", types: "acid, sonic" },
      ]),
      [
        { formula: "2[cold]", types: ["cold", "electricity"] },
        { formula: "1d4", types: ["acid", "sonic"] },
      ],
    );
  });

  it("converts legacy formulas into one untyped row", () => {
    assert.deepEqual(legacyFormulaToDamageParts(" 1d4[Iaiken] + @cl[Strength] "), [
      { formula: "1d4[Iaiken] + @cl[Strength]", types: [] },
    ]);
    assert.deepEqual(legacyFormulaToDamageParts(""), []);
  });

  it("round-trips type CSV values", () => {
    assert.deepEqual(typeCsvToArray("cold, electricity; acid"), ["cold", "electricity", "acid"]);
    assert.equal(typeArrayToCsv(["cold", "electricity"]), "cold, electricity");
  });

  it("converts rows to and from form state", () => {
    const formRows = damagePartRowsToForm([{ formula: "2", types: ["cold"] }]);
    assert.deepEqual(formRows, [{ formula: "2", typesText: "cold" }]);
    assert.deepEqual(damagePartRowsFromForm(formRows), [{ formula: "2", types: ["cold"] }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/weapon-attack-damage-parts.test.mjs
```

Expected: FAIL with `Cannot find module ... weapon-attack-damage-parts.mjs`.

- [ ] **Step 3: Implement the helper module**

Create `scripts/features/techniques/weapon-attack-damage-parts.mjs`:

```js
function trimString(value) {
  return String(value ?? "").trim();
}

export function typeCsvToArray(value) {
  if (Array.isArray(value)) return value.map(trimString).filter(Boolean);
  return String(value ?? "")
    .split(/[,;]/)
    .map(trimString)
    .filter(Boolean);
}

export function typeArrayToCsv(types) {
  return typeCsvToArray(types).join(", ");
}

export function normalizeDamagePartRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      formula: trimString(row?.formula),
      types: typeCsvToArray(row?.types),
    }))
    .filter((row) => row.formula);
}

export function legacyFormulaToDamageParts(formula) {
  const text = trimString(formula);
  return text ? [{ formula: text, types: [] }] : [];
}

export function damagePartRowsToForm(rows) {
  return normalizeDamagePartRows(rows).map((row) => ({
    formula: row.formula,
    typesText: typeArrayToCsv(row.types),
  }));
}

export function damagePartRowsFromForm(rows) {
  if (!Array.isArray(rows)) return [];
  return normalizeDamagePartRows(
    rows.map((row) => ({
      formula: row?.formula,
      types: row?.typesText,
    })),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/weapon-attack-damage-parts.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/features/techniques/weapon-attack-damage-parts.mjs tests/weapon-attack-damage-parts.test.mjs
git commit -m "feat(techniques): add weapon attack damage part helpers"
```

---

### Task 2: Schema, Defaults, And Migration

**Files:**
- Modify: `scripts/features/techniques/model.mjs`
- Modify: `scripts/features/techniques/defaults.mjs`
- Modify: `scripts/features/techniques/weapon-attack-migrate.mjs`
- Modify: `tests/weapon-attack-migrate.test.mjs`
- Modify: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing migration tests**

In `tests/weapon-attack-migrate.test.mjs`, update the first expected typed object by replacing:

```js
damageBonus: "",
nonCritDamageBonus: "",
```

with:

```js
damageParts: [],
nonCritDamageParts: [],
```

Then add this test inside `describe("migrateLegacyWeaponAttack", ...)`:

```js
  it("converts legacy damage bonus strings into untyped structured rows", () => {
    const source = {
      flags: {
        dictionary: {
          "weaponAttack.mode": "selected",
          "weaponAttack.damageBonus": "2[Iaiken]",
          "weaponAttack.nonCritDamageBonus": "(min(floor(@cl / 3), 4))d4[Iaiken]",
        },
      },
    };

    migrateLegacyWeaponAttack(source);

    assert.deepEqual(source.weaponAttack.damageParts, [{ formula: "2[Iaiken]", types: [] }]);
    assert.deepEqual(source.weaponAttack.nonCritDamageParts, [
      { formula: "(min(floor(@cl / 3), 4))d4[Iaiken]", types: [] },
    ]);
    assert.equal(source.weaponAttack.damageBonus, undefined);
    assert.equal(source.weaponAttack.nonCritDamageBonus, undefined);
  });

  it("normalizes already-typed damage rows without replacing them", () => {
    const typed = {
      weaponAttack: {
        enabled: true,
        damageBonus: "legacy should be ignored",
        damageParts: [{ formula: " 2 ", types: [" cold "] }],
        nonCritDamageParts: [{ formula: "1d4", types: "electricity" }],
      },
      flags: { dictionary: {} },
    };

    migrateLegacyWeaponAttack(typed);

    assert.deepEqual(typed.weaponAttack.damageParts, [{ formula: "2", types: ["cold"] }]);
    assert.deepEqual(typed.weaponAttack.nonCritDamageParts, [
      { formula: "1d4", types: ["electricity"] },
    ]);
    assert.equal(typed.weaponAttack.damageBonus, undefined);
    assert.equal(typed.weaponAttack.nonCritDamageBonus, undefined);
  });
```

In `tests/helpers.test.mjs`, update the schema/default key expectations for `weaponAttack` by replacing `damageBonus` and `nonCritDamageBonus` with `damageParts` and `nonCritDamageParts`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/weapon-attack-migrate.test.mjs tests/helpers.test.mjs
```

Expected: FAIL because the schema/default/migration still uses legacy string fields.

- [ ] **Step 3: Update schema**

In `scripts/features/techniques/model.mjs`, add a local damage part schema helper inside `defineSchema()` near the other helper declarations:

```js
      const damagePartRow = () =>
        new fields.SchemaField({
          formula: new fields.StringField({ ...opt, blank: true, initial: "" }),
          types: new fields.ArrayField(
            new fields.StringField({ blank: false, required: true }),
            { ...opt, initial: [] },
          ),
        });
```

In the `weaponAttack` schema, replace:

```js
            damageBonus: new fields.StringField({ ...opt, blank: true, initial: "" }),
            nonCritDamageBonus: new fields.StringField({ ...opt, blank: true, initial: "" }),
```

with:

```js
            damageParts: new fields.ArrayField(damagePartRow(), { ...opt, initial: [] }),
            nonCritDamageParts: new fields.ArrayField(damagePartRow(), { ...opt, initial: [] }),
```

- [ ] **Step 4: Update defaults**

In `scripts/features/techniques/defaults.mjs`, import the helpers:

```js
import {
  legacyFormulaToDamageParts,
  normalizeDamagePartRows,
} from "./weapon-attack-damage-parts.mjs";
```

Replace the legacy defaults:

```js
  wa.damageBonus ??= "";
  wa.nonCritDamageBonus ??= "";
```

with:

```js
  wa.damageParts = normalizeDamagePartRows(
    wa.damageParts?.length ? wa.damageParts : legacyFormulaToDamageParts(wa.damageBonus),
  );
  wa.nonCritDamageParts = normalizeDamagePartRows(
    wa.nonCritDamageParts?.length
      ? wa.nonCritDamageParts
      : legacyFormulaToDamageParts(wa.nonCritDamageBonus),
  );
  delete wa.damageBonus;
  delete wa.nonCritDamageBonus;
```

- [ ] **Step 5: Update migration helper**

In `scripts/features/techniques/weapon-attack-migrate.mjs`, import the helpers:

```js
import {
  legacyFormulaToDamageParts,
  normalizeDamagePartRows,
} from "./weapon-attack-damage-parts.mjs";
```

Inside the `source.weaponAttack = { ... }` assignment, replace:

```js
      damageBonus: str("damageBonus"),
      nonCritDamageBonus: str("nonCritDamageBonus"),
```

with:

```js
      damageParts: legacyFormulaToDamageParts(values.damageBonus),
      nonCritDamageParts: legacyFormulaToDamageParts(values.nonCritDamageBonus),
```

After the `if (!alreadyTyped) { ... }` block and before deleting dictionary keys, add:

```js
  const wa = source.weaponAttack;
  if (wa && typeof wa === "object") {
    wa.damageParts = normalizeDamagePartRows(
      wa.damageParts?.length ? wa.damageParts : legacyFormulaToDamageParts(wa.damageBonus),
    );
    wa.nonCritDamageParts = normalizeDamagePartRows(
      wa.nonCritDamageParts?.length
        ? wa.nonCritDamageParts
        : legacyFormulaToDamageParts(wa.nonCritDamageBonus),
    );
    delete wa.damageBonus;
    delete wa.nonCritDamageBonus;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test tests/weapon-attack-damage-parts.test.mjs tests/weapon-attack-migrate.test.mjs tests/helpers.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/features/techniques/model.mjs scripts/features/techniques/defaults.mjs scripts/features/techniques/weapon-attack-migrate.mjs tests/weapon-attack-migrate.test.mjs tests/helpers.test.mjs
git commit -m "feat(techniques): add typed weapon attack damage fields"
```

---

### Task 3: Runtime Config And Damage Injection

**Files:**
- Modify: `scripts/features/techniques/weapon-attack.mjs`
- Modify: `tests/helpers.test.mjs`
- Modify: `tests/technique-bonus-suppression.test.mjs`

- [ ] **Step 1: Write failing config and injection tests**

In `tests/helpers.test.mjs`, update the `getTechniqueWeaponAttackConfig` expected result. In the source `weaponAttack`, add:

```js
          damageParts: [{ formula: "2", types: ["cold"] }],
          nonCritDamageParts: [{ formula: "1d4", types: ["electricity"] }],
```

In the expected config, replace:

```js
      damageBonus: "",
      nonCritDamageBonus: "",
```

with:

```js
      damageParts: [{ formula: "2", types: ["cold"] }],
      nonCritDamageParts: [{ formula: "1d4", types: ["electricity"] }],
```

In `tests/technique-bonus-suppression.test.mjs`, update the import:

```js
import {
  applyTechniqueElementDamageToActionUse,
  applyTechniqueBonusSuppressions,
  applyTechniqueWeaponAttackDamageParts,
} from "../scripts/features/techniques/weapon-attack.mjs";
```

Add this `describe` block before `describe("delegated technique element damage", ...)`:

```js
describe("technique weapon attack typed damage parts", () => {
  it("appends typed normal and non-critical parts and restores them", () => {
    const action = {
      damage: {
        parts: [{ formula: "1d6", types: ["bludgeoning"] }],
        nonCritParts: [],
      },
    };
    const actionUse = { shared: { action, rollData: { action }, damageBonus: [] } };
    const cleanup = [];

    applyTechniqueWeaponAttackDamageParts(
      actionUse,
      {
        damageParts: [{ formula: "2", types: ["cold"] }],
        nonCritDamageParts: [{ formula: "1d4", types: ["electricity"] }],
      },
      cleanup,
    );

    assert.deepEqual(action.damage.parts, [
      { formula: "1d6", types: ["bludgeoning"] },
      { formula: "2", types: ["cold"] },
    ]);
    assert.deepEqual(action.damage.nonCritParts, [{ formula: "1d4", types: ["electricity"] }]);
    assert.deepEqual(actionUse.shared.damageBonus, []);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.damage.parts, [{ formula: "1d6", types: ["bludgeoning"] }]);
    assert.deepEqual(action.damage.nonCritParts, []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/helpers.test.mjs tests/technique-bonus-suppression.test.mjs
```

Expected: FAIL because `damageParts` are not returned and `applyTechniqueWeaponAttackDamageParts` does not exist.

- [ ] **Step 3: Update runtime config**

In `scripts/features/techniques/weapon-attack.mjs`, import:

```js
import { normalizeDamagePartRows } from "./weapon-attack-damage-parts.mjs";
```

In `getTechniqueWeaponAttackConfig(item)`, replace:

```js
    damageBonus: String(wa.damageBonus ?? ""),
    nonCritDamageBonus: String(wa.nonCritDamageBonus ?? ""),
```

with:

```js
    damageParts: normalizeDamagePartRows(wa.damageParts),
    nonCritDamageParts: normalizeDamagePartRows(wa.nonCritDamageParts),
```

- [ ] **Step 4: Add injection helper**

Add this exported function near `applyTechniqueBonusSuppressions`:

```js
export function applyTechniqueWeaponAttackDamageParts(actionUse, config, cleanup = []) {
  const action = actionUse?.shared?.action;
  if (!action) return;

  action.damage ??= {};
  const normalParts = (action.damage.parts ??= []);
  const nonCritParts = (action.damage.nonCritParts ??= []);
  const normalOriginalLength = normalParts.length;
  const nonCritOriginalLength = nonCritParts.length;

  const damageParts = normalizeDamagePartRows(config?.damageParts);
  const nonCritDamageParts = normalizeDamagePartRows(config?.nonCritDamageParts);
  if (!damageParts.length && !nonCritDamageParts.length) return;

  normalParts.push(...damageParts);
  nonCritParts.push(...nonCritDamageParts);
  cleanup.push(() => {
    normalParts.splice(normalOriginalLength);
    nonCritParts.splice(nonCritOriginalLength);
  });
}
```

Then in `rollSelectedWeaponAttackWithTechnique`, replace:

```js
    if (config.damageBonus) actionUse.shared.damageBonus.push(config.damageBonus);
    if (config.nonCritDamageBonus) {
      const nonCritParts = (actionUse.shared.action.damage.nonCritParts ??= []);
      const originalLength = nonCritParts.length;
      nonCritParts.push({ formula: config.nonCritDamageBonus, types: [] });
      cleanup.push(() => nonCritParts.splice(originalLength, 1));
    }
```

with:

```js
    applyTechniqueWeaponAttackDamageParts(actionUse, config, cleanup);
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
node --test tests/helpers.test.mjs tests/technique-bonus-suppression.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/features/techniques/weapon-attack.mjs tests/helpers.test.mjs tests/technique-bonus-suppression.test.mjs
git commit -m "feat(techniques): inject typed weapon attack damage parts"
```

---

### Task 4: Sheet Form State And Save Normalization

**Files:**
- Modify: `scripts/features/techniques/weapon-attack-sheet.mjs`
- Modify: `scripts/features/techniques/sheet.mjs`
- Modify: `tests/weapon-attack-sheet.test.mjs`

- [ ] **Step 1: Write failing sheet helper tests**

In `tests/weapon-attack-sheet.test.mjs`, update the import:

```js
import {
  applyWeaponAttackPreset,
  buildWeaponAttackFormData,
  buildWeaponAttackSummary,
  damagePartRowsFromForm,
  damagePartRowsToForm,
  extraAttacksArrayFromText,
  extraAttacksTextFromArray,
  normalizeExtraAttacksText,
} from "../scripts/features/techniques/weapon-attack-sheet.mjs";
```

In the first `reads an enabled typed config into editable form state` test, add to the source `weaponAttack`:

```js
        damageParts: [{ formula: "2", types: ["cold"] }],
        nonCritDamageParts: [{ formula: "1d4", types: ["electricity"] }],
```

And add assertions:

```js
    assert.deepEqual(data.damageParts, [{ formula: "2", typesText: "cold" }]);
    assert.deepEqual(data.nonCritDamageParts, [{ formula: "1d4", typesText: "electricity" }]);
```

Add a new test:

```js
describe("weapon attack damage part form rows", () => {
  it("round-trips formula and damage type CSV rows", () => {
    const rows = damagePartRowsFromForm([
      { formula: " 2 ", typesText: "cold, electricity" },
      { formula: "", typesText: "fire" },
    ]);
    assert.deepEqual(rows, [{ formula: "2", types: ["cold", "electricity"] }]);
    assert.deepEqual(damagePartRowsToForm(rows), [
      { formula: "2", typesText: "cold, electricity" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/weapon-attack-sheet.test.mjs
```

Expected: FAIL because the functions and form fields are not exposed yet.

- [ ] **Step 3: Update sheet helper exports**

In `scripts/features/techniques/weapon-attack-sheet.mjs`, import and re-export the damage part helper functions:

```js
import {
  damagePartRowsFromForm,
  damagePartRowsToForm,
} from "./weapon-attack-damage-parts.mjs";

export { damagePartRowsFromForm, damagePartRowsToForm };
```

In `DEFAULT_FORM_DATA`, replace:

```js
  damageBonus: "",
  nonCritDamageBonus: "",
```

with:

```js
  damageParts: [],
  nonCritDamageParts: [],
```

In `buildWeaponAttackFormData(item)`, replace:

```js
    damageBonus: String(wa.damageBonus ?? ""),
    nonCritDamageBonus: String(wa.nonCritDamageBonus ?? ""),
```

with:

```js
    damageParts: damagePartRowsToForm(wa.damageParts),
    nonCritDamageParts: damagePartRowsToForm(wa.nonCritDamageParts),
```

- [ ] **Step 4: Update submit normalization**

In `scripts/features/techniques/sheet.mjs`, import the form helper:

```js
  damagePartRowsFromForm,
```

from `./weapon-attack-sheet.mjs`.

Inside `_updateObject`, after the `weaponAttack-extraAttacksText` block, add:

```js
      formData["system.weaponAttack.damageParts"] = damagePartRowsFromForm(
        extractIndexedRows(formData, "system.weaponAttack.damageParts"),
      );
      formData["system.weaponAttack.nonCritDamageParts"] = damagePartRowsFromForm(
        extractIndexedRows(formData, "system.weaponAttack.nonCritDamageParts"),
      );
```

Add this helper function outside `createTechniqueSheetClass`:

```js
function extractIndexedRows(formData, prefix) {
  const rows = [];
  const match = new RegExp(`^${prefix.replaceAll(".", "\\.")}\\.(\\d+)\\.(formula|typesText)$`);
  for (const key of Object.keys(formData)) {
    const found = key.match(match);
    if (!found) continue;
    const index = Number(found[1]);
    const field = found[2];
    rows[index] ??= {};
    rows[index][field] = formData[key];
    delete formData[key];
  }
  return rows.filter(Boolean);
}
```

In `_onWeaponAttackPreset`, remove the legacy fields from `fields`:

```js
        "system.weaponAttack.damageBonus",
        "system.weaponAttack.nonCritDamageBonus",
```

Remove these properties from `current`:

```js
        damageBonus: get("system.weaponAttack.damageBonus").value,
        nonCritDamageBonus: get("system.weaponAttack.nonCritDamageBonus").value,
```

Remove these assignments:

```js
      get("system.weaponAttack.damageBonus").value = next.damageBonus ?? "";
      get("system.weaponAttack.nonCritDamageBonus").value = next.nonCritDamageBonus ?? "";
```

- [ ] **Step 5: Add sheet add/remove row handlers**

In `scripts/features/techniques/sheet.mjs`, inside `activateListeners(html)`, add these bindings near the existing weapon-attack preset binding:

```js
      html.on("click", ".weapon-attack-damage-add", this._onWeaponAttackDamageAdd.bind(this));
      html.on("click", ".weapon-attack-damage-delete", this._onWeaponAttackDamageDelete.bind(this));
```

Add these methods inside the sheet class near `_onWeaponAttackPreset`:

```js
    _onWeaponAttackDamageAdd(event) {
      event.preventDefault();
      const button = event.currentTarget;
      const list = button.closest("[data-weapon-attack-damage-list]");
      const prefix = list?.dataset.weaponAttackDamageList;
      const rows = list?.querySelector(".weapon-attack-damage-rows");
      if (!prefix || !rows) return;

      const index = rows.querySelectorAll(".weapon-attack-damage-row").length;
      const row = document.createElement("div");
      row.className = "weapon-attack-damage-row";
      row.innerHTML = `
        <input type="text" name="${prefix}.${index}.formula" value="" placeholder="${game.i18n.localize("NarutoD20.WeaponAttack.DamageParts.FormulaPlaceholder")}">
        <input type="text" name="${prefix}.${index}.typesText" value="" placeholder="${game.i18n.localize("NarutoD20.WeaponAttack.DamageParts.TypesPlaceholder")}">
        <button type="button" class="weapon-attack-damage-delete" data-tooltip="${game.i18n.localize("PF1.DeleteItem")}">
          <i class="fa-solid fa-trash" inert></i>
        </button>
      `;
      rows.append(row);
    }

    _onWeaponAttackDamageDelete(event) {
      event.preventDefault();
      event.currentTarget.closest(".weapon-attack-damage-row")?.remove();
    }
```

The submit-time `extractIndexedRows()` helper from Step 4 must tolerate gaps after deletion because it already filters sparse rows with `rows.filter(Boolean)`.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test tests/weapon-attack-sheet.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/features/techniques/weapon-attack-sheet.mjs scripts/features/techniques/sheet.mjs tests/weapon-attack-sheet.test.mjs
git commit -m "feat(technique-sheet): normalize typed weapon attack damage rows"
```

---

### Task 5: Sheet UI And Localization

**Files:**
- Modify: `templates/item/technique-sheet.hbs`
- Modify: `styles/item/technique-sheet.css`
- Modify: `lang/en.json`
- Modify: `lang/pt-BR.json`

- [ ] **Step 1: Replace damage string inputs in the template**

In `templates/item/technique-sheet.hbs`, inside the `WeaponAttack.Modifiers.Header` section, keep the attack bonus input and replace the damage/non-critical string inputs with:

```hbs
            <div class="weapon-attack-damage-parts" data-weapon-attack-damage-list="system.weaponAttack.damageParts">
              <h5>{{localize "NarutoD20.WeaponAttack.DamageParts.Label"}}</h5>
              <div class="weapon-attack-damage-rows">
              {{#each weaponAttack.damageParts as |part i|}}
              <div class="weapon-attack-damage-row">
                <input type="text"
                       name="system.weaponAttack.damageParts.{{i}}.formula"
                       value="{{part.formula}}"
                       placeholder="{{localize 'NarutoD20.WeaponAttack.DamageParts.FormulaPlaceholder'}}">
                <input type="text"
                       name="system.weaponAttack.damageParts.{{i}}.typesText"
                       value="{{part.typesText}}"
                       placeholder="{{localize 'NarutoD20.WeaponAttack.DamageParts.TypesPlaceholder'}}">
                <button type="button" class="weapon-attack-damage-delete" data-tooltip="{{localize 'PF1.DeleteItem'}}">
                  <i class="fa-solid fa-trash" inert></i>
                </button>
              </div>
              {{/each}}
              </div>
              <button type="button" class="weapon-attack-damage-add">
                <i class="fa-solid fa-plus" inert></i>
                {{localize "NarutoD20.WeaponAttack.DamageParts.Add"}}
              </button>
              <p class="hint">{{localize "NarutoD20.WeaponAttack.DamageParts.Hint"}}</p>
            </div>

            <div class="weapon-attack-damage-parts" data-weapon-attack-damage-list="system.weaponAttack.nonCritDamageParts">
              <h5>{{localize "NarutoD20.WeaponAttack.NonCritDamageParts.Label"}}</h5>
              <div class="weapon-attack-damage-rows">
              {{#each weaponAttack.nonCritDamageParts as |part i|}}
              <div class="weapon-attack-damage-row">
                <input type="text"
                       name="system.weaponAttack.nonCritDamageParts.{{i}}.formula"
                       value="{{part.formula}}"
                       placeholder="{{localize 'NarutoD20.WeaponAttack.DamageParts.FormulaPlaceholder'}}">
                <input type="text"
                       name="system.weaponAttack.nonCritDamageParts.{{i}}.typesText"
                       value="{{part.typesText}}"
                       placeholder="{{localize 'NarutoD20.WeaponAttack.DamageParts.TypesPlaceholder'}}">
                <button type="button" class="weapon-attack-damage-delete" data-tooltip="{{localize 'PF1.DeleteItem'}}">
                  <i class="fa-solid fa-trash" inert></i>
                </button>
              </div>
              {{/each}}
              </div>
              <button type="button" class="weapon-attack-damage-add">
                <i class="fa-solid fa-plus" inert></i>
                {{localize "NarutoD20.WeaponAttack.DamageParts.Add"}}
              </button>
              <p class="hint">{{localize "NarutoD20.WeaponAttack.NonCritDamageParts.Hint"}}</p>
            </div>
```

- [ ] **Step 2: Add CSS**

In `styles/item/technique-sheet.css`, add:

```css
.naruto-d20.sheet.item.technique .weapon-attack-damage-parts {
  margin-top: 0.5rem;
}

.naruto-d20.sheet.item.technique .weapon-attack-damage-parts h5 {
  margin: 0 0 0.25rem;
  font-size: var(--font-size-13);
}

.naruto-d20.sheet.item.technique .weapon-attack-damage-row {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) minmax(6rem, 0.8fr) auto;
  gap: 0.25rem;
  align-items: center;
  margin-bottom: 0.25rem;
}

.naruto-d20.sheet.item.technique .weapon-attack-damage-row input {
  width: 100%;
}

.naruto-d20.sheet.item.technique .weapon-attack-damage-add,
.naruto-d20.sheet.item.technique .weapon-attack-damage-delete {
  line-height: 1;
}
```

- [ ] **Step 3: Update localization**

In `lang/en.json`, replace or add under `NarutoD20.WeaponAttack`:

```json
"DamageParts": {
  "Label": "Damage bonus instances",
  "Add": "Add damage instance",
  "FormulaPlaceholder": "Formula",
  "TypesPlaceholder": "Types, e.g. cold, electricity",
  "Hint": "Each non-empty row becomes a separate typed damage instance."
},
"NonCritDamageParts": {
  "Label": "Non-multiplying damage bonus instances",
  "Hint": "These rows roll only on non-critical damage and do not multiply on critical hits."
}
```

In `lang/pt-BR.json`, add:

```json
"DamageParts": {
  "Label": "Instancias de bonus de dano",
  "Add": "Adicionar instancia de dano",
  "FormulaPlaceholder": "Formula",
  "TypesPlaceholder": "Tipos, ex.: cold, electricity",
  "Hint": "Cada linha nao vazia vira uma instancia de dano tipada separada."
},
"NonCritDamageParts": {
  "Label": "Instancias de bonus de dano nao-multiplicavel",
  "Hint": "Estas linhas rolam apenas em dano nao critico e nao multiplicam em acertos criticos."
}
```

Remove the old localized labels only if no code still references:

```json
"DamageBonus"
"NonCritDamageBonus"
```

- [ ] **Step 4: Run lint and template smoke checks**

Run:

```bash
npm run lint:format
node --test tests/weapon-attack-sheet.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/item/technique-sheet.hbs styles/item/technique-sheet.css lang/en.json lang/pt-BR.json
git commit -m "feat(technique-sheet): render typed weapon attack damage rows"
```

---

### Task 6: Compendium Source Migration And Pack

**Files:**
- Modify: `tools/migrate-weapon-attack.mjs`
- Modify: `packs/_source/techniques/*.json`
- Modify: `packs/techniques/*`

- [ ] **Step 1: Update the migration tool to also catch typed legacy strings**

In `tools/migrate-weapon-attack.mjs`, change the guard:

```js
  if (!doc.system || !hasLegacyWeaponAttack(doc.system)) continue;
```

to:

```js
  const wa = doc.system?.weaponAttack;
  const hasLegacyStrings = Boolean(wa?.damageBonus || wa?.nonCritDamageBonus);
  if (!doc.system || (!hasLegacyWeaponAttack(doc.system) && !hasLegacyStrings)) continue;
```

Keep:

```js
  migrateLegacyWeaponAttack(doc.system);
```

because Task 2 made it normalize both dictionary legacy data and typed legacy strings.

- [ ] **Step 2: Run source migration**

Run:

```bash
node tools/migrate-weapon-attack.mjs
```

Expected: console output like `migrated N technique source files`, where `N` is greater than zero if source JSON still contains legacy string fields.

- [ ] **Step 3: Validate source JSON no longer has legacy weaponAttack damage strings**

Run:

```bash
rg -n '"damageBonus"|"nonCritDamageBonus"' packs/_source/techniques -g '*.json'
```

Expected: no matches for `system.weaponAttack.damageBonus` or `system.weaponAttack.nonCritDamageBonus`. Matches under unrelated `automation.empower.mode: "damageBonus"` are acceptable and must not be changed.

- [ ] **Step 4: Validate compendia**

Run:

```bash
npm run validate:compendia
```

Expected: PASS.

- [ ] **Step 5: Repack techniques**

Run:

```bash
npm run pack
```

Expected: PASS and `packs/techniques/*` changes.

- [ ] **Step 6: Commit**

```bash
git add tools/migrate-weapon-attack.mjs packs/_source/techniques packs/techniques
git commit -m "chore(techniques): migrate weapon attack damage bonuses to typed rows"
```

---

### Task 7: Full Verification And Manual QA Notes

**Files:**
- No planned source edits unless verification finds a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test tests/weapon-attack-damage-parts.test.mjs tests/weapon-attack-migrate.test.mjs tests/weapon-attack-sheet.test.mjs tests/technique-bonus-suppression.test.mjs tests/helpers.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run compendium validation**

Run:

```bash
npm run validate:compendia
```

Expected: PASS.

- [ ] **Step 5: Manual Foundry verification**

In Foundry VTT 13 with PF1e v11.11+:

1. Reload the world.
2. Open an actor with a weapon or unarmed attack.
3. Open a technique with weapon-attack automation enabled.
4. Add a damage bonus row `2` with type `cold`.
5. Add a non-multiplying damage row `1d4` with type `electricity`.
6. Roll the technique through the selected weapon attack.
7. Confirm the chat card shows separate `Cold` and `Electricity` damage instances, not one aggregated untyped damage line.
8. Confirm old migrated techniques with bracket labels still roll their old formulas as untyped until edited.

- [ ] **Step 6: Final status**

If all verification passes, report:

```text
Implemented typed weapon-attack damage rows. Verified with focused node tests, full npm test, lint, compendium validation, pack, and manual Foundry roll check.
```

If manual Foundry cannot be run in the current environment, report:

```text
Automated verification passed. Manual Foundry VTT verification remains required: configure typed weapon-attack damage rows and confirm separate typed chat-card damage instances.
```
