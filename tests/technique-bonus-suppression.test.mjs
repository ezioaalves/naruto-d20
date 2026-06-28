import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyTechniqueElementDamageToActionUse,
  applyTechniqueBonusSuppressions,
  applyTechniqueWeaponAttackDamageParts,
} from "../scripts/features/techniques/weapon-attack.mjs";
import { migrateLegacyWeaponAttack } from "../scripts/features/techniques/weapon-attack-migrate.mjs";

describe("weaponAttack suppressed bonuses migration", () => {
  it("splits the legacy csv into the two boolean fields", () => {
    const source = {
      flags: { dictionary: { "weaponAttack.mode": "selected", "weaponAttack.suppressedBonuses": "naturalAttack, abilityDamage" } },
    };
    migrateLegacyWeaponAttack(source);
    assert.equal(source.weaponAttack.suppressNaturalAttack, true);
    assert.equal(source.weaponAttack.suppressAbilityDamage, true);
  });
  it("ignores unknown suppression tokens", () => {
    const source = {
      flags: { dictionary: { "weaponAttack.mode": "selected", "weaponAttack.suppressedBonuses": "naturalAttack, bogus" } },
    };
    migrateLegacyWeaponAttack(source);
    assert.equal(source.weaponAttack.suppressNaturalAttack, true);
    assert.equal(source.weaponAttack.suppressAbilityDamage, false);
  });
});

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

  it("suppresses and restores natural attack roll context changes", () => {
    const calls = [];
    const item = {
      subType: "natural",
      getContextChanges(contexts) {
        calls.push([...contexts]);
        return contexts.map((context) => ({ context }));
      },
    };
    const action = {
      actionType: "mwak",
      item,
      attackBonus: "",
      naturalAttack: { primary: true, secondary: { attackBonus: "-5" } },
      get attackSources() {
        const contexts = ["~attackCore", "mattack"];
        if (this.item.subType === "natural") contexts.push("nattack");
        return this.item.getContextChanges(contexts);
      },
    };
    const actionUse = {
      shared: {
        action,
        rollData: { action },
        attackBonus: ["2[Flanking]"],
      },
    };
    const cleanup = [];

    applyTechniqueBonusSuppressions(actionUse, ["naturalAttack"], cleanup);

    assert.deepEqual(action.attackSources, [{ context: "~attackCore" }, { context: "mattack" }]);
    assert.deepEqual(calls[0], ["~attackCore", "mattack"]);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.attackSources, [
      { context: "~attackCore" },
      { context: "mattack" },
      { context: "nattack" },
    ]);
    assert.deepEqual(calls[1], ["~attackCore", "mattack", "nattack"]);
  });
});

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
    assert.deepEqual(action.damage.nonCritParts, [{ formula: "1d4", types: ["electric"] }]);
    assert.deepEqual(actionUse.shared.damageBonus, []);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.damage.parts, [{ formula: "1d6", types: ["bludgeoning"] }]);
    assert.deepEqual(action.damage.nonCritParts, []);
  });

  it("inherits the selected weapon damage type for untyped additive parts", () => {
    const action = {
      damage: {
        parts: [{ formula: "1d8", types: new Set(["slashing"]) }],
        nonCritParts: [],
      },
    };
    const actionUse = { shared: { action, rollData: { action }, damageBonus: [] } };
    const cleanup = [];

    applyTechniqueWeaponAttackDamageParts(
      actionUse,
      {
        damageMode: "add",
        damageParts: [{ formula: "2d6", types: "Undefined" }],
        nonCritDamageParts: [{ formula: "1", types: "Undefined" }],
      },
      cleanup,
    );

    assert.deepEqual(action.damage.parts, [
      { formula: "1d8", types: new Set(["slashing"]) },
      { formula: "2d6", types: ["slashing"] },
    ]);
    assert.deepEqual(action.damage.nonCritParts, [{ formula: "1", types: ["slashing"] }]);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.damage.parts, [{ formula: "1d8", types: new Set(["slashing"]) }]);
    assert.deepEqual(action.damage.nonCritParts, []);
  });
});

describe("delegated technique element damage", () => {
  it("applies and restores one selected element to replaced delegated damage", () => {
    const action = { damage: { parts: [{ formula: "2d6", types: [] }] } };
    const actionUse = { shared: { action, rollData: { action } } };
    const cleanup = [];

    applyTechniqueElementDamageToActionUse(actionUse, ["fire"], cleanup);

    assert.deepEqual(action.damage.parts, [{ formula: "2d6", types: ["fire"] }]);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.damage.parts, [{ formula: "2d6", types: [] }]);
  });

  it("splits and restores two selected elements for replaced delegated damage", () => {
    const action = { damage: { parts: [{ formula: "2d6", types: [] }] } };
    const actionUse = { shared: { action, rollData: { action } } };
    const cleanup = [];

    applyTechniqueElementDamageToActionUse(actionUse, ["fire", "cold"], cleanup);

    assert.deepEqual(action.damage.parts, [
      { formula: "1d6", types: ["fire"] },
      { formula: "1d6", types: ["cold"] },
    ]);

    for (const restore of cleanup.reverse()) restore();

    assert.deepEqual(action.damage.parts, [{ formula: "2d6", types: [] }]);
  });
});

describe("Amatsu no Karada source data", () => {
  it("delegates to unarmed attacks and suppresses natural attack and ability damage bonuses", () => {
    const amatsu = JSON.parse(
      readFileSync(
        "packs/_source/techniques/AMATSU_NO_KARADA__HEAVENLY_BODY__Eg83TQOvnreI9eeo.json",
        "utf8",
      ),
    );
    const wa = amatsu.system.weaponAttack;
    const action = amatsu.system.actions[0];

    assert.equal(wa.enabled, true);
    assert.equal(wa.filter, "unarmedOnly");
    assert.equal(wa.damageMode, "replace");
    assert.equal(wa.suppressNaturalAttack, true);
    assert.equal(wa.suppressAbilityDamage, true);
    assert.equal(action.ability.attack, "dex");
    assert.equal(action.ability.damage, "");
  });
});
