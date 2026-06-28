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
