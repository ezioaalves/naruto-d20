import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOccupationSelectionResult,
  renderOccupationSelectionContent,
} from "../scripts/ui/occupation-selector.mjs";

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

test("renders advanced bloodline options as grantable radios", () => {
  const html = renderOccupationSelectionContent({
    classSkillOptions: [],
    skillSelectCount: 0,
    featOptions: ["Advanced Bloodline (Byakugan)", "Advanced Bloodline (Red Eyes)"],
    manualFeatOptions: [],
    techniqueOptions: [],
  });

  assert.match(html, /value="Advanced Bloodline \(Byakugan\)"/);
  assert.match(html, /value="Advanced Bloodline \(Red Eyes\)"/);
  assert.doesNotMatch(html, /Manual Feat Choices/);
});

test("normalizes close and cancel dialog results to null", () => {
  assert.equal(normalizeOccupationSelectionResult(null), null);
  assert.equal(normalizeOccupationSelectionResult(undefined), null);
  assert.equal(normalizeOccupationSelectionResult(false), null);
  assert.equal(normalizeOccupationSelectionResult("cancel"), null);
  assert.equal(normalizeOccupationSelectionResult({ action: "cancel" }), null);
});

test("preserves valid occupation selection payloads", () => {
  const payload = {
    classSkillKeys: ["ste", "kar"],
    featName: "Genin",
    techniqueName: null,
  };

  assert.equal(normalizeOccupationSelectionResult(payload), payload);
});
