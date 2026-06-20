# Technique Attack Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic technique metadata for size-based damage increases and critical confirmation bonuses that works for both native technique actions and `weaponAttack`-driven attacks, then migrate TODOME to use it.

**Architecture:** Extend the technique data model with a small `attackAdjustments` block, then apply that block at the two technique attack entry points: direct `item.use()` in `scripts/use-technique.mjs` and delegated attacks in `scripts/ui/technique-weapon-attack.mjs`. Reuse PF1e's native `@size`/`sizeRoll()` and `critConfirmBonus` behavior instead of implementing custom damage progression.

**Tech Stack:** Foundry VTT 13, PF1e v11.11, JavaScript ESM, compendium source JSON

---

### Task 1: Add generic technique attack-adjustment schema

**Files:**
- Modify: `scripts/data/technique-model.mjs`

- [ ] **Step 1: Write the failing test surrogate**

Document the expected persisted fields and defaults to validate manually after implementation:

```js
// Expected technique system shape
system.attackAdjustments.sizeBonus === 0;
system.attackAdjustments.critConfirmBonus === "";
```

- [ ] **Step 2: Verify the feature is missing**

Run: `rg -n "attackAdjustments" scripts/data/technique-model.mjs`
Expected: no matches

- [ ] **Step 3: Write minimal implementation**

Add a new schema block near other Naruto-specific technique fields:

```js
attackAdjustments: new fields.SchemaField(
  {
    sizeBonus: new fields.NumberField({ ...opt, integer: true, initial: 0 }),
    critConfirmBonus: new fields.StringField({ ...opt, blank: true, initial: "" }),
  },
  opt,
),
```

- [ ] **Step 4: Verify the implementation landed**

Run: `rg -n "attackAdjustments|sizeBonus|critConfirmBonus" scripts/data/technique-model.mjs`
Expected: matches for the new schema fields

- [ ] **Step 5: Commit**

```bash
git add scripts/data/technique-model.mjs
git commit -m "feat(techniques): add generic attack adjustment schema"
```

### Task 2: Support attack adjustments for delegated `weaponAttack` techniques

**Files:**
- Modify: `scripts/ui/technique-weapon-attack.mjs`

- [ ] **Step 1: Write the failing test surrogate**

Document the expected runtime behavior for a delegated unarmed/weapon technique:

```js
// Expected on the selected attack action use
// 1. critConfirmBonus is present only during the triggered use
// 2. damage uses @size + technique sizeBonus for this use only
```

- [ ] **Step 2: Verify the current code does not handle generic adjustments**

Run: `rg -n "critConfirmBonus|attackAdjustments|sizeBonus" scripts/ui/technique-weapon-attack.mjs`
Expected: no generic technique adjustment handling

- [ ] **Step 3: Write minimal implementation**

Add helpers in `scripts/ui/technique-weapon-attack.mjs` to:

```js
function getTechniqueAttackAdjustments(technique) {
  const raw = technique.system?.attackAdjustments ?? {};
  return {
    sizeBonus: Number(raw.sizeBonus ?? 0) || 0,
    critConfirmBonus: String(raw.critConfirmBonus ?? "").trim(),
  };
}

function applyTechniqueAttackAdjustments(actionUse, technique, cleanup) {
  const { sizeBonus, critConfirmBonus } = getTechniqueAttackAdjustments(technique);
  if (!sizeBonus && !critConfirmBonus) return;

  if (critConfirmBonus) {
    const action = actionUse.shared.action;
    const previous = action.critConfirmBonus;
    action.critConfirmBonus = previous
      ? `${previous} + ${critConfirmBonus}`
      : critConfirmBonus;
    cleanup.push(() => {
      if (previous) action.critConfirmBonus = previous;
      else delete action.critConfirmBonus;
    });
  }

  if (sizeBonus) {
    const rollData = actionUse.shared.rollData;
    const previousSize = rollData.item?.size;
    const previousActorSize = rollData.size;
    rollData.size = (rollData.size ?? 0) + sizeBonus;
    if (rollData.item) rollData.item.size = (rollData.item.size ?? 0) + sizeBonus;
    cleanup.push(() => {
      rollData.size = previousActorSize;
      if (rollData.item) rollData.item.size = previousSize;
    });
  }
}
```

Call it inside the existing `pf1CreateActionUse` hook, alongside the current attack and damage bonus decorations.

- [ ] **Step 4: Verify the implementation landed**

Run: `rg -n "getTechniqueAttackAdjustments|applyTechniqueAttackAdjustments|critConfirmBonus|sizeBonus" scripts/ui/technique-weapon-attack.mjs`
Expected: new helper definitions and call site

- [ ] **Step 5: Commit**

```bash
git add scripts/ui/technique-weapon-attack.mjs
git commit -m "feat(weapon-attack): apply generic technique attack adjustments"
```

### Task 3: Support attack adjustments for native technique actions

**Files:**
- Modify: `scripts/use-technique.mjs`

- [ ] **Step 1: Write the failing test surrogate**

Document the expected runtime behavior for a normal technique action:

```js
// Expected on direct technique item.use()
// 1. action.critConfirmBonus is set only for the current use
// 2. rollData.size and rollData.item.size are increased only for the current use
```

- [ ] **Step 2: Verify the current code does not decorate direct technique actions**

Run: `rg -n "pf1CreateActionUse|critConfirmBonus|sizeBonus|attackAdjustments" scripts/use-technique.mjs`
Expected: no direct action-adjustment hook

- [ ] **Step 3: Write minimal implementation**

In `scripts/use-technique.mjs`, add small helpers:

```js
function getTechniqueAttackAdjustments(item) {
  const raw = item.system?.attackAdjustments ?? {};
  return {
    sizeBonus: Number(raw.sizeBonus ?? 0) || 0,
    critConfirmBonus: String(raw.critConfirmBonus ?? "").trim(),
  };
}
```

Wrap the normal `item.use()` branch with a temporary `pf1CreateActionUse` hook scoped to the current actor/item/action:

```js
function hookTechniqueAttackAdjustments(item, actor, action, cleanup) {
  const adjustments = getTechniqueAttackAdjustments(item);
  if (!adjustments.sizeBonus && !adjustments.critConfirmBonus) return null;

  const hook = (actionUse) => {
    if (actionUse.actor?.id !== actor.id) return;
    if (actionUse.item?.id !== item.id) return;
    if (actionUse.action?.id !== action.id) return;

    if (adjustments.critConfirmBonus) {
      const previous = actionUse.shared.action.critConfirmBonus;
      actionUse.shared.action.critConfirmBonus = previous
        ? `${previous} + ${adjustments.critConfirmBonus}`
        : adjustments.critConfirmBonus;
      cleanup.push(() => {
        if (previous) actionUse.shared.action.critConfirmBonus = previous;
        else delete actionUse.shared.action.critConfirmBonus;
      });
    }

    if (adjustments.sizeBonus) {
      const previousSize = actionUse.shared.rollData.size;
      const previousItemSize = actionUse.shared.rollData.item?.size;
      actionUse.shared.rollData.size = (actionUse.shared.rollData.size ?? 0) + adjustments.sizeBonus;
      if (actionUse.shared.rollData.item) {
        actionUse.shared.rollData.item.size =
          (actionUse.shared.rollData.item.size ?? 0) + adjustments.sizeBonus;
      }
      cleanup.push(() => {
        actionUse.shared.rollData.size = previousSize;
        if (actionUse.shared.rollData.item) actionUse.shared.rollData.item.size = previousItemSize;
      });
    }
  };

  Hooks.on("pf1CreateActionUse", hook);
  return hook;
}
```

Use `try/finally` so the hook is always removed after `item.use()`.

- [ ] **Step 4: Verify the implementation landed**

Run: `rg -n "hookTechniqueAttackAdjustments|getTechniqueAttackAdjustments|pf1CreateActionUse" scripts/use-technique.mjs`
Expected: helper definitions and scoped hook usage in the direct `item.use()` path

- [ ] **Step 5: Commit**

```bash
git add scripts/use-technique.mjs
git commit -m "feat(techniques): apply attack adjustments to direct technique actions"
```

### Task 4: Migrate TODOME to structured attack adjustments

**Files:**
- Modify: `packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json`

- [ ] **Step 1: Write the failing test surrogate**

Document the expected TODOME payload:

```json
"attackAdjustments": {
  "sizeBonus": 1,
  "critConfirmBonus": "2[TODOME]"
}
```

- [ ] **Step 2: Verify the current compendium item lacks structured adjustments**

Run: `rg -n "attackAdjustments|critConfirmBonus|sizeBonus" packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json`
Expected: no matches

- [ ] **Step 3: Write minimal implementation**

Insert the new block under `system`:

```json
"attackAdjustments": {
  "sizeBonus": 1,
  "critConfirmBonus": "2[TODOME]"
},
```

- [ ] **Step 4: Verify the implementation landed**

Run: `rg -n "attackAdjustments|critConfirmBonus|sizeBonus" packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json`
Expected: matches for both fields

- [ ] **Step 5: Commit**

```bash
git add packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json
git commit -m "feat(compendium): migrate todome attack adjustments"
```

### Task 5: Validate compendium JSON and inspect diff

**Files:**
- Modify: none
- Test: `packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json`

- [ ] **Step 1: Run compendium validation**

Run: `npm run validate:compendia`
Expected: validation passes with no schema or source JSON errors

- [ ] **Step 2: Review the final diff**

Run: `git diff -- scripts/data/technique-model.mjs scripts/ui/technique-weapon-attack.mjs scripts/use-technique.mjs packs/_source/techniques/TODOME__FINISHING_BLOW__jTiBaHFZyGulpBsA.json docs/superpowers/specs/2026-06-20-technique-attack-adjustments-design.md`
Expected: only the planned schema, runtime, compendium, and spec changes appear

- [ ] **Step 3: Commit remaining verification artifacts if needed**

```bash
git add docs/superpowers/specs/2026-06-20-technique-attack-adjustments-design.md docs/superpowers/plans/2026-06-20-technique-attack-adjustments.md
git commit -m "docs: add technique attack adjustments spec and plan"
```

### Task 6: Manual Foundry verification

**Files:**
- Modify: none

- [ ] **Step 1: Reload the Foundry world**

Run in Foundry: `F5` or in-world `Ctrl+R`
Expected: module reloads without console errors

- [ ] **Step 2: Verify TODOME delegated attack behavior**

Manual test:

```text
1. Open an actor with an unarmed attack eligible for TODOME
2. Use TODOME
3. Roll an attack that threatens a critical
4. Confirm the damage die is one size step larger
5. Confirm the critical confirmation roll shows +2[TODOME]
```

Expected: larger damage and confirmation-only bonus appear on the rolled attack

- [ ] **Step 3: Verify a native technique action using the same fields**

Manual test setup:

```text
1. Add attackAdjustments to a test technique that rolls its own action
2. Use the technique
3. Threaten a critical if possible
4. Confirm size-based damage increase and confirmation-only bonus
```

Expected: same behavior as delegated attacks, with no leakage to later unrelated attacks

- [ ] **Step 4: Verify no-regression behavior**

Manual test:

```text
1. Use a technique with no attackAdjustments
2. Use a normal weapon attack after TODOME
3. Compare rolls to expected baseline
```

Expected: unchanged technique behavior and no lingering attack modifiers
