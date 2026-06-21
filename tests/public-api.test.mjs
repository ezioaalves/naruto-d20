import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPublicApi } from "../scripts/public-api.mjs";

// Defensive Foundry-global stubs, matching tests/helpers.test.mjs convention.
globalThis.foundry ??= { utils: { deepClone: (v) => structuredClone(v) } };
globalThis.game ??= { settings: { get: () => false } };

describe("buildPublicApi", () => {
  it("exposes exactly the documented downtime surface", () => {
    const api = buildPublicApi();
    assert.deepEqual(
      Object.keys(api).sort(),
      [
        "TECHNIQUE_ITEM_TYPE",
        "attemptLearnTechnique",
        "attemptMasterTechnique",
        "buildLearningView",
        "buildMasteryView",
        "isTechniqueEffectivelyLearned",
        "listLearnable",
        "listMasterable",
      ].sort(),
    );
  });

  it("wires functions and the technique type constant", () => {
    const api = buildPublicApi();
    for (const fn of [
      "attemptLearnTechnique",
      "attemptMasterTechnique",
      "buildLearningView",
      "buildMasteryView",
      "isTechniqueEffectivelyLearned",
      "listLearnable",
      "listMasterable",
    ]) {
      assert.equal(typeof api[fn], "function", `${fn} should be a function`);
    }
    assert.equal(api.TECHNIQUE_ITEM_TYPE, "naruto-d20.technique");
  });
});
