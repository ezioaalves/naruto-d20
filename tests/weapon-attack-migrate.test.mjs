import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasLegacyWeaponAttack,
  migrateLegacyWeaponAttack,
} from "../scripts/features/techniques/weapon-attack-migrate.mjs";

describe("hasLegacyWeaponAttack", () => {
  it("detects dotted and nested legacy keys, ignores clean systems", () => {
    assert.equal(
      hasLegacyWeaponAttack({ flags: { dictionary: { "weaponAttack.mode": "selected" } } }),
      true,
    );
    assert.equal(
      hasLegacyWeaponAttack({ flags: { dictionary: { weaponAttack: { mode: "selected" } } } }),
      true,
    );
    assert.equal(hasLegacyWeaponAttack({ flags: { dictionary: { other: 1 } } }), false);
    assert.equal(hasLegacyWeaponAttack({ weaponAttack: { enabled: true } }), false);
    assert.equal(hasLegacyWeaponAttack({}), false);
  });
});

describe("migrateLegacyWeaponAttack", () => {
  it("converts dotted legacy keys to a typed object and strips them", () => {
    const source = {
      flags: {
        dictionary: {
          "weaponAttack.mode": "selected",
          "weaponAttack.filter": "unarmedOnly",
          "weaponAttack.damageMode": "replace",
          "weaponAttack.attackBonus": "-5",
          "weaponAttack.extraAttacks": "0|Second Attack;0|Third Attack",
          "weaponAttack.iteratives": "false",
          "weaponAttack.suppressedBonuses": "naturalAttack,abilityDamage",
          unrelated: "kept",
        },
      },
    };

    migrateLegacyWeaponAttack(source);

    assert.deepEqual(source.weaponAttack, {
      enabled: true,
      filter: "unarmedOnly",
      damageMode: "replace",
      held: "",
      charge: false,
      iteratives: false,
      attackBonus: "-5",
      damageParts: [],
      nonCritDamageParts: [],
      extraAttacks: [
        { formula: "0", name: "Second Attack" },
        { formula: "0", name: "Third Attack" },
      ],
      suppressNaturalAttack: true,
      suppressAbilityDamage: true,
    });
    assert.deepEqual(source.flags.dictionary, { unrelated: "kept" });
  });

  it("prefers the nested object over dotted keys and coerces charge", () => {
    const source = {
      flags: {
        dictionary: {
          weaponAttack: { mode: "selected", filter: "rangedWeapon", charge: "true" },
          "weaponAttack.filter": "unarmedOnly",
        },
      },
    };

    migrateLegacyWeaponAttack(source);

    assert.equal(source.weaponAttack.filter, "rangedWeapon");
    assert.equal(source.weaponAttack.charge, true);
    assert.equal(source.weaponAttack.iteratives, true);
    assert.deepEqual(source.flags.dictionary, {});
  });

  it("coerces an invalid enum to its default", () => {
    const source = { flags: { dictionary: { "weaponAttack.mode": "selected", "weaponAttack.filter": "bogus" } } };
    migrateLegacyWeaponAttack(source);
    assert.equal(source.weaponAttack.filter, "meleeWeapon");
  });

  it("converts legacy damage bonus strings into untyped structured rows", () => {
    const source = {
      flags: {
        dictionary: {
          "weaponAttack.mode": "selected",
          "weaponAttack.damageBonus": "2[Iaiken]",
          "weaponAttack.nonCritDamageBonus": "(min(floor(@cl / 3), 4))d4[Iaiken]",
        },
      },
    };

    migrateLegacyWeaponAttack(source);

    assert.deepEqual(source.weaponAttack.damageParts, [{ formula: "2[Iaiken]", types: [] }]);
    assert.deepEqual(source.weaponAttack.nonCritDamageParts, [
      { formula: "(min(floor(@cl / 3), 4))d4[Iaiken]", types: [] },
    ]);
    assert.equal(source.weaponAttack.damageBonus, undefined);
    assert.equal(source.weaponAttack.nonCritDamageBonus, undefined);
  });

  it("normalizes already-typed damage rows without replacing them", () => {
    const typed = {
      weaponAttack: {
        enabled: true,
        damageBonus: "legacy should be ignored",
        damageParts: [{ formula: " 2 ", types: [" cold "] }],
        nonCritDamageParts: [{ formula: "1d4", types: "electricity" }],
      },
      flags: { dictionary: {} },
    };

    migrateLegacyWeaponAttack(typed);

    assert.deepEqual(typed.weaponAttack.damageParts, [{ formula: "2", types: ["cold"] }]);
    assert.deepEqual(typed.weaponAttack.nonCritDamageParts, [
      { formula: "1d4", types: ["electric"] },
    ]);
    assert.equal(typed.weaponAttack.damageBonus, undefined);
    assert.equal(typed.weaponAttack.nonCritDamageBonus, undefined);
  });

  it("is a no-op on a clean or already-typed system", () => {
    const clean = { flags: { dictionary: { other: 1 } } };
    migrateLegacyWeaponAttack(clean);
    assert.equal(clean.weaponAttack, undefined);

    const typed = {
      weaponAttack: { enabled: true, filter: "meleeWeapon" },
      flags: { dictionary: {} },
    };
    migrateLegacyWeaponAttack(typed);
    assert.deepEqual(typed.weaponAttack, { enabled: true, filter: "meleeWeapon" });
  });
});
