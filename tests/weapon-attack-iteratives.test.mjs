import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseWeaponAttackConfig,
  chooseExtraAttacksType,
} from "../scripts/features/techniques/weapon-attack.mjs";

describe("weaponAttack iteratives parsing", () => {
  const parse = (values) =>
    parseWeaponAttackConfig({
      malformed: false,
      keys: new Set(Object.keys(values)),
      values,
    });

  it("defaults iteratives to true when the key is absent", () => {
    const { config, warnings } = parse({ mode: "selected" });
    assert.equal(config.iteratives, true);
    assert.deepEqual(warnings, []);
  });

  it('parses iteratives = "false"', () => {
    const { config, warnings } = parse({ mode: "selected", iteratives: "false" });
    assert.equal(config.iteratives, false);
    assert.deepEqual(warnings, []);
  });

  it('parses iteratives = "true"', () => {
    const { config } = parse({ mode: "selected", iteratives: "true" });
    assert.equal(config.iteratives, true);
  });

  it("warns on a non-boolean iteratives value and keeps the default", () => {
    const { config, warnings } = parse({ mode: "selected", iteratives: "maybe" });
    assert.equal(config.iteratives, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /weaponAttack\.iteratives/);
  });

  it("does not flag iteratives as an unknown field", () => {
    const { warnings } = parse({ mode: "selected", iteratives: "false" });
    assert.deepEqual(warnings, []);
  });
});

describe("chooseExtraAttacksType", () => {
  it("forces custom (no BAB iteratives) when iteratives is false", () => {
    assert.equal(
      chooseExtraAttacksType({ originalType: "standard", originalSupportsManual: false, iteratives: false }),
      "custom",
    );
    assert.equal(
      chooseExtraAttacksType({ originalType: "advanced", originalSupportsManual: true, iteratives: false }),
      "custom",
    );
  });

  it("falls back to advanced when the original type lacks manual support", () => {
    assert.equal(
      chooseExtraAttacksType({ originalType: "standard", originalSupportsManual: false, iteratives: true }),
      "advanced",
    );
  });

  it("preserves a manual-capable original type when iteratives is true", () => {
    assert.equal(
      chooseExtraAttacksType({ originalType: "advanced", originalSupportsManual: true, iteratives: true }),
      "advanced",
    );
  });
});
