# Technique Bonus Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic `weaponAttack` metadata that lets techniques suppress selected native PF1e attack bonuses, then configure AMATSU NO KARADA to suppress natural-attack bonuses and Strength-to-damage.

**Architecture:** Extend the existing `scripts/features/techniques/weapon-attack.mjs` parser and delegated-roll hook. Suppression mutates only the selected action and `rollData.action` inside `pf1CreateActionUse`, using the existing cleanup stack to restore state after the roll.

**Tech Stack:** Foundry VTT module JavaScript ESM, PF1e v11.11 `ActionUse`, node:test, source JSON compendia.

---

### Task 1: Parser And Suppression Helper

**Files:**
- Modify: `scripts/features/techniques/weapon-attack.mjs`
- Modify: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing parser and helper tests**

Add imports in `tests/helpers.test.mjs`:

```js
import {
  applyTechniqueBonusSuppressions,
  parseWeaponAttackConfig,
  readWeaponAttackRaw,
} from "../scripts/features/techniques/weapon-attack.mjs";
```

Add tests under the existing `describe("weaponAttack parsing", ...)` block:

```js
it("parses known suppressed bonus tokens", () => {
  const { config, warnings } = parseWeaponAttackConfig({
    malformed: false,
    keys: new Set(["mode", "suppressedBonuses"]),
    values: {
      mode: "selected",
      suppressedBonuses: "naturalAttack, abilityDamage",
    },
  });

  assert.deepEqual(config.suppressedBonuses, ["naturalAttack", "abilityDamage"]);
  assert.deepEqual(warnings, []);
});

it("warns about unknown suppressed bonus tokens while keeping known tokens", () => {
  const { config, warnings } = parseWeaponAttackConfig({
    malformed: false,
    keys: new Set(["mode", "suppressedBonuses"]),
    values: {
      mode: "selected",
      suppressedBonuses: "naturalAttack, bogus",
    },
  });

  assert.deepEqual(config.suppressedBonuses, ["naturalAttack"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /weaponAttack\.suppressedBonuses/);
  assert.match(warnings[0], /bogus/);
});
```

Add tests under a new `describe("technique bonus suppression", ...)` block:

```js
describe("technique bonus suppression", () => {
  it("suppresses and restores ability damage without touching shared damage bonuses", () => {
    const actionUse = {
      shared: {
        action: { ability: { damage: "str", damageMult: 1 } },
        rollData: { action: { ability: { damage: "str", damageMult: 1 } } },
        damageBonus: ["2[General Damage]"],
      },
    };
    const cleanup = [];

    applyTechniqueBonusSuppressions(actionUse, ["abilityDamage"], cleanup);

    assert.equal(actionUse.shared.action.ability.damage, "");
    assert.equal(actionUse.shared.rollData.action.ability.damage, "");
    assert.deepEqual(actionUse.shared.damageBonus, ["2[General Damage]"]);

    for (const restore of cleanup.reverse()) restore();

    assert.equal(actionUse.shared.action.ability.damage, "str");
    assert.equal(actionUse.shared.rollData.action.ability.damage, "str");
  });

  it("suppresses and restores natural attack bonuses without touching shared attack bonuses", () => {
    const actionUse = {
      shared: {
        action: {
          attackBonus: "3[Natural Attack]",
          naturalAttack: { secondary: { attackBonus: "-5", damageMult: 0.5 } },
        },
        rollData: {
          action: {
            attackBonus: "3[Natural Attack]",
            naturalAttack: { secondary: { attackBonus: "-5", damageMult: 0.5 } },
          },
        },
        attackBonus: ["2[Flanking]", "2[Charge]"],
      },
    };
    const cleanup = [];

    applyTechniqueBonusSuppressions(actionUse, ["naturalAttack"], cleanup);

    assert.equal(actionUse.shared.action.attackBonus, "");
    assert.equal(actionUse.shared.rollData.action.attackBonus, "");
    assert.equal(actionUse.shared.action.naturalAttack.secondary.attackBonus, "0");
    assert.equal(actionUse.shared.rollData.action.naturalAttack.secondary.attackBonus, "0");
    assert.deepEqual(actionUse.shared.attackBonus, ["2[Flanking]", "2[Charge]"]);

    for (const restore of cleanup.reverse()) restore();

    assert.equal(actionUse.shared.action.attackBonus, "3[Natural Attack]");
    assert.equal(actionUse.shared.rollData.action.attackBonus, "3[Natural Attack]");
    assert.equal(actionUse.shared.action.naturalAttack.secondary.attackBonus, "-5");
    assert.equal(actionUse.shared.rollData.action.naturalAttack.secondary.attackBonus, "-5");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/helpers.test.mjs`
Expected: FAIL because `applyTechniqueBonusSuppressions` is not exported and `suppressedBonuses` is not parsed.

- [ ] **Step 3: Implement parser and helper**

In `scripts/features/techniques/weapon-attack.mjs`:

- Add `suppressedBonuses` to `KNOWN_KEYS`.
- Add a supported token set and warning template.
- Parse `suppressedBonuses` into `config.suppressedBonuses`.
- Export `applyTechniqueBonusSuppressions(actionUse, suppressions, cleanup)`.
- Call the helper inside the delegated-roll hook before technique bonuses are added.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/helpers.test.mjs`
Expected: PASS.

### Task 2: Amatsu Source Data

**Files:**
- Modify: `packs/_source/techniques/AMATSU_NO_KARADA__HEAVENLY_BODY__Eg83TQOvnreI9eeo.json`
- Test: `tests/helpers.test.mjs`

- [ ] **Step 1: Write failing source-data test**

Add to the existing source JSON validation area or a nearby `describe` block:

```js
describe("Amatsu no Karada source data", () => {
  it("delegates to unarmed attacks and suppresses natural attack and ability damage bonuses", () => {
    const amatsu = JSON.parse(
      readFileSync(
        "packs/_source/techniques/AMATSU_NO_KARADA__HEAVENLY_BODY__Eg83TQOvnreI9eeo.json",
        "utf8",
      ),
    );
    const dict = amatsu.system.flags.dictionary;
    const action = amatsu.system.actions[0];

    assert.equal(dict["weaponAttack.mode"], "selected");
    assert.equal(dict["weaponAttack.filter"], "unarmedOnly");
    assert.equal(dict["weaponAttack.damageMode"], "replace");
    assert.equal(dict["weaponAttack.suppressedBonuses"], "naturalAttack,abilityDamage");
    assert.equal(action.ability.attack, "dex");
    assert.equal(action.ability.damage, "");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/helpers.test.mjs`
Expected: FAIL because Amatsu lacks the `weaponAttack` dictionary values and still has `ability.damage = "str"`.

- [ ] **Step 3: Update Amatsu JSON**

Set:

```json
"ability": {
  "attack": "dex",
  "damage": "",
  "critRange": 20,
  "critMult": 2
}
```

Set:

```json
"flags": {
  "boolean": {},
  "dictionary": {
    "weaponAttack.mode": "selected",
    "weaponAttack.filter": "unarmedOnly",
    "weaponAttack.damageMode": "replace",
    "weaponAttack.suppressedBonuses": "naturalAttack,abilityDamage"
  }
}
```

- [ ] **Step 4: Run source-data test to verify pass**

Run: `node --test tests/helpers.test.mjs`
Expected: PASS.

### Task 3: Validation

**Files:**
- Validate changed code and compendium source.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/helpers.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run full node test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Validate compendia**

Run: `npm run validate:compendia`
Expected: PASS.
