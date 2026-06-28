# Weapon Attack Add Damage Type Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make untyped additive technique damage inherit the selected weapon action's first normal damage type.

**Architecture:** Keep the behavior in the existing runtime injection point, `applyTechniqueWeaponAttackDamageParts()`. Derive fallback types from the selected action before appending technique rows, clone appended rows, and only fill empty `types` arrays when `config.damageMode === "add"`.

**Tech Stack:** Foundry VTT module ESM, PF1e action data shape, `node:test`.

---

## File Structure

- **Modify** `tests/technique-bonus-suppression.test.mjs` — add a focused regression test for untyped additive damage inheriting the selected weapon's damage type.
- **Modify** `scripts/features/techniques/weapon-attack.mjs` — add fallback type derivation and type filling in `applyTechniqueWeaponAttackDamageParts()`.

## Task 1: Regression Test

**Files:**
- Modify: `tests/technique-bonus-suppression.test.mjs`

- [ ] **Step 1: Write the failing test**

Add a test to `describe("technique weapon attack typed damage parts", ...)`:

```js
  it("inherits the selected weapon damage type for untyped additive parts", () => {
    const action = {
      damage: {
        parts: [{ formula: "1d8", types: ["slashing"] }],
        nonCritParts: [],
      },
    };
    const actionUse = { shared: { action, rollData: { action }, damageBonus: [] } };
    const cleanup = [];

    applyTechniqueWeaponAttackDamageParts(
      actionUse,
      {
        damageMode: "add",
        damageParts: [{ formula: "2d6", types: [] }],
        nonCritDamageParts: [{ formula: "1", types: [] }],
      },
      cleanup,
    );

    assert.deepEqual(action.damage.parts, [
      { formula: "1d8", types: ["slashing"] },
      { formula: "2d6", types: ["slashing"] },
    ]);
    assert.deepEqual(action.damage.nonCritParts, [{ formula: "1", types: ["slashing"] }]);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.damage.parts, [{ formula: "1d8", types: ["slashing"] }]);
    assert.deepEqual(action.damage.nonCritParts, []);
  });
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test tests/technique-bonus-suppression.test.mjs --test-name-pattern="inherits the selected weapon damage type"`

Expected: FAIL because appended rows still have `types: []`.

## Task 2: Runtime Implementation

**Files:**
- Modify: `scripts/features/techniques/weapon-attack.mjs`

- [ ] **Step 1: Add fallback helpers**

Add helper functions near `applyTechniqueWeaponAttackDamageParts()`:

```js
function getPrimaryWeaponDamageTypes(action) {
  const firstTypes = action?.damage?.parts?.[0]?.types;
  return Array.isArray(firstTypes) ? firstTypes.filter(Boolean) : [];
}

function inheritUntypedDamagePartTypes(rows, fallbackTypes, { enabled }) {
  if (!enabled || !fallbackTypes.length) return rows.map((row) => ({ ...row }));
  return rows.map((row) => ({
    ...row,
    types: row.types?.length ? [...row.types] : [...fallbackTypes],
  }));
}
```

- [ ] **Step 2: Apply helpers before appending**

Change `applyTechniqueWeaponAttackDamageParts()` so normalized rows are wrapped:

```js
  const fallbackTypes = getPrimaryWeaponDamageTypes(action);
  const inheritTypes = config?.damageMode === "add";
  const damageParts = inheritUntypedDamagePartTypes(
    normalizeDamagePartRows(config?.damageParts),
    fallbackTypes,
    { enabled: inheritTypes },
  );
  const nonCritDamageParts = inheritUntypedDamagePartTypes(
    normalizeDamagePartRows(config?.nonCritDamageParts),
    fallbackTypes,
    { enabled: inheritTypes },
  );
```

- [ ] **Step 3: Verify the focused test passes**

Run: `node --test tests/technique-bonus-suppression.test.mjs --test-name-pattern="inherits the selected weapon damage type"`

Expected: PASS.

- [ ] **Step 4: Verify related tests**

Run: `npm test -- --test-name-pattern="weapon attack|technique weapon attack typed damage parts|delegated technique element damage"`

Expected: PASS.

- [ ] **Step 5: Verify compendium data remains valid**

Run: `npm run validate:compendia`

Expected: exits 0.
