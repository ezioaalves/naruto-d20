import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const techniqueSheetCss = readFileSync("styles/item/technique-sheet.css", "utf8");

describe("technique sheet weapon attack styles", () => {
  it("targets the actual TechniqueItemSheet classes for damage rows", () => {
    assert.doesNotMatch(
      techniqueSheetCss,
      /\.naruto-d20\.sheet\.item\.technique\s+\.weapon-attack-damage/,
    );
    assert.match(techniqueSheetCss, /\.pf1\.sheet\.item\s+\.weapon-attack-damage-parts/);
  });
});
