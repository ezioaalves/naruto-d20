import test from "node:test";
import assert from "node:assert/strict";
import { renderOccupationSelectionContent } from "../scripts/ui/occupation-selector.mjs";

test("renders skill checkboxes with key values and 'select exactly' copy", () => {
  const html = renderOccupationSelectionContent({
    classSkillOptions: [{ key: "ste", label: "Stealth" }],
    skillSelectCount: 1,
    featOptions: [],
    techniqueOptions: [],
  });
  assert.match(html, /name="classSkill"/);
  assert.match(html, /value="ste"/);
  assert.match(html, /Stealth/);
  assert.match(html, /Select exactly 1/);
});

test("renders feat radios for multiple options, first checked", () => {
  const html = renderOccupationSelectionContent({
    classSkillOptions: [],
    skillSelectCount: 0,
    featOptions: ["Genin", "Brawl"],
    techniqueOptions: [],
  });
  assert.match(html, /name="featOption"/);
  assert.match(html, /value="Genin"[^>]*checked/);
  assert.match(html, /Brawl/);
});

test("escapes HTML in option labels", () => {
  const html = renderOccupationSelectionContent({
    classSkillOptions: [{ key: "x", label: "<script>" }],
    skillSelectCount: 1,
    featOptions: [],
    techniqueOptions: [],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("renders manual feat options as instructions, not auto-grant radios", () => {
  const html = renderOccupationSelectionContent({
    classSkillOptions: [],
    skillSelectCount: 0,
    featOptions: ["Genin"],
    manualFeatOptions: ["[Universal / Finesse Category]"],
    techniqueOptions: [],
  });

  assert.match(html, /Manual Feat Choices/);
  assert.match(html, /\[Universal \/ Finesse Category\]/);
  assert.doesNotMatch(html, /value="\[Universal \/ Finesse Category\]"/);
});
