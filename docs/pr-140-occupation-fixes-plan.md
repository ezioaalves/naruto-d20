# PR 140 Occupation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os bloqueios encontrados na revisão do PR 140 antes de mergear o sistema de Occupations.

**Architecture:** Occupations continuam sendo itens PF1e `feat`/`trait`, mas a automação do módulo passa a ser dona explícita dos grants criados. O fluxo deixa de depender de `system.links.supplements` pós-criação para criar ou remover itens concedidos, porque PF1e v11.11 só materializa supplements durante a criação inicial do item.

**Tech Stack:** Foundry VTT 13, PF1e v11.11, JavaScript ESM, `node:test`, Foundry CLI para packs, JSON source compendia.

---

## Current Findings

- `module.json` está inválido: falta vírgula entre `"occupations-community"` e `"equipments"` em `packFolders.packs`.
- Técnicas escolhidas por occupation não são criadas no ator: `techDoc` é apenas inserido em `system.links.supplements` após o item já ter sido criado.
- Dropar a mesma occupation mais de uma vez acumula `wealth`/`reputation`.
- Cancelar o diálogo deixa o item de occupation recém-criado no ator.
- `validate:compendia` não valida os novos packs `occupations` e `occupations-community`.
- Algumas `featOptions` são texto instrucional ou parametrizado, não nomes concretos de feats grantáveis.
- Os testes novos passam isoladamente, mas não cobrem documento Foundry real, cancelamento, duplicate drop, técnica criada ou validação dos novos packs.

## Target Behavior

- O manifesto deve ser JSON válido e carregar no Foundry.
- Uma occupation aplicada deve marcar class skills no próprio item de occupation, somar bônus de hero stats uma única vez e criar explicitamente os itens grantáveis resolvidos.
- Feats e técnicas criados pela occupation devem receber `flags.naruto-d20.occupationGrant`.
- Ao remover a occupation, o módulo deve reverter `wealth`/`reputation` e deletar apenas itens criados por aquela occupation.
- Itens que o ator já possuía antes da occupation não devem ser duplicados nem deletados no revert.
- Cancelar o diálogo deve remover o item recém-dropado e não alterar o ator.
- Uma occupation com o mesmo `slug` já aplicada no ator não deve ser reaplicada.
- Opções manuais ou parametrizadas devem ser exibidas como instrução, não como radio button de auto-grant.

## Task 1: Manifest Validity

**Files:**
- Modify: `module.json`

- [ ] **Step 1: Add regression check**

Run:

```bash
npm run validate:manifest
```

Expected before fix:

```text
✗ module.json is not valid JSON
```

- [ ] **Step 2: Fix `packFolders.packs` JSON**

Change:

```json
"occupations-community"
"equipments"
```

To:

```json
"occupations-community",
"equipments"
```

- [ ] **Step 3: Verify manifest**

Run:

```bash
npm run validate:manifest
```

Expected:

```text
✓ module.json is valid
```

If the validator prints a different success message, the command must still exit with code `0`.

## Task 2: Occupation Grant Ownership

**Files:**
- Modify: `scripts/automation/occupation-grants.mjs`
- Modify: `tests/occupation-grants.test.mjs`
- Optionally modify: `scripts/data/item-grants.mjs`

- [ ] **Step 1: Add tests for explicit item creation and revert**

Add tests that cover these cases in `tests/occupation-grants.test.mjs`:

```js
test("buildOccupationItemUpdate records created grant ids without relying on supplements", () => {
  const update = buildOccupationItemUpdate(
    { id: "occ1" },
    { slug: "uchiha-clan", wealthBonus: 1, reputationBonus: 1, fixedClassSkills: [] },
    { classSkillKeys: ["nin"], featName: "Genin", techniqueName: "Goukakyuu no Jutsu" },
    {
      createdGrantIds: ["feat1", "tech1"],
      skippedExistingGrantNames: [],
      featDoc: { uuid: "Compendium.naruto-d20.feats.Item.genin" },
      techDoc: { uuid: "Compendium.naruto-d20.techniques.Item.fireball" },
    },
  );

  assert.deepEqual(update["system.classSkills"], { nin: true });
  assert.deepEqual(update["system.links.supplements"], []);
  assert.deepEqual(update["flags.naruto-d20.occupationGrant"].createdGrantIds, ["feat1", "tech1"]);
  assert.equal(update["flags.naruto-d20.occupationGrant"].selectedTechniqueName, "Goukakyuu no Jutsu");
});

test("buildGrantDeletionIds deletes only grants owned by the removed occupation item", () => {
  const actor = {
    items: [
      { id: "feat1", flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "occ1" } } } },
      { id: "tech1", flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "occ1" } } } },
      { id: "existing", flags: { "naruto-d20": { occupationGrant: { sourceOccupationItemId: "other" } } } },
    ],
  };

  assert.deepEqual(buildGrantDeletionIds(actor, { sourceOccupationItemId: "occ1" }), ["feat1", "tech1"]);
});
```

- [ ] **Step 2: Update exported helpers**

Implement or update these helpers in `scripts/automation/occupation-grants.mjs`:

```js
export function buildGrantDeletionIds(actor, grant) {
  const sourceId = grant?.sourceOccupationItemId;
  if (!sourceId) return [];

  return Array.from(actor.items ?? [])
    .filter((item) => item.flags?.[MODULE_ID]?.[OCCUPATION_GRANT_FLAG]?.sourceOccupationItemId === sourceId)
    .map((item) => item.id)
    .filter(Boolean);
}

function findExistingOwnedItemByName(actor, name) {
  const target = normalizeItemName(name);
  if (!target) return null;

  return Array.from(actor.items ?? []).find((item) => normalizeItemName(item.name) === target) ?? null;
}
```

- [ ] **Step 3: Refactor item creation**

Replace the feat-only creation flow with a shared grant creation helper:

```js
async function createGrantItem(actor, doc, occupation, occupationItem, kind, grantName) {
  if (!doc) return { createdId: null, skippedExistingName: null };

  const existing = findExistingOwnedItemByName(actor, doc.name);
  if (existing) return { createdId: null, skippedExistingName: doc.name };

  const itemData = buildEmbeddedGrantData(
    doc,
    `flags.${MODULE_ID}.${OCCUPATION_GRANT_FLAG}`,
    {
      sourceOccupationSlug: occupation.slug,
      sourceOccupationItemId: occupationItem.id,
      grantKind: kind,
      grantName,
    },
  );
  foundry.utils.setProperty(itemData, "flags.pf1.source", doc.uuid);

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData], {
    _pf1NoSupplements: true,
  });
  return { createdId: created?.id ?? null, skippedExistingName: null };
}
```

- [ ] **Step 4: Stop relying on `system.links.supplements`**

Change `buildOccupationItemUpdate` so it accepts a grant result object and always writes:

```js
"system.links.supplements": []
```

The occupation flag must store:

```js
createdGrantIds,
skippedExistingGrantNames,
selectedFeatUuid,
selectedTechniqueUuid
```

- [ ] **Step 5: Refactor apply order**

In `applyOccupationFromItem`:

1. Resolve selections.
2. Resolve `featDoc` and `techDoc`.
3. Create feat grant if resolved and not already owned.
4. Create technique grant if resolved and not already owned.
5. Update the occupation item with class skills and `occupationGrant`.
6. Update actor hero stats.
7. Show info notification.

This ensures created item IDs are known before writing the final `occupationGrant` flag.

- [ ] **Step 6: Refactor revert**

In `revertOccupationFromItem`:

```js
const toDelete = buildGrantDeletionIds(actor, grant);
if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete, { render: false });
if (Object.keys(updates).length) await actor.update(updates);
```

Do not delete by `flags.pf1.source` or by matching names.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/occupation-grants.test.mjs tests/item-grants.test.mjs
```

Expected: all tests pass.

## Task 3: Cancel and Duplicate Drop Behavior

**Files:**
- Modify: `scripts/automation/occupation-grants.mjs`
- Modify: `tests/occupation-grants.test.mjs`
- Modify: `lang/en.json`
- Modify: `lang/pt-BR.json`

- [ ] **Step 1: Add tests for duplicate detection**

Add pure helper tests:

```js
test("findAppliedOccupationBySlug finds an existing applied occupation item", () => {
  const actor = {
    items: [
      {
        id: "occ1",
        flags: {
          "naruto-d20": {
            occupationGrant: { applied: true, sourceOccupationSlug: "academy-student" },
          },
        },
      },
    ],
  };

  assert.equal(findAppliedOccupationBySlug(actor, "academy-student")?.id, "occ1");
  assert.equal(findAppliedOccupationBySlug(actor, "uchiha-clan"), null);
});
```

- [ ] **Step 2: Add helper**

Export:

```js
export function findAppliedOccupationBySlug(actor, slug) {
  if (!slug) return null;

  return (
    Array.from(actor.items ?? []).find((item) => {
      const grant = item.flags?.[MODULE_ID]?.[OCCUPATION_GRANT_FLAG];
      return grant?.applied === true && grant.sourceOccupationSlug === slug;
    }) ?? null
  );
}
```

- [ ] **Step 3: Reject duplicate drops**

At the start of `applyOccupationFromItem`, after the self-applied guard:

```js
const existingOccupation = findAppliedOccupationBySlug(actor, occupation.slug);
if (existingOccupation && existingOccupation.id !== occupationItem.id) {
  await occupationItem.delete();
  ui.notifications?.warn(
    game.i18n.format("NarutoD20.Occupation.AlreadyApplied", {
      name: occupationItem.name,
    }),
  );
  return;
}
```

- [ ] **Step 4: Delete item on cancel**

Change the cancel branch:

```js
if (!selections) {
  await occupationItem.delete();
  ui.notifications?.warn(
    game.i18n.format("NarutoD20.Occupation.Cancelled", { name: occupationItem.name }),
  );
  return;
}
```

- [ ] **Step 5: Add localization**

Add:

```json
"AlreadyApplied": "{name}: this occupation is already applied."
```

In `pt-BR`:

```json
"AlreadyApplied": "{name}: esta ocupação já está aplicada."
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/occupation-grants.test.mjs
```

Expected: all tests pass.

## Task 4: Manual Feat Options and Dialog

**Files:**
- Modify: `scripts/ui/occupation-selector.mjs`
- Modify: `scripts/automation/occupation-grants.mjs`
- Modify: `tools/occupation-transform.mjs`
- Modify: `tests/occupation-selector.test.mjs`
- Modify: `tests/occupation-transform.test.mjs`
- Modify: `lang/en.json`
- Modify: `lang/pt-BR.json`
- Modify: `packs/_source/occupations/*.json`
- Modify: `packs/_source/occupations-community/*.json`

- [ ] **Step 1: Define data behavior**

Use this convention:

```json
"featOptions": ["Concrete Feat Name"],
"manualFeatOptions": ["[Universal / Finesse Category]"]
```

`featOptions` are auto-grant choices. `manualFeatOptions` are displayed as instructions and never auto-created.

- [ ] **Step 2: Update transform logic**

In `tools/occupation-transform.mjs`, split generated feat strings:

```js
function isManualFeatOption(name) {
  const value = String(name ?? "").trim();
  return value.startsWith("[") || value.includes(")") && value.includes("(") && value.includes(",");
}

function splitFeatOptions(options) {
  const featOptions = [];
  const manualFeatOptions = [];
  for (const option of options ?? []) {
    if (isManualFeatOption(option)) manualFeatOptions.push(option);
    else featOptions.push(option);
  }
  return { featOptions, manualFeatOptions };
}
```

When transforming occupation flags, write both arrays.

- [ ] **Step 3: Update selection rendering**

In `renderOccupationSelectionContent`, accept `manualFeatOptions`.

Render manual options as non-input list content:

```html
<section class="nd20-occ-section">
  <h3>Manual Feat Choices</h3>
  <p class="nd20-occ-hint">Choose one manually on the actor sheet:</p>
  <ul class="nd20-occ-manual-list">...</ul>
</section>
```

Escape every manual string with `escapeHtml`.

- [ ] **Step 4: Update prompt/apply logic**

Pass `manualFeatOptions` from `resolveOccupationSelections` into `promptOccupationSelections`.

The callback must only return `featName` from checked `featOption` radios. It must not return a manual option as `featName`.

- [ ] **Step 5: Add localization keys**

English:

```json
"ManualFeatChoices": "Manual Feat Choices",
"ManualFeatHint": "Choose one of these manually on the actor sheet; it is not auto-granted."
```

Portuguese:

```json
"ManualFeatChoices": "Escolhas Manuais de Talento",
"ManualFeatHint": "Escolha uma destas manualmente na ficha do personagem; ela não é concedida automaticamente."
```

- [ ] **Step 6: Regenerate or patch occupation JSON**

If using the importer, run only after confirming it does not overwrite unrelated intended data:

```bash
node tools/import-occupations.mjs
```

Otherwise patch source JSON directly:

- Move strings starting with `[` from `featOptions` to `manualFeatOptions`.
- Move parametrized multi-choice strings like `Dodge (Dodge, Spring Attack)` to `manualFeatOptions` unless there is an exact concrete feat intended.
- Normalize obvious aliases that refer to an existing concrete feat, for example `Archaic Weapon Proficiency` to `Archaic Weapons Proficiency`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/occupation-selector.test.mjs tests/occupation-transform.test.mjs
```

Expected: all tests pass.

## Task 5: Compendium Validation Coverage

**Files:**
- Modify: `tools/validate-compendia.mjs`
- Modify: `tests/helpers.test.mjs`

- [ ] **Step 1: Add packs**

In `PACKS`, add:

```js
{ name: "occupations", dir: "occupations", type: "feat" },
{ name: "occupations-community", dir: "occupations-community", type: "feat" },
```

- [ ] **Step 2: Add occupation validation**

Implement:

```js
function validateOccupation(ctx) {
  const occ = ctx.doc.flags?.["naruto-d20"]?.occupation;
  if (!occ || typeof occ !== "object") {
    error(ctx.packName, ctx.filename, "missing flags.naruto-d20.occupation");
    return;
  }

  if (ctx.doc.type !== "feat") error(ctx.packName, ctx.filename, "occupation must be a feat item");
  if (ctx.doc.system?.subType !== "trait") {
    error(ctx.packName, ctx.filename, "occupation system.subType must be trait");
  }
  if (!String(occ.slug ?? "").trim()) error(ctx.packName, ctx.filename, "occupation.slug is required");
  if (!Array.isArray(occ.fixedClassSkills)) {
    error(ctx.packName, ctx.filename, "occupation.fixedClassSkills must be an array");
  }
  if (!Array.isArray(occ.classSkillOptions)) {
    error(ctx.packName, ctx.filename, "occupation.classSkillOptions must be an array");
  }
  if (!Array.isArray(occ.featOptions)) {
    error(ctx.packName, ctx.filename, "occupation.featOptions must be an array");
  }
  if (occ.manualFeatOptions !== undefined && !Array.isArray(occ.manualFeatOptions)) {
    error(ctx.packName, ctx.filename, "occupation.manualFeatOptions must be an array when present");
  }
  if (!Array.isArray(occ.techniqueOptions)) {
    error(ctx.packName, ctx.filename, "occupation.techniqueOptions must be an array");
  }
}
```

Call it for both occupation packs.

- [ ] **Step 3: Validate grantable references**

Build normalized source-name sets for `feats` and `techniques` and check:

- Every `featOptions` value resolves to a concrete feat.
- Every `techniqueOptions` value resolves by exact or existing fuzzy rule used by runtime lookup.
- Every `manualFeatOptions` value is not required to resolve.

Use the same normalization semantics as `normalizeItemName`: strip accents, lowercase, remove punctuation, collapse whitespace.

- [ ] **Step 4: Add tests**

Extend source validation tests so a minimal valid source tree includes occupation packs and invalid occupation references fail with explicit messages:

```text
occupation feat option not found: Missing Feat
occupation technique option not found: Missing Technique
```

- [ ] **Step 5: Run validation**

Run:

```bash
npm run validate:compendia
```

Expected output must include:

```text
occupations:
occupations-community:
Errors: 0
```

## Task 6: Documentation and Manual QA

**Files:**
- Modify: `docs/manual-qa.md`
- Optionally modify: PR description before merge

- [ ] **Step 1: Update cancel QA**

The cancel step must say:

```text
Expected: closing or cancelling the occupation dialog removes the newly dropped occupation item and makes no actor stat, class skill, feat, or technique changes.
```

- [ ] **Step 2: Update grant/revert QA**

The apply/revert steps must say:

```text
Expected: granted feats/techniques created by the occupation have flags.naruto-d20.occupationGrant and are removed when the occupation is deleted. Pre-existing items with the same name are not deleted.
```

- [ ] **Step 3: Update duplicate QA**

Add:

```text
Drag the same occupation a second time.
Expected: the new dropped item is removed, a warning appears, and wealth/reputation do not change.
```

## Final Verification

- [ ] Run:

```bash
npm run validate:manifest
npm run validate:compendia
node --test tests/item-grants.test.mjs tests/occupation-grants.test.mjs tests/occupation-selector.test.mjs tests/occupation-transform.test.mjs
npm test
```

- [ ] If `npm test` still fails in existing source validation tests, compare the failures against `origin/master`. Fix them if introduced by this PR; otherwise document them as pre-existing.

- [ ] Run pack commands after source JSON changes:

```bash
npm run pack:occupations
npm run pack:occupations-community
```

- [ ] Review `git diff` to confirm packed LevelDB changes correspond only to occupation pack updates.

- [ ] Manual Foundry check in VTT 13 + PF1e v11.11:

```text
1. Manifest loads and both occupation compendia appear.
2. Academy Student apply/cancel/duplicate/revert behaves as expected.
3. Uchiha Clan creates the selected technique.
4. Sunagakure Puppeteer creates the selected technique.
5. Deleting an occupation removes only grants created by that occupation.
```

## Commit Plan

- [ ] Commit 1: `fix(occupations): repair manifest and grant lifecycle`
- [ ] Commit 2: `fix(occupations): separate manual feat choices`
- [ ] Commit 3: `test(occupations): validate occupation compendia`
- [ ] Commit 4: `docs(occupations): update manual QA`
