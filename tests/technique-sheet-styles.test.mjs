import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

globalThis.ItemSheet = class ItemSheet {
  static get defaultOptions() {
    return { classes: [] };
  }
};

globalThis.foundry = {
  utils: {
    mergeObject: (base, source) => ({ ...base, ...source }),
  },
};

const { createTechniqueItemSheet } = await import("../scripts/features/techniques/sheet.mjs");

const techniqueSheetCss = readFileSync("styles/item/technique-sheet.css", "utf8");
const TECHNIQUE_SHEET_CLASS = "naruto-d20-technique-sheet";

describe("technique sheet style scoping", () => {
  it("adds a stable module class to TechniqueItemSheet", () => {
    const TechniqueItemSheet = createTechniqueItemSheet();

    assert.deepEqual(TechniqueItemSheet.defaultOptions.classes, [
      "pf1",
      "sheet",
      "item",
      TECHNIQUE_SHEET_CLASS,
    ]);
  });

  it("scopes technique sheet CSS to the stable module class", () => {
    assert.doesNotMatch(
      techniqueSheetCss,
      /\.naruto-d20\.sheet\.item\.technique\s+\.weapon-attack-damage/,
    );
    assert.doesNotMatch(techniqueSheetCss, /\.pf1\.sheet\.item\s+\./);
    assert.match(
      techniqueSheetCss,
      /\.pf1\.sheet\.item\.naruto-d20-technique-sheet\s+\.weapon-attack-damage-parts/,
    );
  });
});
