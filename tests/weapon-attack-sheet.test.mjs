import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyWeaponAttackPreset,
  buildWeaponAttackFormData,
  buildWeaponAttackSummary,
  extraAttacksArrayFromText,
  extraAttacksTextFromArray,
  normalizeExtraAttacksText,
} from "../scripts/features/techniques/weapon-attack-sheet.mjs";

function itemWithWeaponAttack(weaponAttack) {
  return { system: { weaponAttack } };
}

describe("weapon attack sheet form data (typed field)", () => {
  it("reads an enabled typed config into editable form state", () => {
    const data = buildWeaponAttackFormData(
      itemWithWeaponAttack({
        enabled: true,
        filter: "unarmedOnly",
        damageMode: "replace",
        attackBonus: "-5",
        extraAttacks: [
          { formula: "0", name: "Second Attack" },
          { formula: "0", name: "Third Attack" },
        ],
        iteratives: false,
        suppressNaturalAttack: true,
        suppressAbilityDamage: true,
      }),
    );

    assert.equal(data.enabled, true);
    assert.equal(data.filter, "unarmedOnly");
    assert.equal(data.damageMode, "replace");
    assert.equal(data.attackBonus, "-5");
    assert.equal(data.extraAttacksText, "0|Second Attack\n0|Third Attack");
    assert.equal(data.iteratives, false);
    assert.equal(data.suppressNaturalAttack, true);
    assert.equal(data.suppressAbilityDamage, true);
  });

  it("returns disabled defaults when weaponAttack is absent or disabled", () => {
    const data = buildWeaponAttackFormData(itemWithWeaponAttack({ enabled: false }));
    assert.equal(data.enabled, false);
    assert.equal(data.filter, "meleeWeapon");
    assert.equal(data.damageMode, "add");
    assert.equal(data.iteratives, true);
    assert.equal(data.extraAttacksText, "");
  });
});

describe("weapon attack extra-attacks text<->array", () => {
  it("round-trips text to array and back", () => {
    const array = extraAttacksArrayFromText("0|Second Attack\n-5|Third Attack; |skip");
    assert.deepEqual(array, [
      { formula: "0", name: "Second Attack" },
      { formula: "-5", name: "Third Attack" },
    ]);
    assert.equal(extraAttacksTextFromArray(array), "0|Second Attack\n-5|Third Attack");
  });

  it("omits the pipe when a row has no name", () => {
    assert.equal(extraAttacksTextFromArray([{ formula: "1d6", name: "" }]), "1d6");
  });
});

describe("weapon attack sheet presets", () => {
  it("applies a Raite-like preset", () => {
    const next = applyWeaponAttackPreset("raite", { enabled: false, filter: "meleeWeapon", damageMode: "add" });
    assert.equal(next.enabled, true);
    assert.equal(next.filter, "unarmedOnly");
    assert.equal(next.damageMode, "replace");
  });

  it("keeps current fields for custom preset", () => {
    const current = { enabled: true, filter: "rangedWeapon", damageMode: "add", attackBonus: "1[Test]" };
    assert.deepEqual(applyWeaponAttackPreset("custom", current), current);
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
    assert.deepEqual(buildWeaponAttackSummary({ enabled: false }), { enabled: false, parts: [], label: "" });
  });
});

describe("normalizeExtraAttacksText", () => {
  it("normalizes newline and semicolon separators", () => {
    assert.equal(
      normalizeExtraAttacksText("0|Second Attack\n0|Third Attack; -5|Fourth Attack"),
      "0|Second Attack;0|Third Attack;-5|Fourth Attack",
    );
  });
});
