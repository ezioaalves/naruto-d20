import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chooseExtraAttacksType,
} from "../scripts/features/techniques/weapon-attack.mjs";
import { migrateLegacyWeaponAttack } from "../scripts/features/techniques/weapon-attack-migrate.mjs";

describe("weaponAttack iteratives migration", () => {
  const migrate = (extra) => {
    const source = { flags: { dictionary: { "weaponAttack.mode": "selected", ...extra } } };
    migrateLegacyWeaponAttack(source);
    return source.weaponAttack;
  };

  it("defaults iteratives to true when the key is absent", () => {
    assert.equal(migrate({}).iteratives, true);
  });
  it('parses iteratives = "false"', () => {
    assert.equal(migrate({ "weaponAttack.iteratives": "false" }).iteratives, false);
  });
  it('parses iteratives = "true"', () => {
    assert.equal(migrate({ "weaponAttack.iteratives": "true" }).iteratives, true);
  });
  it("treats a non-boolean iteratives value as true", () => {
    assert.equal(migrate({ "weaponAttack.iteratives": "maybe" }).iteratives, true);
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
