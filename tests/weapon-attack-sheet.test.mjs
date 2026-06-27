import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyWeaponAttackPreset,
  buildWeaponAttackDictionaryUpdates,
  buildWeaponAttackFormData,
  buildWeaponAttackSummary,
  normalizeExtraAttacksText,
} from "../scripts/features/techniques/weapon-attack-sheet.mjs";

function itemWithDictionary(dictionary) {
  return {
    system: {
      flags: { dictionary },
    },
  };
}

describe("weapon attack sheet form data", () => {
  it("reads existing dotted dictionary flags into editable form state", () => {
    const item = itemWithDictionary({
      "weaponAttack.mode": "selected",
      "weaponAttack.filter": "unarmedOnly",
      "weaponAttack.damageMode": "replace",
      "weaponAttack.attackBonus": "-5",
      "weaponAttack.extraAttacks": "0|Second Attack;0|Third Attack",
      "weaponAttack.iteratives": "false",
      "weaponAttack.suppressedBonuses": "naturalAttack,abilityDamage",
      unrelated: "kept",
    });

    const data = buildWeaponAttackFormData(item);

    assert.equal(data.enabled, true);
    assert.equal(data.filter, "unarmedOnly");
    assert.equal(data.damageMode, "replace");
    assert.equal(data.attackBonus, "-5");
    assert.equal(data.extraAttacksText, "0|Second Attack\n0|Third Attack");
    assert.equal(data.iteratives, false);
    assert.equal(data.suppressNaturalAttack, true);
    assert.equal(data.suppressAbilityDamage, true);
    assert.deepEqual(data.warnings, []);
  });

  it("returns disabled defaults when no weaponAttack config is present", () => {
    const data = buildWeaponAttackFormData(itemWithDictionary({ unrelated: "kept" }));

    assert.equal(data.enabled, false);
    assert.equal(data.filter, "meleeWeapon");
    assert.equal(data.damageMode, "add");
    assert.equal(data.charge, false);
    assert.equal(data.iteratives, true);
    assert.equal(data.extraAttacksText, "");
  });
});

describe("weapon attack sheet presets", () => {
  it("applies a Raite-like preset", () => {
    const next = applyWeaponAttackPreset("raite", {
      enabled: false,
      filter: "meleeWeapon",
      damageMode: "add",
    });

    assert.equal(next.enabled, true);
    assert.equal(next.filter, "unarmedOnly");
    assert.equal(next.damageMode, "replace");
    assert.equal(next.charge, false);
    assert.equal(next.iteratives, true);
  });

  it("applies a Ryuutsuki-like preset", () => {
    const next = applyWeaponAttackPreset("ryuutsuki", {
      enabled: false,
      filter: "unarmedOnly",
      damageMode: "replace",
    });

    assert.equal(next.enabled, true);
    assert.equal(next.filter, "meleeOrUnarmed");
    assert.equal(next.damageMode, "add");
    assert.equal(next.charge, true);
  });

  it("keeps current fields for custom preset", () => {
    const current = {
      enabled: true,
      filter: "rangedWeapon",
      damageMode: "add",
      attackBonus: "1[Test]",
    };

    assert.deepEqual(applyWeaponAttackPreset("custom", current), current);
  });
});

describe("weapon attack sheet normalization", () => {
  it("normalizes newline and semicolon extra attacks into dictionary format", () => {
    assert.equal(
      normalizeExtraAttacksText("0|Second Attack\n0|Third Attack; -5|Fourth Attack"),
      "0|Second Attack;0|Third Attack;-5|Fourth Attack",
    );
  });

  it("builds dictionary updates for enabled automation and removes empty optional keys", () => {
    const updates = buildWeaponAttackDictionaryUpdates(
      {
        enabled: true,
        filter: "unarmedOnly",
        damageMode: "replace",
        attackBonus: "-5",
        damageBonus: "",
        nonCritDamageBonus: "",
        held: "",
        charge: false,
        iteratives: false,
        extraAttacksText: "0|Second Attack\n0|Third Attack",
        suppressNaturalAttack: false,
        suppressAbilityDamage: true,
      },
      {
        "weaponAttack.damageBonus": "old",
        "weaponAttack.charge": "true",
        unrelated: "kept",
      },
    );

    assert.deepEqual(updates, {
      "system.flags.dictionary.weaponAttack.mode": "selected",
      "system.flags.dictionary.weaponAttack.filter": "unarmedOnly",
      "system.flags.dictionary.weaponAttack.damageMode": "replace",
      "system.flags.dictionary.weaponAttack.attackBonus": "-5",
      "system.flags.dictionary.-=weaponAttack.damageBonus": null,
      "system.flags.dictionary.-=weaponAttack.charge": null,
      "system.flags.dictionary.weaponAttack.iteratives": "false",
      "system.flags.dictionary.weaponAttack.extraAttacks": "0|Second Attack;0|Third Attack",
      "system.flags.dictionary.weaponAttack.suppressedBonuses": "abilityDamage",
    });
  });

  it("removes all known weaponAttack keys when automation is disabled", () => {
    const updates = buildWeaponAttackDictionaryUpdates(
      { enabled: false },
      {
        "weaponAttack.mode": "selected",
        "weaponAttack.filter": "unarmedOnly",
        "weaponAttack.damageMode": "replace",
        unrelated: "kept",
      },
    );

    assert.deepEqual(updates, {
      "system.flags.dictionary.-=weaponAttack.mode": null,
      "system.flags.dictionary.-=weaponAttack.filter": null,
      "system.flags.dictionary.-=weaponAttack.damageMode": null,
      "system.flags.dictionary.-=weaponAttack.attackBonus": null,
      "system.flags.dictionary.-=weaponAttack.damageBonus": null,
      "system.flags.dictionary.-=weaponAttack.nonCritDamageBonus": null,
      "system.flags.dictionary.-=weaponAttack.extraAttacks": null,
      "system.flags.dictionary.-=weaponAttack.held": null,
      "system.flags.dictionary.-=weaponAttack.charge": null,
      "system.flags.dictionary.-=weaponAttack.iteratives": null,
      "system.flags.dictionary.-=weaponAttack.suppressedBonuses": null,
    });
  });
});

describe("weapon attack sheet summary", () => {
  it("builds a compact Juuroku Rendan style summary", () => {
    const summary = buildWeaponAttackSummary({
      enabled: true,
      filter: "unarmedOnly",
      damageMode: "replace",
      extraAttacksText: "0|Second Attack\n0|Third Attack",
      iteratives: false,
      charge: false,
    });

    assert.deepEqual(summary, {
      enabled: true,
      parts: ["Selected Unarmed", "Replace damage", "3 attacks", "no iteratives"],
      label: "Selected Unarmed · Replace damage · 3 attacks · no iteratives",
    });
  });

  it("returns a disabled summary for normal techniques", () => {
    assert.deepEqual(buildWeaponAttackSummary({ enabled: false }), {
      enabled: false,
      parts: [],
      label: "",
    });
  });
});
