import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyTechniqueElementDamageToActionUse,
  applyTechniqueBonusSuppressions,
  parseWeaponAttackConfig,
} from "../scripts/features/techniques/weapon-attack.mjs";

describe("weaponAttack suppressed bonuses parsing", () => {
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
