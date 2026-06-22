import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyTechniqueDamageTransformToParts,
  registerTechniqueDamageTransforms,
  shouldRepeatDamageRolls,
  techniqueDamageTransformRepeatCount,
  normalizeTechniqueDamageTransform,
} from "../scripts/features/automation/combat/damage-transform.mjs";

describe("technique damage transforms", () => {
  it("converts all damage parts to the configured damage type", () => {
    const parts = [
      {
        base: "1d8",
        extra: ["3[Strength]", "1[Enhancement]"],
        damageType: ["slashing"],
        type: "normal",
      },
      { base: "1d6[Sneak]", extra: [], damageType: ["precision"], type: "nonCrit" },
    ];
    const config = normalizeTechniqueDamageTransform({
      enabled: true,
      multiplier: 2,
      damageType: "piercing",
    });

    applyTechniqueDamageTransformToParts(parts, config);

    assert.deepEqual(parts, [
      {
        base: "1d8",
        extra: ["3[Strength]", "1[Enhancement]"],
        damageType: ["piercing"],
        type: "normal",
      },
      { base: "1d6[Sneak]", extra: [], damageType: ["piercing"], type: "nonCrit" },
    ]);
  });

  it("keeps only critical-multipliable parts during repeated damage rolls", () => {
    const parts = [
      { base: "1d10", extra: [], damageType: ["slashing"], type: "normal" },
      { base: "1d6[Sneak]", extra: [], damageType: ["precision"], type: "nonCrit" },
    ];
    const config = normalizeTechniqueDamageTransform({
      enabled: true,
      multiplier: 2,
      damageType: "piercing",
    });

    applyTechniqueDamageTransformToParts(parts, config, { repeatOnlyMultiplied: true });

    assert.deepEqual(parts, [
      { base: "1d10", extra: [], damageType: ["piercing"], type: "normal" },
    ]);
  });

  it("computes additional full damage rolls from the configured multiplier", () => {
    assert.equal(techniqueDamageTransformRepeatCount({ multiplier: 1 }), 0);
    assert.equal(techniqueDamageTransformRepeatCount({ multiplier: 2 }), 1);
    assert.equal(techniqueDamageTransformRepeatCount({ multiplier: 3 }), 2);
  });

  it("repeats only non-critical damage so technique and crit multipliers stack additively (d20 rule)", () => {
    const config = normalizeTechniqueDamageTransform({
      enabled: true,
      multiplier: 2,
      damageType: "piercing",
    });

    // Normal hit: the technique multiplier applies to the base damage → repeat.
    assert.equal(shouldRepeatDamageRolls(config, { critical: false }), true);

    // Critical hit: PF1e already rolls (critMult - 1) extra instances, so repeating
    // here would multiply the multipliers (×2 × ×2 = ×4). The d20 rule wants additive
    // stacking (×2 + ×2 → ×3), achieved by leaving PF1e's crit rolls untouched.
    assert.equal(shouldRepeatDamageRolls(config, { critical: true }), false);

    // Recursion guard: a repeated roll must not repeat again.
    assert.equal(
      shouldRepeatDamageRolls(config, { critical: false, alreadyRepeating: true }),
      false,
    );

    // No multiplier (type-only transform) never repeats.
    assert.equal(
      shouldRepeatDamageRolls(
        normalizeTechniqueDamageTransform({ enabled: true, multiplier: 1, damageType: "piercing" }),
        { critical: false },
      ),
      false,
    );
  });

  it("registers rollDamage through libWrapper when available", () => {
    const originalPf1 = globalThis.pf1;
    const originalHooks = globalThis.Hooks;
    const originalLibWrapper = globalThis.libWrapper;
    const originalRollDamage = async () => ["base"];
    class ItemAction {}
    const calls = [];

    ItemAction.prototype.rollDamage = originalRollDamage;
    globalThis.pf1 = { components: { ItemAction } };
    globalThis.Hooks = { on: () => {} };
    globalThis.libWrapper = {
      MIXED: "MIXED",
      register: (...args) => calls.push(args),
    };

    try {
      registerTechniqueDamageTransforms();
    } finally {
      globalThis.pf1 = originalPf1;
      globalThis.Hooks = originalHooks;
      globalThis.libWrapper = originalLibWrapper;
    }

    assert.equal(ItemAction.prototype.rollDamage, originalRollDamage);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "naruto-d20");
    assert.equal(calls[0][1], "pf1.components.ItemAction.prototype.rollDamage");
    assert.equal(calls[0][3], "MIXED");
  });

  it("keeps part order while converting normal critical and non-critical parts", () => {
    const parts = [
      { base: "1d8", extra: ["3[Strength]"], damageType: ["slashing"], type: "normal" },
      { base: "2", extra: [], damageType: ["slashing"], type: "crit" },
      { base: "1d6[Sneak]", extra: [], damageType: ["precision"], type: "nonCrit" },
    ];
    const config = normalizeTechniqueDamageTransform({
      enabled: true,
      multiplier: 3,
      damageType: "piercing",
    });

    applyTechniqueDamageTransformToParts(parts, config);

    assert.deepEqual(
      parts.map((part) => part.type),
      ["normal", "crit", "nonCrit"],
    );
    assert.deepEqual(
      parts.map((part) => part.damageType),
      [["piercing"], ["piercing"], ["piercing"]],
    );
    assert.deepEqual(parts.at(-1), {
      base: "1d6[Sneak]",
      extra: [],
      damageType: ["piercing"],
      type: "nonCrit",
    });
  });

  it("leaves parts unchanged when disabled or multiplier is one with no type conversion", () => {
    const parts = [
      { base: "1d8", extra: ["2[Strength]"], damageType: ["slashing"], type: "normal" },
    ];
    const snapshot = JSON.parse(JSON.stringify(parts));

    applyTechniqueDamageTransformToParts(
      parts,
      normalizeTechniqueDamageTransform({ enabled: false, multiplier: 2, damageType: "piercing" }),
    );
    applyTechniqueDamageTransformToParts(
      parts,
      normalizeTechniqueDamageTransform({ enabled: true, multiplier: 1, damageType: "" }),
    );

    assert.deepEqual(parts, snapshot);
  });
});

describe("Gatotsu Isshiki source data", () => {
  it("marks the delegated weapon attack as charge and configures generic damage transform", () => {
    const gatotsu = JSON.parse(
      readFileSync(
        "packs/_source/techniques/GATOTSU__ISSHIKI__PIERCING_FANG__FIRST_FORM__G7yk5aL2kP4b5Rqz.json",
        "utf8",
      ),
    );
    const dict = gatotsu.system.flags.dictionary;
    const transform = gatotsu.system.automation.damageTransform;

    assert.equal(dict["weaponAttack.mode"], "selected");
    assert.equal(dict["weaponAttack.filter"], "meleeWeapon");
    assert.equal(dict["weaponAttack.charge"], "true");
    assert.deepEqual(transform, {
      enabled: true,
      multiplier: 2,
      damageType: "piercing",
    });
  });
});
