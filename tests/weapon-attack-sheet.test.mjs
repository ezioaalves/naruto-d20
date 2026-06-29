import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyWeaponAttackPreset,
  buildDamageTypeVisualData,
  buildWeaponAttackFormData,
  buildWeaponAttackSummary,
  damagePartRowsFromForm,
  damagePartRowsToForm,
  extractIndexedRows,
  extraAttacksArrayFromText,
  extraAttacksTextFromArray,
  normalizeExtraAttacksText,
  setDamagePartTypesAt,
} from "../scripts/features/techniques/weapon-attack-sheet.mjs";

function itemWithWeaponAttack(weaponAttack) {
  return { system: { weaponAttack } };
}

const fakeDamageTypes = new Map([
  ["cold", { id: "cold", name: "Cold", icon: "icon-cold", color: "#00ffff" }],
  ["electric", { id: "electric", name: "Electricity", icon: "icon-electricity", color: "#ffff00" }],
]);

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
        damageParts: [{ formula: "2", types: ["cold"] }],
        nonCritDamageParts: [{ formula: "1d4", types: ["electricity"] }],
      }),
      { damageTypeRegistry: fakeDamageTypes },
    );

    assert.equal(data.enabled, true);
    assert.equal(data.filter, "unarmedOnly");
    assert.equal(data.damageMode, "replace");
    assert.equal(data.attackBonus, "-5");
    assert.equal(data.extraAttacksText, "0|Second Attack\n0|Third Attack");
    assert.equal(data.iteratives, false);
    assert.equal(data.suppressNaturalAttack, true);
    assert.equal(data.suppressAbilityDamage, true);
    assert.equal(data.damageParts[0].formula, "2");
    assert.equal(data.damageParts[0].typesText, "cold");
    assert.deepEqual([...data.damageParts[0].damage.types], ["cold"]);
    assert.deepEqual(data.damageParts[0].damage.standard, [
      { id: "cold", name: "Cold", icon: "icon-cold", color: "#00ffff" },
    ]);
    assert.equal(data.nonCritDamageParts[0].formula, "1d4");
    assert.equal(data.nonCritDamageParts[0].typesText, "electric");
    assert.deepEqual([...data.nonCritDamageParts[0].damage.types], ["electric"]);
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
    const next = applyWeaponAttackPreset("raite", {
      enabled: false,
      filter: "meleeWeapon",
      damageMode: "add",
    });
    assert.equal(next.enabled, true);
    assert.equal(next.filter, "unarmedOnly");
    assert.equal(next.damageMode, "replace");
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

describe("normalizeExtraAttacksText", () => {
  it("normalizes newline and semicolon separators", () => {
    assert.equal(
      normalizeExtraAttacksText("0|Second Attack\n0|Third Attack; -5|Fourth Attack"),
      "0|Second Attack;0|Third Attack;-5|Fourth Attack",
    );
  });
});

describe("weapon attack damage part form rows", () => {
  it("builds PF1e damage-type visual data from row types", () => {
    const visual = buildDamageTypeVisualData(["cold", "custom"], fakeDamageTypes);
    assert.deepEqual([...visual.types], ["cold", "custom"]);
    assert.deepEqual(visual.standard, [
      { id: "cold", name: "Cold", icon: "icon-cold", color: "#00ffff" },
    ]);
    assert.deepEqual([...visual.custom], ["custom"]);
  });

  it("round-trips formula and damage type CSV rows, preserving typed draft rows", () => {
    const rows = damagePartRowsFromForm([
      { formula: " 2 ", types: "cold, electricity" },
      { formula: "", types: "fire" },
      { formula: "", types: "" },
    ]);
    assert.deepEqual(rows, [
      { formula: "2", types: ["cold", "electric"] },
      { formula: "", types: ["fire"] },
    ]);
    const formRows = damagePartRowsToForm(rows, fakeDamageTypes);
    assert.equal(formRows[0].formula, "2");
    assert.equal(formRows[0].typesText, "cold, electric");
    assert.deepEqual([...formRows[0].damage.types], ["cold", "electric"]);
    assert.equal(formRows[1].formula, "");
    assert.equal(formRows[1].typesText, "fire");
    assert.deepEqual([...formRows[1].damage.types], ["fire"]);
  });

  it("sets a row's types while preserving its DOM-captured formula", () => {
    const rows = [{ formula: "2[Jiki-Uchi]", types: "slashing" }];

    assert.deepEqual(damagePartRowsFromForm(setDamagePartTypesAt(rows, 0, ["fire"])), [
      { formula: "2[Jiki-Uchi]", types: ["fire"] },
    ]);
  });

  it("sets one row's types without dropping its formula or sibling rows", () => {
    const rows = [
      { formula: "(min(floor(@cl / 2), 5))d6[Denjiba Totsugeki]", types: "" },
      { formula: "1d4", types: "electricity" },
    ];

    assert.deepEqual(damagePartRowsFromForm(setDamagePartTypesAt(rows, 0, ["cold"])), [
      { formula: "(min(floor(@cl / 2), 5))d6[Denjiba Totsugeki]", types: ["cold"] },
      { formula: "1d4", types: ["electric"] },
    ]);
  });

  it("pads to the target index without clobbering an existing row", () => {
    const rows = [{ formula: "2", types: "cold" }];

    assert.deepEqual(damagePartRowsFromForm(setDamagePartTypesAt(rows, 1, ["slashing"])), [
      { formula: "2", types: ["cold"] },
      { formula: "", types: ["slashing"] },
    ]);
  });

  it("sets types on an empty-formula row without discarding the row", () => {
    const rows = [{ formula: "", types: "" }];

    assert.deepEqual(damagePartRowsFromForm(setDamagePartTypesAt(rows, 0, ["slashing"])), [
      { formula: "", types: ["slashing"] },
    ]);
  });

  it("does not mutate the input rows array", () => {
    const rows = [{ formula: "2", types: "cold" }];
    setDamagePartTypesAt(rows, 0, ["fire"]);
    assert.deepEqual(rows, [{ formula: "2", types: "cold" }]);
  });
});

describe("extractIndexedRows", () => {
  it("collects sparse indexed form keys into rows", () => {
    const formData = {
      "system.weaponAttack.damageParts.0.formula": "1d6",
      "system.weaponAttack.damageParts.0.types": "cold",
      "system.weaponAttack.damageParts.2.formula": "2d4",
      "system.weaponAttack.damageParts.2.types": "fire",
      "system.weaponAttack.attackBonus": "+2",
    };
    const rows = extractIndexedRows(formData, "system.weaponAttack.damageParts");
    assert.deepEqual(rows, [
      { formula: "1d6", types: "cold" },
      { formula: "2d4", types: "fire" },
    ]);
    // consumed keys must be removed from formData
    assert.equal(formData["system.weaponAttack.damageParts.0.formula"], undefined);
    assert.equal(formData["system.weaponAttack.attackBonus"], "+2");
  });

  it("returns empty array when no matching keys", () => {
    const formData = { "system.weaponAttack.attackBonus": "+2" };
    assert.deepEqual(extractIndexedRows(formData, "system.weaponAttack.damageParts"), []);
  });
});
