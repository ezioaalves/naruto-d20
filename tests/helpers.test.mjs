import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyTechniqueSystemDefaults,
  legacyAutomationToMaintenance,
} from "../scripts/features/techniques/defaults.mjs";
import {
  buildEmpowerDamageFormula,
  empowerPerformIncrease,
  normalizeEmpowerConfig,
  resolveEmpowerStepLimit,
  resolveEmpowerUse,
  shouldPromptEmpowerBeforePerform,
} from "../scripts/automation/technique-empower.mjs";
import { maintenanceMigrationPatch } from "../scripts/data/maintenance-migration.mjs";
import {
  computeTechniqueDerived,
  createTechniqueDataModel,
} from "../scripts/features/techniques/model.mjs";
import {
  allocateTemporaryChakraGrantSpend,
  calculateChakraSpend,
  canPayChakra,
} from "../scripts/features/chakra/spend.mjs";
import {
  getRankMaintenanceFlag,
  isFiniteRoundDuration,
  maintenanceBuffFlagData,
  maintenanceFacets,
  maintenanceModeBuffName,
  maintenanceModeById,
  maintenanceRoundsRemaining,
  realMaintenanceBuffDuration,
  resolveMaintenanceModel,
  shouldChargeUpkeep,
} from "../scripts/features/automation/maintenance/buffs.mjs";
import { extractTemporaryChakraGrant } from "../scripts/features/automation/buffs/application.mjs";
import { computeEffectiveRank } from "../scripts/features/automation/ranks/effective-level.mjs";
import { registerTrainingWeightCarryPatch } from "../scripts/features/automation/training/weight-carry.mjs";
import {
  applyStrengthRankCombatToAttack,
  applyStrengthRankCombatToDamage,
} from "../scripts/features/automation/combat/strength-rank-combat.mjs";
import { applySpeedRankAttack } from "../scripts/features/automation/combat/speed-rank-attack.mjs";
import { applyAttackNoManeuver } from "../scripts/features/automation/combat/attack-no-maneuver.mjs";
import { getRankGrantType, rankGrantLevel } from "../scripts/features/automation/ranks/buffs.mjs";
import {
  legacyRankBuffToMaintenance,
  rankMaintenanceFromContext,
} from "../scripts/data/maintenance-migration.mjs";
import { elementCount } from "../scripts/features/automation/maintenance/element-damage.mjs";
import { diffTechnique, normalizeSystem } from "../scripts/features/techniques/sync.mjs";
import {
  LEARNING_MODES,
  buildLearningView,
  buildLearnAttemptResult,
  getTechniqueLearningResolution,
  getLearningMaxAttempts,
  getLearningTargetProgress,
} from "../scripts/features/techniques/learn.mjs";
import {
  deriveAttackCategories,
  parseWeaponAttackConfig,
  readWeaponAttackRaw,
} from "../scripts/features/techniques/weapon-attack.mjs";
import {
  getHighestLearnedStrengthRank,
  getIgnoredTrainingWeightTotal,
  getTrainingWeightLearnBonus,
  getTrainingWeightState,
} from "../scripts/data/training-weights.mjs";
import {
  buildLearnCheckBreakdown,
  buildMasteryCheckBreakdown,
} from "../scripts/features/chakra/bonus-sources.mjs";
import { validateCompendia } from "../tools/validate-compendia.mjs";
import { calculateChakraDamage } from "../scripts/features/chakra/damage.mjs";
import {
  checkAndUpdateConditions,
  registerChakraConditionCombatHooks,
  resolveChakraConditionState,
} from "../scripts/features/chakra/conditions.mjs";
import { onActorRest } from "../scripts/features/chakra/rest-recovery.mjs";
import { BUFF_TARGETS } from "../scripts/core/flag-paths.mjs";
import { rollHpCost } from "../scripts/data/hp-cost.mjs";
import { applyConditionBenefits } from "../scripts/features/automation/buffs/condition-benefits.mjs";

globalThis.Math.clamp = (value, min, max) => Math.max(min, Math.min(max, value));

globalThis.foundry = {
  utils: {
    deepClone: (value) => structuredClone(value),
  },
};

globalThis.game = {
  settings: {
    get: () => false,
  },
};

globalThis.RollPF = {
  safeRoll: async (formula, data = {}) => {
    const normalized = String(formula)
      .replaceAll("@mastery", String(data.mastery ?? 0))
      .replace(/floor\(([^)]+)\)/g, (_, expr) => String(Math.floor(Function(`return (${expr})`)())))
      .replace(/ceil\(([^)]+)\)/g, (_, expr) => String(Math.ceil(Function(`return (${expr})`)())));
    return { total: Function(`return (${normalized})`)() };
  },
};

function techniqueDoc(overrides = {}) {
  return {
    type: "naruto-d20.technique",
    _id: overrides._id ?? "technique01",
    _key: `!items!${overrides._id ?? "technique01"}`,
    name: overrides.name ?? "Test Technique",
    system: {
      discipline: "Ninjutsu",
      rank: 1,
      complexity: "E-Class",
      chakraCost: 1,
      ...overrides.system,
    },
  };
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function makeSourceRoot(filesByPack) {
  const root = mkdtempSync(join(tmpdir(), "naruto-d20-tests-"));
  const sourceRoot = join(root, "packs/_source");
  for (const pack of [
    "techniques",
    "feats",
    "technique-buffs",
    "equipments",
    "occupations",
    "occupations-community",
  ]) {
    mkdirSync(join(sourceRoot, pack), { recursive: true });
  }
  for (const [pack, files] of Object.entries(filesByPack)) {
    for (const [filename, data] of Object.entries(files)) {
      writeJson(join(sourceRoot, pack, filename), data);
    }
  }
  return { root, sourceRoot };
}

function occupationDoc(overrides = {}) {
  return {
    type: "feat",
    _id: overrides._id ?? "occupation01",
    _key: `!items!${overrides._id ?? "occupation01"}`,
    name: overrides.name ?? "Test Occupation",
    system: {
      subType: "trait",
      classSkills: {},
      links: { supplements: [] },
      ...overrides.system,
    },
    flags: {
      "naruto-d20": {
        occupation: {
          slug: "test-occupation",
          skillSelectCount: 0,
          fixedClassSkills: [],
          classSkillOptions: [],
          featOptions: ["Test Feat"],
          manualFeatOptions: ["[Manual Choice]"],
          techniqueOptions: ["Test Technique"],
          wealthBonus: 0,
          reputationBonus: 0,
          ...overrides.occupation,
        },
      },
      ...overrides.flags,
    },
  };
}

describe("technique defaults", () => {
  it("fills Foundry-safe defaults and mirrors descriptor booleans", () => {
    const system = applyTechniqueSystemDefaults({
      isHijutsu: true,
      isCombination: true,
      descriptors: ["Fire"],
      tags: { primary: "combat" },
    });

    assert.equal(system.description.value, "");
    assert.equal(system.learning.learned, false);
    assert.equal(system.automation.enabled, true);
    assert.equal(system.automation.targetMode, "auto");
    assert.deepEqual(system.automation.empower, {
      enabled: false,
      mode: "damageBonus",
      costPerStep: 1,
      formulaPerStep: "1d6",
      damageTypes: [],
      maxStepsFormula: "",
      performIncreaseEvery: 0,
      performIncreaseAmount: 0,
    });
    assert.deepEqual(system.automation.maintenance, {
      enabled: false,
      resource: "",
      cost: "1d4",
      policy: "prompt",
      interval: 1,
      waiver: "",
      waiverStep: 2,
      freeRounds: 5,
      choice: "",
      allowStanceStacking: false,
      heal: "",
      clearConditions: "",
      element: false,
      elementDoubleStep: 5,
    });
    assert.deepEqual(system.links.prerequisites, []);
    assert.deepEqual(system.tags, ["combat"]);
    assert.deepEqual(system.descriptors, ["Fire", "Hijutsu", "Combination"]);
  });

  it("can normalize collections to sets for the TypeDataModel path", () => {
    const system = applyTechniqueSystemDefaults(
      { descriptors: ["Kinjutsu"], isKinjutsu: true },
      { collectionType: "set" },
    );

    assert.ok(system.descriptors instanceof Set);
    assert.deepEqual([...system.descriptors], ["Kinjutsu"]);
  });

  it("maps legacy stance automation to maintenance without changing behavior", () => {
    assert.deepEqual(
      legacyAutomationToMaintenance({
        stanceMode: false,
        stanceUpkeep: true,
        elementChoice: true,
        upkeepFormula: "1d4",
        upkeepMode: "prompt",
        upkeepWaiverStep: 2,
        elementDoubleStep: 5,
      }),
      {
        enabled: true,
        resource: "hp",
        cost: "1d4",
        policy: "prompt",
        interval: 1,
        waiver: "step",
        waiverStep: 2,
        freeRounds: 5,
        choice: "",
        element: true,
        elementDoubleStep: 5,
      },
    );
    assert.equal(legacyAutomationToMaintenance({ enabled: true, targetMode: "auto" }), null);
  });

  // ── Regression guard: schema ↔ normalizer parity ──────────────────────
  // Synckit reports "out-of-date" whenever the embedded copy carries a
  // `system.automation.maintenance` key the source JSON predates and the
  // normalizer fails to backfill on both sides. A no-op sheet open/close
  // persists the full DataModel-cleaned maintenance block, so EVERY field in
  // the schema's `automation.maintenance` SchemaField MUST also be defaulted
  // by applyTechniqueSystemDefaults. This test introspects the live schema so
  // that adding a maintenance field without backfilling it fails CI here —
  // before it silently flags every learned technique as desatualizada.
  // (Bugs reintroduced by #114/#119 after #109/#117 first fixed the class.)
  it("backfills every automation.maintenance field declared in the schema", () => {
    const leaf = class {};
    const prevData = globalThis.foundry.data;
    const prevAbstract = globalThis.foundry.abstract;
    globalThis.foundry.abstract = { TypeDataModel: class {} };
    globalThis.foundry.data = {
      fields: {
        SchemaField: class {
          constructor(schema) {
            this.fields = schema;
          }
        },
        ArrayField: class {
          constructor(element) {
            this.element = element;
          }
        },
        SetField: class {
          constructor(element) {
            this.element = element;
          }
        },
        StringField: leaf,
        NumberField: leaf,
        BooleanField: leaf,
        HTMLField: leaf,
        ObjectField: leaf,
      },
    };

    let schemaKeys;
    try {
      const schema = createTechniqueDataModel().defineSchema();
      schemaKeys = Object.keys(schema.automation.fields.maintenance.fields).sort();
    } finally {
      globalThis.foundry.data = prevData;
      globalThis.foundry.abstract = prevAbstract;
    }

    const normalizerKeys = Object.keys(
      applyTechniqueSystemDefaults({}).automation.maintenance,
    ).sort();

    assert.deepEqual(
      normalizerKeys,
      schemaKeys,
      "applyTechniqueSystemDefaults must default every automation.maintenance schema field " +
        "(see scripts/features/techniques/defaults.mjs) or synckit will flag unedited techniques out-of-date",
    );
  });

  it("backfills every automation.empower field declared in the schema", () => {
    const leaf = class {};
    const prevData = globalThis.foundry.data;
    const prevAbstract = globalThis.foundry.abstract;
    globalThis.foundry.abstract = { TypeDataModel: class {} };
    globalThis.foundry.data = {
      fields: {
        SchemaField: class {
          constructor(schema) {
            this.fields = schema;
          }
        },
        ArrayField: class {
          constructor(element) {
            this.element = element;
          }
        },
        SetField: class {
          constructor(element) {
            this.element = element;
          }
        },
        StringField: leaf,
        NumberField: leaf,
        BooleanField: leaf,
        HTMLField: leaf,
        ObjectField: leaf,
      },
    };

    let schemaKeys;
    try {
      const schema = createTechniqueDataModel().defineSchema();
      schemaKeys = Object.keys(schema.automation.fields.empower.fields).sort();
    } finally {
      globalThis.foundry.data = prevData;
      globalThis.foundry.abstract = prevAbstract;
    }

    const normalizerKeys = Object.keys(applyTechniqueSystemDefaults({}).automation.empower).sort();

    assert.deepEqual(
      normalizerKeys,
      schemaKeys,
      "applyTechniqueSystemDefaults must default every automation.empower schema field " +
        "(see scripts/features/techniques/defaults.mjs) or synckit will flag unedited techniques out-of-date",
    );
  });
});

describe("technique empower helpers", () => {
  it("normalizes disabled and enabled config", () => {
    assert.equal(normalizeEmpowerConfig({})?.enabled, false);
    assert.deepEqual(
      normalizeEmpowerConfig({
        enabled: true,
        mode: "damageBonus",
        costPerStep: 2,
        formulaPerStep: "1d8",
        damageTypes: ["fire"],
        maxStepsFormula: "@cl - 5",
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      }),
      {
        enabled: true,
        mode: "damageBonus",
        costPerStep: 2,
        formulaPerStep: "1d8",
        damageTypes: ["fire"],
        maxStepsFormula: "@cl - 5",
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      },
    );
  });

  it("builds readable damage formulas", () => {
    assert.equal(buildEmpowerDamageFormula({ steps: 0, formulaPerStep: "1d6" }), "");
    assert.equal(buildEmpowerDamageFormula({ steps: 3, formulaPerStep: "1d6" }), "3d6[Empower]");
    assert.equal(buildEmpowerDamageFormula({ steps: 2, formulaPerStep: "1d8" }), "2d8[Empower]");
    assert.equal(buildEmpowerDamageFormula({ steps: 2, formulaPerStep: "1d6+1" }), "2 * (1d6+1)[Empower]");
  });

  it("computes perform DC increases by complete groups", () => {
    assert.equal(
      empowerPerformIncrease({
        steps: 5,
        performIncreaseEvery: 2,
        performIncreaseAmount: 1,
      }),
      2,
    );
    assert.equal(
      empowerPerformIncrease({
        steps: 5,
        performIncreaseEvery: 0,
        performIncreaseAmount: 1,
      }),
      0,
    );
  });

  it("knows when empower must be chosen before perform", () => {
    assert.equal(shouldPromptEmpowerBeforePerform({ performIncreaseEvery: 2 }), true);
    assert.equal(shouldPromptEmpowerBeforePerform({ performIncreaseEvery: 0 }), false);
  });

  it("builds a use context with total cost and damage formula", () => {
    assert.deepEqual(
      resolveEmpowerUse({
        config: {
          enabled: true,
          mode: "damageBonus",
          costPerStep: 1,
          formulaPerStep: "1d8",
          damageTypes: ["untyped"],
          performIncreaseEvery: 2,
          performIncreaseAmount: 1,
        },
        steps: 3,
        baseCost: 11,
      }),
      {
        steps: 3,
        extraCost: 3,
        totalCost: 14,
        damageFormula: "3d8[Empower]",
        damageTypes: ["untyped"],
        performIncrease: 1,
      },
    );
  });

  it("caps steps by formula, available chakra, and cost per step", async () => {
    assert.equal(
      await resolveEmpowerStepLimit({
        config: { maxStepsFormula: "@cl - 7", costPerStep: 1 },
        rollData: { cl: 11 },
        availableExtraChakra: 10,
      }),
      4,
    );
    assert.equal(
      await resolveEmpowerStepLimit({
        config: { maxStepsFormula: "min(@cl, 18) - 7", costPerStep: 1 },
        rollData: { cl: 11 },
        availableExtraChakra: 10,
      }),
      4,
    );
    assert.equal(
      await resolveEmpowerStepLimit({
        config: { maxStepsFormula: "", costPerStep: 2 },
        rollData: { cl: 20 },
        availableExtraChakra: 5,
      }),
      2,
    );
  });

  it("supports min/max/floor/ceil and rejects injected identifiers", async () => {
    assert.equal(
      await resolveEmpowerStepLimit({
        config: { maxStepsFormula: "max(floor(@cl / 2), ceil(3.2))", costPerStep: 1 },
        rollData: { cl: 11 },
        availableExtraChakra: 10,
      }),
      5,
    );

    const previousFlag = globalThis.__empowerExploit;
    globalThis.__empowerExploit = 0;
    try {
      assert.equal(
        await resolveEmpowerStepLimit({
          config: { maxStepsFormula: "@cl + globalThis.__empowerExploit = 1", costPerStep: 1 },
          rollData: { cl: 11 },
          availableExtraChakra: 10,
        }),
        0,
      );
      assert.equal(globalThis.__empowerExploit, 0);
    } finally {
      if (previousFlag === undefined) {
        delete globalThis.__empowerExploit;
      } else {
        globalThis.__empowerExploit = previousFlag;
      }
    }
  });
});

describe("maintenance facets", () => {
  const tech = (maintenance) => ({ name: "T", system: { automation: { maintenance } } });

  it("returns null when maintenance is disabled", () => {
    assert.equal(maintenanceFacets(tech({ enabled: false })), null);
  });

  it("reads a forced HP upkeep with no waiver/choice (Kai-Mon)", () => {
    const f = maintenanceFacets(
      tech({
        enabled: true,
        resource: "hp",
        cost: "2",
        policy: "forced",
        interval: 1,
        waiver: "",
        choice: "",
      }),
    );
    assert.deepEqual(f, {
      resource: "hp",
      cost: "2",
      policy: "forced",
      interval: 1,
      waiver: "",
      waiverStep: 2,
      freeRounds: 5,
      choice: "",
      allowStanceStacking: false,
      heal: "",
      clearConditions: [],
    });
  });

  it("reads a prompt HP upkeep with step waiver (Amatsu)", () => {
    const f = maintenanceFacets(
      tech({
        enabled: true,
        resource: "hp",
        cost: "1d4",
        policy: "prompt",
        interval: 1,
        waiver: "step",
        waiverStep: 2,
        choice: "",
      }),
    );
    assert.equal(f.waiver, "step");
    assert.equal(f.waiverStep, 2);
  });

  it("reads a no-cost mode choice (Champuru)", () => {
    const f = maintenanceFacets(tech({ enabled: true, resource: "", choice: "mode", interval: 1 }));
    assert.equal(f.resource, "");
    assert.equal(f.choice, "mode");
  });

  it("builds mode-variant buff names and resolves mode ids", () => {
    assert.equal(maintenanceModeBuffName({ name: "Champuru" }, "dex"), "Champuru (Dexterity)");
    assert.equal(maintenanceModeById("str").suffix, "Strength");
    assert.equal(maintenanceModeById("nope"), null);
  });

  it("builds a unified rank maintenance flag without storing the rank level", () => {
    assert.deepEqual(
      maintenanceBuffFlagData({
        sourceTechniqueId: "tech1",
        grantType: "paid",
        key: "KOUSOKU",
      }),
      { sourceTechniqueId: "tech1", grantType: "paid", key: "KOUSOKU" },
    );
  });
});

describe("maintenanceFacets chakraDamage", () => {
  it("surfaces resource, heal formula, and parsed clearConditions", () => {
    const technique = {
      system: {
        automation: {
          maintenance: {
            enabled: true,
            resource: "chakraDamage",
            cost: "3 - floor(@mastery / 5)",
            policy: "forced",
            interval: 1,
            heal: "2 + ceil(@mastery / 2)",
            clearConditions: "fatigued, exhausted",
          },
        },
      },
    };
    const facets = maintenanceFacets(technique);
    assert.equal(facets.resource, "chakraDamage");
    assert.equal(facets.heal, "2 + ceil(@mastery / 2)");
    assert.deepEqual(facets.clearConditions, ["fatigued", "exhausted"]);
  });

  it("defaults heal to empty and clearConditions to an empty array", () => {
    const technique = {
      system: { automation: { maintenance: { enabled: true, resource: "hp" } } },
    };
    const facets = maintenanceFacets(technique);
    assert.equal(facets.heal, "");
    assert.deepEqual(facets.clearConditions, []);
  });
});

describe("condition suppression timing", () => {
  it("clears fatigued and exhausted immediately on activation", async () => {
    const calls = [];
    const actor = {
      async setConditions(payload) {
        calls.push(payload);
      },
    };

    await applyConditionBenefits(actor, {
      clearConditions: ["fatigued", "exhausted"],
    });

    assert.deepEqual(calls, [{ fatigued: false, exhausted: false }]);
  });

  it("skips condition writes when there is nothing to clear", async () => {
    const calls = [];
    const actor = {
      async setConditions(payload) {
        calls.push(payload);
      },
    };

    await applyConditionBenefits(actor, { clearConditions: [] });

    assert.deepEqual(calls, []);
  });
});

describe("gate mastery formulas", () => {
  // Mirrors the formula strings stored on the Heal Gate technique.
  const chakraDamage = (m) => Math.max(0, 3 - Math.floor(m / 5));
  const fastHealing = (m) => 2 + Math.ceil(m / 2);

  it("chakra damage is 3 below mastery 5 and 2 at mastery 5", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(chakraDamage), [3, 3, 3, 3, 3, 2]);
  });

  it("fast healing scales 2/3/4/5 across mastery steps 0/1/3/5", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(fastHealing), [2, 3, 3, 4, 4, 5]);
  });
});

describe("maintenance element count", () => {
  const tech = (mastery, elementDoubleStep) => ({
    system: { mastery, automation: { maintenance: { element: true, elementDoubleStep } } },
  });

  it("is 1 below the double step and 2 at/above it", () => {
    assert.equal(elementCount(tech(1, 5)), 1);
    assert.equal(elementCount(tech(5, 5)), 2);
  });
});

describe("technique derived calculations", () => {
  it("computes base DCs, successes, threshold, and mastery bonuses from source fields", () => {
    const derived = computeTechniqueDerived({
      rank: 5,
      complexity: "B-Class",
      mastery: 3,
    });

    assert.equal(derived.learnDC, 19);
    assert.equal(derived.performDC, 20);
    assert.equal(derived.successes, 3);
    assert.equal(derived.skillThreshold, 4);
    assert.equal(derived.masteryPerform, 3);
    assert.equal(derived.masteryLevel, 2);
    assert.equal(derived.masterySaves, 2);
  });

  it("applies special descriptor modifiers without requiring a prepared TypeDataModel", () => {
    const derived = computeTechniqueDerived({
      rank: 4,
      complexity: "C-Class",
      descriptors: ["Hijutsu", "Combination"],
    });

    assert.equal(derived.learnDC, 22);
    assert.equal(derived.successModifier, -1);
    assert.equal(derived.successes, 1);
  });

  it("supports compact index data for browser-only threshold calculations", () => {
    const derived = computeTechniqueDerived({
      rank: "8",
      complexity: "A-Class",
    });

    assert.equal(derived.skillThreshold, 8);
  });
});

describe("weaponAttack parsing", () => {
  it("reads nested and dotted forms with nested values taking precedence", () => {
    const raw = readWeaponAttackRaw({
      system: {
        flags: {
          dictionary: {
            weaponAttack: { mode: "selected", filter: "rangedWeapon", charge: "true" },
            "weaponAttack.filter": "unarmedOnly",
            "weaponAttack.attackBonus": "@cl",
          },
        },
      },
    });

    assert.equal(raw.present, true);
    assert.deepEqual(raw.values, {
      mode: "selected",
      filter: "rangedWeapon",
      charge: "true",
      attackBonus: "@cl",
    });

    const { config, warnings } = parseWeaponAttackConfig(raw);
    assert.deepEqual(warnings, []);
    assert.deepEqual(config, {
      mode: "selected",
      filter: "rangedWeapon",
      attackBonus: "@cl",
      damageBonus: "",
      nonCritDamageBonus: "",
      damageMode: "add",
      extraAttacks: [],
      held: "",
      charge: true,
      suppressedBonuses: [],
    });
  });

  it("reports invalid fields while returning a usable fallback config", () => {
    const { config, warnings } = parseWeaponAttackConfig({
      values: { mode: "selected", filter: "badFilter", charge: "sometimes" },
      keys: new Set(["mode", "filter", "charge", "extra"]),
      malformed: false,
    });

    assert.equal(config.filter, "meleeWeapon");
    assert.equal(config.charge, false);
    assert.ok(warnings.some((w) => w.includes("unknown field")));
    assert.ok(warnings.some((w) => w.includes("unsupported")));
    assert.ok(warnings.some((w) => w.includes("should be")));
  });
});

describe("descriptor-driven attack categories", () => {
  it("treats kick/punch variants as unarmed only", () => {
    for (const d of ["Kick or Punch", "Kick", "Punch", "Punch or Kick"]) {
      assert.deepEqual(
        deriveAttackCategories([d]),
        { allowUnarmed: true, allowArmed: false },
        `descriptor ${d}`,
      );
    }
  });

  it("treats Armed as weapon only", () => {
    assert.deepEqual(deriveAttackCategories(["Armed"]), {
      allowUnarmed: false,
      allowArmed: true,
    });
  });

  it("treats Armed or Punch as both", () => {
    assert.deepEqual(deriveAttackCategories(["Armed or Punch"]), {
      allowUnarmed: true,
      allowArmed: true,
    });
  });

  it("combines an unarmed descriptor with Armed", () => {
    assert.deepEqual(deriveAttackCategories(new Set(["Punch", "Armed"])), {
      allowUnarmed: true,
      allowArmed: true,
    });
  });

  it("is case-insensitive and ignores unrelated descriptors", () => {
    assert.deepEqual(deriveAttackCategories(["fire", "kick or punch"]), {
      allowUnarmed: true,
      allowArmed: false,
    });
  });

  it("gives no signal when no attack descriptor is present", () => {
    assert.deepEqual(deriveAttackCategories(["Fire", "Wind"]), {
      allowUnarmed: false,
      allowArmed: false,
    });
    assert.deepEqual(deriveAttackCategories([]), {
      allowUnarmed: false,
      allowArmed: false,
    });
    assert.deepEqual(deriveAttackCategories(undefined), {
      allowUnarmed: false,
      allowArmed: false,
    });
  });
});

describe("learning calculations", () => {
  it("computes target progress and max attempts from simple actor data", () => {
    const item = { system: { rank: 3, derived: { successes: 2 } } };
    const actor = {
      system: {
        abilities: { wis: { mod: 2 } },
        skills: { nin: { ability: "wis", rank: 5 } },
      },
    };

    assert.equal(getLearningTargetProgress(item, LEARNING_MODES.STANDARD), 2);
    assert.equal(getLearningTargetProgress(item, LEARNING_MODES.FOUR_HOUR_BLOCKS), 12);
    assert.equal(getLearningMaxAttempts(actor, "nin"), 5);
  });

  it("uses the best base discipline skill for Hachimon Tonkou learning", () => {
    globalThis.game.i18n = {
      localize: (key) => key,
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
    };

    const actor = {
      flags: {
        "naruto-d20": {
          learn: {
            ckc: {
              base: 8,
              abilityMod: 1,
              abilityLabel: "Wis",
              buffBonus: 9,
              synergyBonus: 2,
              miscBonus: 3,
            },
            fui: { base: 8, abilityMod: 2, abilityLabel: "Int" },
            gnj: { base: 8, abilityMod: 0, abilityLabel: "Cha" },
            nin: {
              base: 8,
              abilityMod: 2,
              abilityLabel: "Int",
              conditional: 3,
            },
            tai: {
              base: 8,
              abilityMod: 4,
              abilityLabel: "Str",
              buffBonus: 4,
              synergyBonus: 2,
              miscBonus: 1,
            },
          },
        },
      },
      sourceInfo: {},
      system: {
        abilities: {
          cha: { mod: 0 },
          int: { mod: 2 },
          str: { mod: 4 },
          wis: { mod: 1 },
        },
        skills: {
          ckc: { ability: "wis", rank: 9 },
          fui: { ability: "int", rank: 4 },
          gnj: { ability: "cha", rank: 4 },
          nin: { ability: "int", rank: 4 },
          tai: { ability: "str", rank: 4 },
        },
      },
      items: [
        {
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 50 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "wrist", type: 3, rankPenalty: 3, learnBonus: 3 },
            },
          },
        },
      ],
    };
    const item = {
      system: {
        discipline: "Hachimon Tonkou",
        flags: {
          dictionary: {},
        },
      },
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "KOUSOKU",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    const resolution = getTechniqueLearningResolution(item, actor);

    assert.equal(resolution.discipline, "Hachimon Tonkou");
    assert.equal(resolution.skillKey, "tai");
    assert.equal(resolution.hachimonTonkou, true);
    assert.deepEqual(
      buildLearnCheckBreakdown(actor, resolution.skillKey, {
        item,
        includeConditional: true,
        hachimonTonkou: true,
      }).parts,
      [
        "8[NarutoD20.Breakdown.CharacterLevel]",
        "4[Str]",
        "1[NarutoD20.Breakdown.MiscBonus]",
      ],
    );
    assert.equal(buildLearningView(item, null, LEARNING_MODES.STANDARD).effectivelyLearned, false);
  });

  it("resolves a four-hour-block success without Foundry documents", () => {
    const item = {
      system: {
        rank: 2,
        derived: { successes: 3, learnDC: 15 },
      },
    };
    const actor = {
      flags: { "naruto-d20": { chakra: { pool: { max: 20 } } } },
      system: {
        abilities: { int: { mod: 1 } },
        skills: { nin: { rank: 4 } },
      },
    };

    const result = buildLearnAttemptResult(item, actor, {
      skillKey: "nin",
      mode: LEARNING_MODES.FOUR_HOUR_BLOCKS,
      baseLearning: {
        progress: 2,
        attemptsUsed: 1,
        failureInsight: 1,
        trainingBlocks: 2,
        chakraSpent: 16,
      },
      total: 30,
      apBonus: 0,
    });

    assert.equal(result.success, true);
    assert.equal(result.award, 4);
    assert.equal(result.progress, 6);
    assert.equal(result.targetProgress, 12);
    assert.equal(result.trainingBlocks, 1);
    assert.equal(result.chakraCost, 8);
    assert.equal(result.nextFailureInsight, 1);
    assert.equal(result.learned, false);
  });
});

describe("chakra spending", () => {
  it("spends temp before pool and triggers emergency reserve transfer", () => {
    const actor = {
      flags: {
        "naruto-d20": {
          chakra: {
            pool: { temp: 2, value: 3 },
            reserve: { value: 4 },
          },
        },
      },
    };

    assert.equal(canPayChakra(actor, 5), true);
    assert.equal(canPayChakra(actor, 6), false);
    assert.deepEqual(calculateChakraSpend(actor, 5), {
      temp: 0,
      pool: 1,
      reserve: 0,
      fromTemp: 2,
      fromPool: 3,
      summary: "2 temp, 3 pool",
    });
  });
});

describe("chakra condition state", () => {
  const baseState = {
    reserveValue: 10,
    reserveMax: 20,
    poolValue: 20,
    poolMax: 20,
    depletionActive: false,
    lowReserveFatiguePending: false,
  };

  it("delays low-reserve fatigue during combat above the quarter threshold", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 8,
        inCombat: true,
      }),
      {
        wantsLowReserves: true,
        wantsDepletion: false,
        wantsFatigued: false,
        wantsExhausted: false,
        depletionActive: false,
        lowReserveFatiguePending: true,
      },
    );
  });

  it("applies low-reserve fatigue immediately below the quarter threshold even in combat", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 4,
        inCombat: true,
      }),
      {
        wantsLowReserves: true,
        wantsDepletion: false,
        wantsFatigued: true,
        wantsExhausted: false,
        depletionActive: false,
        lowReserveFatiguePending: false,
      },
    );
  });

  it("keeps depletion active until reserve and pool are fully recovered", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 12,
        poolValue: 19,
        depletionActive: true,
      }),
      {
        wantsLowReserves: false,
        wantsDepletion: true,
        wantsFatigued: true,
        wantsExhausted: false,
        depletionActive: true,
        lowReserveFatiguePending: false,
      },
    );
  });

  it("clears depletion only when reserve and pool are both full", () => {
    assert.deepEqual(
      resolveChakraConditionState({
        ...baseState,
        reserveValue: 20,
        depletionActive: true,
      }),
      {
        wantsLowReserves: false,
        wantsDepletion: false,
        wantsFatigued: false,
        wantsExhausted: false,
        depletionActive: false,
        lowReserveFatiguePending: false,
      },
    );
  });

  it("tags module-created PF1e fatigue effects", async () => {
    let conditionUpdate = null;
    let actor = null;
    actor = {
      type: "character",
      flags: {
        "naruto-d20": {
          chakra: {
            pool: { value: 20, max: 20 },
            reserve: { value: 4, max: 20 },
          },
          conditions: {},
        },
      },
      statuses: new Set(),
      effects: [],
      getCombatants: () => [],
      async setConditions(updates) {
        conditionUpdate = updates.fatigued;
        return updates;
      },
      async update() {},
      async deleteEmbeddedDocuments() {},
    };

    await checkAndUpdateConditions(actor);

    assert.equal(conditionUpdate.flags["naruto-d20"].conditionOwner, true);
    assert.equal(conditionUpdate.flags["naruto-d20"].conditionStatus, "fatigued");
  });

  it("removes only tagged module-owned PF1e fatigue effects", async () => {
    const deletedEffectIds = [];
    const actor = {
      type: "character",
      flags: {
        "naruto-d20": {
          chakra: {
            pool: { value: 20, max: 20 },
            reserve: { value: 20, max: 20 },
          },
          conditions: {
            appliedFatigued: true,
          },
        },
      },
      statuses: new Set(["fatigued"]),
      effects: [
        {
          id: "external-fatigued",
          statuses: new Set(["fatigued"]),
          flags: {},
        },
        {
          id: "module-fatigued",
          statuses: new Set(["fatigued"]),
          flags: {
            "naruto-d20": {
              conditionOwner: true,
              conditionStatus: "fatigued",
            },
          },
        },
      ],
      getCombatants: () => [],
      async setConditions(updates) {
        assert.notEqual(updates.fatigued, false);
        return updates;
      },
      async update() {},
      async deleteEmbeddedDocuments(type, ids) {
        assert.equal(type, "ActiveEffect");
        deletedEffectIds.push(...ids);
      },
    };

    await checkAndUpdateConditions(actor);

    assert.deepEqual(deletedEffectIds, ["module-fatigued"]);
  });

  it("clears stale fatigue ownership when only an external effect remains", async () => {
    const deletedEffectIds = [];
    const actorUpdates = [];
    const actor = {
      type: "character",
      flags: {
        "naruto-d20": {
          chakra: {
            pool: { value: 20, max: 20 },
            reserve: { value: 4, max: 20 },
          },
          conditions: {
            appliedFatigued: true,
          },
        },
      },
      statuses: new Set(["fatigued"]),
      effects: [
        {
          id: "external-fatigued",
          statuses: new Set(["fatigued"]),
          flags: {},
        },
      ],
      getCombatants: () => [],
      async setConditions(updates) {
        assert.deepEqual(updates.fatigued, {
          flags: {
            "naruto-d20": {
              conditionOwner: true,
              conditionStatus: "fatigued",
            },
          },
        });
        return {};
      },
      async update(update) {
        actorUpdates.push(update);
      },
      async deleteEmbeddedDocuments(type, ids) {
        assert.equal(type, "ActiveEffect");
        deletedEffectIds.push(...ids);
      },
    };

    await checkAndUpdateConditions(actor);

    assert.deepEqual(deletedEffectIds, []);
    assert.equal(actorUpdates.length, 1);
    assert.equal(actorUpdates[0]["flags.naruto-d20.conditions.appliedFatigued"], false);
  });

  it("clears stale fatigue ownership after recovery without deleting a sole external fatigue effect", async () => {
    const deletedEffectIds = [];
    const actorUpdates = [];
    const actor = {
      type: "character",
      flags: {
        "naruto-d20": {
          chakra: {
            pool: { value: 20, max: 20 },
            reserve: { value: 20, max: 20 },
          },
          conditions: {
            appliedFatigued: true,
          },
        },
      },
      statuses: new Set(["fatigued"]),
      effects: [
        {
          id: "external-fatigued",
          statuses: new Set(["fatigued"]),
          flags: {},
        },
      ],
      getCombatants: () => [],
      async setConditions(updates) {
        assert.equal(Object.hasOwn(updates, "fatigued"), false);
        return updates;
      },
      async update(update) {
        actorUpdates.push(update);
      },
      async deleteEmbeddedDocuments(type, ids) {
        assert.equal(type, "ActiveEffect");
        deletedEffectIds.push(...ids);
      },
    };

    await checkAndUpdateConditions(actor);

    assert.deepEqual(deletedEffectIds, []);
    assert.equal(actorUpdates.length, 1);
    assert.equal(actorUpdates[0]["flags.naruto-d20.conditions.appliedFatigued"], false);
  });

  it("registers deleteCombat and reruns condition checks once per unique owned actor", async () => {
    const originalHooks = globalThis.Hooks;
    const registered = [];
    globalThis.Hooks = {
      on(event, handler) {
        registered.push({ event, handler });
      },
    };

    try {
      registerChakraConditionCombatHooks();

      assert.equal(registered.length, 1);
      assert.equal(registered[0].event, "deleteCombat");

      const calls = [];
      const makeActor = (id, isSelf) => ({
        id,
        type: "character",
        activeOwner: { isSelf },
        flags: {
          "naruto-d20": {
            chakra: {
              pool: { value: 20, max: 20 },
              reserve: { value: 20, max: 20 },
            },
            conditions: {},
          },
        },
        effects: [],
        getCombatants: () => [],
        async setConditions() {
          calls.push(id);
          return {};
        },
        async update() {},
        async deleteEmbeddedDocuments() {},
      });

      const actorA = makeActor("actor-a", true);
      const actorB = makeActor("actor-b", true);
      const actorC = makeActor("actor-c", false);

      await registered[0].handler({
        combatants: [
          { actor: actorA },
          { actor: actorA },
          { actor: actorB },
          { actor: actorC },
          { actor: null },
          {},
        ],
      });

      assert.deepEqual(calls, ["actor-a", "actor-b"]);
    } finally {
      globalThis.Hooks = originalHooks;
    }
  });
});

describe("chakra rest recovery", () => {
  function makeRestActor({
    poolValue,
    poolMax = 20,
    reserveValue = 0,
    reserveMax = 20,
    hdTotal = 6,
  }) {
    const updates = [];
    return {
      actor: {
        type: "character",
        flags: {
          "naruto-d20": {
            chakra: {
              pool: { value: poolValue, max: poolMax, temp: 3 },
              reserve: { value: reserveValue, max: reserveMax },
            },
          },
        },
        statuses: new Set(["chakraDepletion"]),
        system: {
          attributes: {
            hd: { total: hdTotal },
          },
        },
        update(update) {
          updates.push(update);
          return new Promise(() => {});
        },
      },
      updates,
    };
  }

  it("adds one quarter of max pool during normal rest while depleted", () => {
    const { actor, updates } = makeRestActor({ poolValue: 6 });

    onActorRest(actor, { restoreDailyUses: true, restoreHealth: false, longTermCare: false });

    assert.equal(updates.length, 1);
    assert.equal(updates[0]["flags.naruto-d20.chakra.pool.temp"], 0);
    assert.equal(updates[0]["flags.naruto-d20.chakra.pool.value"], 11);
  });

  it("adds half max pool during long-term care while depleted", () => {
    const { actor, updates } = makeRestActor({ poolValue: 6 });

    onActorRest(actor, { restoreDailyUses: true, restoreHealth: false, longTermCare: true });

    assert.equal(updates.length, 1);
    assert.equal(updates[0]["flags.naruto-d20.chakra.pool.value"], 16);
  });

  it("caps depleted recovery at pool max", () => {
    const { actor, updates } = makeRestActor({ poolValue: 18 });

    onActorRest(actor, { restoreDailyUses: true, restoreHealth: false, longTermCare: false });

    assert.equal(updates.length, 1);
    assert.equal(updates[0]["flags.naruto-d20.chakra.pool.value"], 20);
  });
});

describe("chakra damage", () => {
  const make = (temp, value) => ({
    flags: { "naruto-d20": { chakra: { pool: { temp, value }, reserve: { value: 9 } } } },
  });

  it("absorbs from temp before pool with no HP overflow", () => {
    assert.deepEqual(calculateChakraDamage(make(2, 3), 4), {
      temp: 0,
      pool: 1,
      absorbed: 4,
      hpOverflow: 0,
      fromTemp: 2,
      fromPool: 2,
    });
  });

  it("doubles the unabsorbed remainder into HP overflow", () => {
    // pool 1 absorbs 1 of 3; remainder 2 * 2 = 4 HP
    assert.deepEqual(calculateChakraDamage(make(0, 1), 3), {
      temp: 0,
      pool: 0,
      absorbed: 1,
      hpOverflow: 4,
      fromTemp: 0,
      fromPool: 1,
    });
  });

  it("doubles the full amount against an empty pool", () => {
    assert.deepEqual(calculateChakraDamage(make(0, 0), 3), {
      temp: 0,
      pool: 0,
      absorbed: 0,
      hpOverflow: 6,
      fromTemp: 0,
      fromPool: 0,
    });
  });

  it("never reads or writes the reserve", () => {
    const result = calculateChakraDamage(make(0, 0), 2);
    assert.equal("reserve" in result, false);
    assert.equal(result.hpOverflow, 4);
  });

  it("treats a zero / negative amount as no damage", () => {
    assert.deepEqual(calculateChakraDamage(make(0, 5), 0), {
      temp: 0,
      pool: 5,
      absorbed: 0,
      hpOverflow: 0,
      fromTemp: 0,
      fromPool: 0,
    });
  });
});

describe("temporary chakra buff grants", () => {
  it("registers a dedicated buff target for temporary chakra", () => {
    assert.equal(BUFF_TARGETS.temporaryChakra.label, "NarutoD20.BuffTargets.TemporaryChakra");
  });

  it("extracts a flat temporary chakra grant from buff changes", () => {
    assert.equal(
      extractTemporaryChakraGrant([
        { target: "temporaryChakra", operator: "add", formula: "8" },
        { target: "str", operator: "add", formula: "4" },
      ]),
      8,
    );
  });

  it("spends granted temporary chakra before leaving leftover removal on the buff", () => {
    assert.deepEqual(
      allocateTemporaryChakraGrantSpend(
        [
          { id: "buffA", flags: { "naruto-d20": { temporaryChakra: { remaining: 8 } } } },
          { id: "buffB", flags: { "naruto-d20": { temporaryChakra: { remaining: 3 } } } },
        ],
        9,
      ),
      {
        updates: [
          { _id: "buffA", "flags.naruto-d20.temporaryChakra.remaining": 0 },
          { _id: "buffB", "flags.naruto-d20.temporaryChakra.remaining": 2 },
        ],
        remaining: 0,
      },
    );
  });
});

describe("Life Gate source data", () => {
  it("uses forced hp upkeep with mastery-based damage reduction", () => {
    const technique = readJson(
      new URL(
        "../packs/_source/techniques/SEI_MON_KAI__LIFE_GATE_RELEASE__rr5ej5Vyiy2U4q7w.json",
        import.meta.url,
      ),
    );

    assert.deepEqual(technique.system.automation.maintenance, {
      enabled: true,
      resource: "hp",
      cost: "4 - floor(@mastery / 5)",
      policy: "forced",
      interval: 1,
      waiver: "",
      waiverStep: 2,
      freeRounds: 5,
      choice: "",
      element: false,
      elementDoubleStep: 5,
    });
  });

  it("grants 8 temporary chakra on the companion buff", () => {
    const buff = readJson(
      new URL(
        "../packs/_source/technique-buffs/SEI_MON_KAI__LIFE_GATE_RELEASE__2e9f4c5b8d7a0132.json",
        import.meta.url,
      ),
    );

    assert.ok(
      buff.system.changes.some(
        (change) =>
          change.target === "temporaryChakra" &&
          change.operator === "add" &&
          change.formula === "8",
      ),
    );
  });
});

describe("hp upkeep formulas", () => {
  it("evaluates hp upkeep formulas with injected mastery roll data", async () => {
    const actor = { getRollData: () => ({}) };
    const { amount } = await rollHpCost(actor, "4 - floor(@mastery / 5)", { mastery: 5 });
    assert.equal(amount, 3);
  });
});

describe("synckit normalization", () => {
  it("ignores generated ids, actor progress state, descriptor order, and missing defaults", () => {
    const embedded = {
      tag: "",
      description: { value: "<p>Text<br></p>", summary: "", instructions: "" },
      descriptors: ["Fire", "Wind"],
      actions: [
        { _id: "embedded1", name: "Action", damage: { parts: [{ _id: "part1", formula: "1d6" }] } },
      ],
      uses: {
        value: 0,
        max: 1,
        maxFormula: "1",
        per: "day",
        autoDeductChargesCost: "0",
        rechargeFormula: "",
      },
      learning: { learned: true, progress: 2 },
      mastery: 3,
      masteryLearning: {
        progress: 4,
        attemptsUsed: 1,
        failureInsight: 2,
        trainingBlocks: 8,
        chakraSpent: 16,
        lastTrainingAt: 123456,
        actionPointBonus: 1,
      },
    };
    const source = {
      description: { value: "<p>Text<br></p>" },
      descriptors: ["Wind", "Fire"],
      actions: [
        { _id: "source1", name: "Action", damage: { parts: [{ _id: "part2", formula: "1d6" }] } },
      ],
      uses: {
        value: 1,
        max: 1,
        maxFormula: "1",
        per: "day",
        autoDeductChargesCost: "0",
        rechargeFormula: "",
      },
    };

    assert.deepEqual(normalizeSystem(embedded).descriptors, ["Fire", "Wind"]);
    assert.equal(normalizeSystem(embedded).uses.value, null);
    assert.equal(normalizeSystem(embedded).masteryLearning, undefined);
    assert.equal(diffTechnique(embedded, source), true);
  });

  it("treats a no-op sheet open/close as up-to-date for techniques without maintenance automation", () => {
    // Opening a technique sheet submits the whole form on close: the DataModel
    // cleans `system.automation` and persists every schema field. A technique's
    // compendium source JSON predates the `maintenance` block and
    // only carries the top-level automation fields. The normalizer must
    // backfill the nested maintenance defaults on both sides so the diff stays
    // equal.
    const embedded = {
      description: { value: "" },
      descriptors: [],
      automation: {
        enabled: true,
        targetMode: "auto",
        maintenance: {
          enabled: false,
          resource: "",
          cost: "1d4",
          policy: "prompt",
          interval: 1,
          waiver: "",
          waiverStep: 2,
          freeRounds: 5,
          choice: "",
          heal: "",
          clearConditions: "",
          element: false,
          elementDoubleStep: 5,
        },
      },
    };
    const source = {
      description: { value: "" },
      descriptors: [],
      automation: { enabled: true, targetMode: "auto" },
    };

    assert.equal(diffTechnique(embedded, source), true);
  });

  it("still detects limited-use configuration changes", () => {
    const embedded = {
      description: { value: "" },
      descriptors: [],
      uses: {
        value: 0,
        max: 1,
        maxFormula: "1",
        per: "day",
        autoDeductChargesCost: "0",
        rechargeFormula: "",
      },
    };
    const source = {
      description: { value: "" },
      descriptors: [],
      uses: {
        value: 1,
        max: 2,
        maxFormula: "2",
        per: "day",
        autoDeductChargesCost: "0",
        rechargeFormula: "",
      },
    };

    assert.equal(diffTechnique(embedded, source), false);
  });
});

describe("maintenance migration", () => {
  it("persists prepared maintenance and deletes every legacy automation key", () => {
    assert.deepEqual(
      maintenanceMigrationPatch({
        enabled: true,
        resource: "hp",
        cost: "2",
        policy: "forced",
        interval: 1,
        waiver: "",
        waiverStep: 2,
        freeRounds: 5,
        choice: "",
        element: false,
        elementDoubleStep: 5,
      }),
      {
        "system.automation.maintenance": {
          enabled: true,
          resource: "hp",
          cost: "2",
          policy: "forced",
          interval: 1,
          waiver: "",
          waiverStep: 2,
          freeRounds: 5,
          choice: "",
          element: false,
          elementDoubleStep: 5,
        },
        "system.automation.-=stanceMode": null,
        "system.automation.-=stanceUpkeep": null,
        "system.automation.-=elementChoice": null,
        "system.automation.-=upkeepFormula": null,
        "system.automation.-=upkeepMode": null,
        "system.automation.-=upkeepWaiverStep": null,
        "system.automation.-=elementDoubleStep": null,
      },
    );
  });
});

describe("unified rank maintenance metadata", () => {
  const buff = {
    flags: {
      "naruto-d20": {
        maintenanceBuff: { key: "KOUSOKU", grantType: "bonus" },
      },
    },
    system: { level: 2 },
  };

  it("reads rank type and granted level from the unified flag", () => {
    assert.equal(getRankMaintenanceFlag(buff).key, "KOUSOKU");
    assert.equal(getRankGrantType(buff), "bonus");
    assert.equal(rankGrantLevel(buff), 2);
  });

  it("maps a legacy rankBuff payload without storing level/cost/interval", () => {
    assert.deepEqual(
      legacyRankBuffToMaintenance({
        key: "JOURYOKU",
        grantType: "paid",
        level: 3,
        cost: 3,
        interval: 5,
        sourceTechniqueId: "tech1",
      }),
      {
        key: "JOURYOKU",
        grantType: "paid",
        sourceTechniqueId: "tech1",
      },
    );
  });

  it("builds actor-owned rank maintenance from name-derived context", () => {
    assert.deepEqual(rankMaintenanceFromContext({ cost: 4, interval: 5 }), {
      enabled: true,
      resource: "chakra",
      cost: "4",
      policy: "prompt",
      interval: 5,
      waiver: "freeUse",
      waiverStep: 5,
      freeRounds: 5,
      choice: "",
      element: false,
      elementDoubleStep: 5,
    });
  });
});

describe("source JSON validation", () => {
  it("accepts a minimal valid source tree", () => {
    const { root, sourceRoot } = makeSourceRoot({
      techniques: { "technique.json": techniqueDoc() },
      feats: {
        "feat.json": {
          type: "feat",
          _id: "feat0001",
          _key: "!items!feat0001",
          name: "Test Feat",
          system: { subType: "feat" },
        },
      },
      "technique-buffs": {
        "buff.json": {
          type: "buff",
          _id: "buff0001",
          _key: "!items!buff0001",
          name: "Test Buff",
          system: { subType: "buff" },
        },
      },
      equipments: {
        "weight.json": {
          type: "loot",
          _id: "weight01",
          _key: "!items!weight01",
          name: "Wrist Weight Type I",
          system: { subType: "gear", weight: { value: 25 } },
          flags: {
            "naruto-d20": {
              trainingWeightItem: {
                slot: "wrist",
                type: 1,
                rankPenalty: 1,
                learnBonus: 1,
              },
            },
          },
        },
      },
      occupations: { "occupation.json": occupationDoc() },
      "occupations-community": {
        "community-occupation.json": occupationDoc({
          _id: "occupation02",
          name: "Community Occupation",
          occupation: { slug: "community-occupation" },
        }),
      },
    });

    const result = validateCompendia({ root, sourceRoot });

    assert.equal(result.errorCount, 0);
    assert.equal(result.failed, false);
    assert.deepEqual(
      result.counts.map((c) => [c.name, c.documents]),
      [
        ["techniques", 1],
        ["feats", 1],
        ["technique-buffs", 1],
        ["equipments", 1],
        ["occupations", 1],
        ["occupations-community", 1],
      ],
    );
  });

  it("reports structural and weaponAttack source mistakes", () => {
    const { root, sourceRoot } = makeSourceRoot({
      techniques: {
        "bad-technique.json": techniqueDoc({
          system: {
            rank: 99,
            descriptors: { not: "array" },
            flags: {
              dictionary: {
                weaponAttack: { mode: "wrong", filter: "bad", charge: "maybe", extra: "x" },
              },
            },
          },
        }),
      },
    });

    const result = validateCompendia({ root, sourceRoot });
    const messages = result.issues.map((i) => i.message);

    assert.equal(result.failed, true);
    assert.ok(messages.some((m) => m.includes("rank must be")));
    assert.ok(messages.some((m) => m.includes("system.descriptors must be an array")));
    assert.ok(messages.some((m) => m.includes("unknown weaponAttack field")));
    assert.ok(messages.some((m) => m.includes("unsupported weaponAttack.mode")));
    assert.ok(messages.some((m) => m.includes("unsupported weaponAttack.filter")));
    assert.ok(messages.some((m) => m.includes("weaponAttack.charge")));
  });

  it("reports Training Weight source mistakes", () => {
    const { root, sourceRoot } = makeSourceRoot({
      equipments: {
        "bad-weight.json": {
          type: "loot",
          _id: "badweight",
          _key: "!items!badweight",
          name: "Bad Weight",
          system: { subType: "gear", weight: { value: "25" } },
          flags: {
            "naruto-d20": {
              trainingWeightItem: {
                slot: "wrist",
                type: "1",
                rankPenalty: 1,
                learnBonus: 1,
              },
            },
          },
        },
        "wrong-table.json": {
          type: "loot",
          _id: "wrongtbl",
          _key: "!items!wrongtbl",
          name: "Wrong Table Weight",
          system: { subType: "gear", weight: { value: 25 } },
          flags: {
            "naruto-d20": {
              trainingWeightItem: {
                slot: "ankle",
                type: 2,
                rankPenalty: 1,
                learnBonus: 1,
              },
            },
          },
        },
      },
    });

    const result = validateCompendia({ root, sourceRoot });
    const messages = result.issues.map((i) => i.message);

    assert.equal(result.failed, true);
    assert.ok(messages.some((m) => m.includes("trainingWeightItem.type must be 1..8")));
    assert.ok(
      messages.some((m) => m.includes("training weight must define numeric system.weight.value")),
    );
    assert.ok(messages.some((m) => m.includes("training weight type 2 must weigh 37.5")));
    assert.ok(
      messages.some((m) => m.includes("trainingWeightItem.rankPenalty for type 2 must be 2")),
    );
    assert.ok(
      messages.some((m) => m.includes("trainingWeightItem.learnBonus for type 2 must be 2")),
    );
  });

  it("reports Occupation source mistakes", () => {
    const { root, sourceRoot } = makeSourceRoot({
      techniques: { "technique.json": techniqueDoc() },
      feats: {
        "feat.json": {
          type: "feat",
          _id: "feat0001",
          _key: "!items!feat0001",
          name: "Test Feat",
          system: { subType: "feat" },
        },
      },
      occupations: {
        "bad-occupation.json": occupationDoc({
          occupation: {
            slug: "",
            featOptions: ["Missing Feat"],
            techniqueOptions: ["Missing Technique"],
          },
        }),
      },
    });

    const result = validateCompendia({ root, sourceRoot });
    const messages = result.issues.map((i) => i.message);

    assert.equal(result.failed, true);
    assert.ok(messages.some((m) => m.includes("occupation.slug is required")));
    assert.ok(messages.some((m) => m.includes("occupation feat option not found: Missing Feat")));
    assert.ok(
      messages.some((m) => m.includes("occupation technique option not found: Missing Technique")),
    );
  });

  it("reports invalid damage empower config", () => {
    const { root, sourceRoot } = makeSourceRoot({
      techniques: {
        "bad-empower.json": techniqueDoc({
          system: {
            automation: {
              empower: {
                enabled: true,
                mode: "unknown",
                costPerStep: 0,
                formulaPerStep: "",
                damageTypes: "fire",
                performIncreaseEvery: -1,
                performIncreaseAmount: -1,
              },
            },
          },
        }),
      },
    });

    const result = validateCompendia({ root, sourceRoot });
    const messages = result.issues.map((i) => i.message);

    assert.equal(result.failed, true);
    assert.ok(messages.some((m) => m.includes("unsupported automation.empower.mode")));
    assert.ok(messages.some((m) => m.includes("automation.empower.costPerStep")));
    assert.ok(messages.some((m) => m.includes("automation.empower.formulaPerStep")));
    assert.ok(messages.some((m) => m.includes("automation.empower.damageTypes")));
    assert.ok(messages.some((m) => m.includes("automation.empower.performIncreaseEvery")));
    assert.ok(messages.some((m) => m.includes("automation.empower.performIncreaseAmount")));
  });

  it("accepts advanced bloodline feat options when matching feats exist", () => {
    const { root, sourceRoot } = makeSourceRoot({
      techniques: { "technique.json": techniqueDoc() },
      feats: {
        "bloodline.json": {
          type: "feat",
          _id: "feat0002",
          _key: "!items!feat0002",
          name: "Advanced Bloodline (Byakugan)",
          system: { subType: "feat" },
        },
      },
      occupations: {
        "good-occupation.json": occupationDoc({
          occupation: {
            featOptions: ["Advanced Bloodline (Byakugan)"],
            manualFeatOptions: [],
            techniqueOptions: [],
          },
        }),
      },
    });

    const result = validateCompendia({ root, sourceRoot });

    assert.equal(result.failed, false);
    assert.deepEqual(result.issues, []);
  });
});

describe("maintenance duration model", () => {
  it("treats finite round durations as finite", () => {
    assert.equal(isFiniteRoundDuration({ units: "round", value: "5" }), true);
    assert.equal(isFiniteRoundDuration({ units: "round", value: 5 }), true);
  });

  it("rejects non-round, zero, missing, or non-finite durations", () => {
    assert.equal(isFiniteRoundDuration(null), false);
    assert.equal(isFiniteRoundDuration({ units: "inst" }), false);
    assert.equal(isFiniteRoundDuration({ units: "round", value: "0" }), false);
    assert.equal(isFiniteRoundDuration({ units: "round", value: "" }), false);
    assert.equal(isFiniteRoundDuration({ units: "minute", value: "5" }), false);
  });

  it("resolves model from facets + duration", () => {
    const facets = { resource: "hp" };
    assert.equal(resolveMaintenanceModel(facets, { units: "round", value: "5" }), "duration");
    assert.equal(resolveMaintenanceModel(facets, { units: "inst" }), "toggle");
    assert.equal(resolveMaintenanceModel(facets, null), "toggle");
    assert.equal(resolveMaintenanceModel(null, { units: "round", value: "5" }), null);
  });

  it("computes rounds remaining as total - (current - start)", () => {
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 1 }), 5);
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 2 }), 4);
    assert.equal(maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 6 }), 0);
    assert.equal(
      maintenanceRoundsRemaining({ totalRounds: 5, startRound: 1, currentRound: 7 }),
      -1,
    );
  });

  it("treats a null startRound as not-yet-started (full duration remaining)", () => {
    assert.equal(
      maintenanceRoundsRemaining({ totalRounds: 5, startRound: null, currentRound: 3 }),
      5,
    );
  });

  it("charges upkeep only while rounds remain, on interval, once per round", () => {
    // round 2, interval 1, not yet charged this round -> charge
    assert.equal(
      shouldChargeUpkeep({
        remaining: 4,
        currentRound: 2,
        startRound: 1,
        interval: 1,
        lastUpkeepRound: 1,
      }),
      true,
    );
    // already charged this round -> skip
    assert.equal(
      shouldChargeUpkeep({
        remaining: 4,
        currentRound: 2,
        startRound: 1,
        interval: 1,
        lastUpkeepRound: 2,
      }),
      false,
    );
    // ending turn (remaining 0) -> skip (teardown handles it)
    assert.equal(
      shouldChargeUpkeep({
        remaining: 0,
        currentRound: 6,
        startRound: 1,
        interval: 1,
        lastUpkeepRound: 5,
      }),
      false,
    );
    // interval 2: charged at round 1, next charge at round 3 (since (3-1) % 2 === 0)
    assert.equal(
      shouldChargeUpkeep({
        remaining: 3,
        currentRound: 3,
        startRound: 1,
        interval: 2,
        lastUpkeepRound: 1,
      }),
      true,
    );
    // interval 2: charged at round -1, next charge at round 1 (since (1-0) % 2 !== 0), then round 2 (since (2-0) % 2 === 0)
    assert.equal(
      shouldChargeUpkeep({
        remaining: 4,
        currentRound: 2,
        startRound: 0,
        interval: 2,
        lastUpkeepRound: -1,
      }),
      true,
    );
  });

  it("stamps the duration model fields into the flag payload", () => {
    const flag = maintenanceBuffFlagData({
      sourceTechniqueId: "abc",
      model: "duration",
      totalRounds: 5,
      startRound: 1,
      interval: 1,
    });
    assert.deepEqual(flag, {
      sourceTechniqueId: "abc",
      model: "duration",
      totalRounds: 5,
      startRound: 1,
      interval: 1,
      lastUpkeepRound: 1,
    });
  });

  it("omits duration-model fields for toggle buffs", () => {
    const flag = maintenanceBuffFlagData({ sourceTechniqueId: "abc", modeId: "dex" });
    assert.deepEqual(flag, { sourceTechniqueId: "abc", modeId: "dex" });
  });
});

describe("strength rank combat bonus", () => {
  // `formula` is a pre-resolved numeric value here: in production resolveCombatValue
  // evaluates @item.strRank.combat against the buff roll data via RollPF, which is
  // unavailable in the Node test environment, so the helper falls back to Number(formula).
  const change = ({ target, formula = 2, flavor = "JOURYOKU" }) => ({
    target,
    formula,
    flavor,
    type: "untyped",
    operator: "add",
  });

  it("adds combat bonus to Strength-based attack rolls only", () => {
    // actorChanges (source) and changes (per-roll output) are always distinct objects in
    // production — the hook reads actor.changes and pushes retargeted copies into the roll array.
    const actorChanges = [
      change({ target: "strRankCombat" }),
      change({ target: "strChecks", formula: 4 }),
    ];

    const changes = [];
    applyStrengthRankCombatToAttack(
      { actionType: "mwak", ability: { attack: "str" } },
      changes,
      actorChanges,
    );
    assert.deepEqual(
      changes.map((c) => c.target),
      ["attack"],
    );
    assert.equal(changes[0].value, 2);
    // source collection is left untouched
    assert.equal(
      actorChanges.find((c) => c.target === "attack"),
      undefined,
    );

    const dexChanges = [];
    applyStrengthRankCombatToAttack(
      { actionType: "rwak", ability: { attack: "dex" } },
      dexChanges,
      [change({ target: "strRankCombat" })],
    );
    assert.equal(dexChanges.length, 0);

    const cmbChanges = [];
    applyStrengthRankCombatToAttack(
      { actionType: "mcman", ability: { attack: "str" } },
      cmbChanges,
      [change({ target: "strRankCombat" })],
    );
    assert.equal(cmbChanges.length, 0);
  });

  it("reads Strength Rank combat changes from PF1e actor change collections", () => {
    const changes = [];
    const actorChanges = new Map([["buff-change-id", change({ target: "strRankCombat" })]]);

    applyStrengthRankCombatToAttack(
      { actionType: "mwak", ability: { attack: "str" } },
      changes,
      actorChanges,
    );

    assert.deepEqual(
      changes.map((c) => c.target),
      ["attack"],
    );
    assert.equal(changes[0].value, 2);
  });

  it("scales the combat bonus by the weapon ability-damage multiplier on damage only", () => {
    const twoHanded = [];
    applyStrengthRankCombatToDamage(
      { actionType: "mwak", ability: { damage: "str" } },
      twoHanded,
      [change({ target: "strRankCombat" })],
      { ablMult: 1.5 },
    );
    assert.deepEqual(
      twoHanded.map((c) => c.target),
      ["damage"],
    );
    assert.equal(twoHanded[0].value, 3); // floor(2 * 1.5)
    assert.equal(twoHanded[0].formula, "3");

    const oneHanded = [];
    applyStrengthRankCombatToDamage(
      { actionType: "mwak", ability: { damage: "str" } },
      oneHanded,
      [change({ target: "strRankCombat" })],
      { ablMult: 1 },
    );
    assert.equal(oneHanded[0].value, 2);

    const spellChanges = [];
    applyStrengthRankCombatToDamage(
      { actionType: "msak", ability: { damage: "str" } },
      spellChanges,
      [change({ target: "strRankCombat" })],
    );
    assert.equal(spellChanges.length, 0);
  });
});

describe("speed rank attack bonus", () => {
  // `formula` is a pre-resolved numeric value (see strength rank note above).
  const change = ({ target, formula = 1, flavor = "KOUSOKU" }) => ({
    target,
    formula,
    flavor,
    type: "untyped",
    operator: "add",
  });

  it("injects the attack bonus into non-maneuver attack rolls", () => {
    for (const actionType of ["mwak", "rwak", "twak", "msak", "rsak"]) {
      const changes = [];
      applySpeedRankAttack({ actionType }, changes, [change({ target: "speedRankAttack" })]);
      assert.deepEqual(
        changes.map((c) => c.target),
        ["attack"],
        `${actionType} should get the bonus`,
      );
      assert.equal(changes[0].value, 1);
    }
  });

  it("never injects the attack bonus into combat maneuver rolls (no CMB leak)", () => {
    for (const actionType of ["mcman", "rcman"]) {
      const changes = [];
      applySpeedRankAttack({ actionType }, changes, [change({ target: "speedRankAttack" })]);
      assert.equal(changes.length, 0, `${actionType} must not get the bonus`);
    }

    // also honours the action's own isCombatManeuver flag
    const flagged = [];
    applySpeedRankAttack({ actionType: "mwak", isCombatManeuver: true }, flagged, [
      change({ target: "speedRankAttack" }),
    ]);
    assert.equal(flagged.length, 0);
  });

  it("ignores other targets and reads from the actor change collection", () => {
    const changes = [];
    const actorChanges = new Map([
      ["a", change({ target: "speedRankAttack", formula: 2 })],
      ["b", change({ target: "ac", formula: 5 })],
    ]);
    applySpeedRankAttack({ actionType: "mwak" }, changes, actorChanges);
    assert.deepEqual(
      changes.map((c) => c.target),
      ["attack"],
    );
    assert.equal(changes[0].value, 2);
  });
});

describe("generic attack-no-maneuver bonus", () => {
  const change = ({ target, formula = 2, flavor = "CHAMPURU" }) => ({
    target,
    formula,
    flavor,
    type: "untyped",
    operator: "add",
  });

  it("injects a flat attack bonus into non-maneuver attack rolls", () => {
    for (const actionType of ["mwak", "rwak", "twak", "msak", "rsak"]) {
      const changes = [];
      applyAttackNoManeuver({ actionType }, changes, [change({ target: "attackNoManeuver" })]);
      assert.deepEqual(
        changes.map((c) => c.target),
        ["attack"],
        `${actionType} should get the bonus`,
      );
      assert.equal(changes[0].value, 2);
    }
  });

  it("never injects into combat maneuver rolls (no CMB leak)", () => {
    for (const actionType of ["mcman", "rcman"]) {
      const changes = [];
      applyAttackNoManeuver({ actionType }, changes, [change({ target: "attackNoManeuver" })]);
      assert.equal(changes.length, 0, `${actionType} must not get the bonus`);
    }
  });
});

describe("training weight state", () => {
  const learned = (name, trainingWeightTechnique) => ({
    type: "naruto-d20.technique",
    name,
    system: { learning: { learned: true } },
    flags: { "naruto-d20": { trainingWeightTechnique } },
  });

  const weight = ({ id, slot, type, rankPenalty, learnBonus, weightValue, equipped = true }) => ({
    id,
    type: "loot",
    system: {
      subType: "gear",
      quantity: 1,
      carried: true,
      equipped,
      weight: { total: weightValue },
    },
    isPhysical: true,
    isActive: equipped,
    inContainer: false,
    flags: {
      "naruto-d20": {
        trainingWeightItem: { slot, type, rankPenalty, learnBonus },
      },
    },
  });

  it("chooses the highest equipped type per slot and uses the lower full-set type for learn bonus", () => {
    const actor = {
      items: [
        weight({
          id: "w1",
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
          weightValue: 50,
        }),
        weight({
          id: "w2",
          slot: "wrist",
          type: 5,
          rankPenalty: 5,
          learnBonus: 5,
          weightValue: 75,
        }),
        weight({
          id: "a1",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
        }),
      ],
    };

    assert.deepEqual(getTrainingWeightState(actor), {
      wrist: { itemId: "w2", slot: "wrist", type: 5, rankPenalty: 5, learnBonus: 5, weight: 75 },
      ankle: { itemId: "a1", slot: "ankle", type: 2, rankPenalty: 2, learnBonus: 2, weight: 37.5 },
      hasFullSet: true,
      fullSetType: 2,
      fullSetLearnBonus: 2,
      strengthRankPenalty: 5,
      speedRankPenalty: 2,
      highestLearnedStrengthRank: 0,
      ignoredCarryWeight: 0,
    });
  });

  it("reads highest learned strength rank from explicit technique metadata", () => {
    const actor = {
      items: [
        learned("SHODAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 1,
        }),
        learned("SANDAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        }),
        learned("NINJOURYOKU NO JUTSU", {
          eligibleRankKey: "",
          learnedStrengthRank: 0,
        }),
      ],
    };

    assert.equal(getHighestLearnedStrengthRank(actor), 3);
  });

  it("infers learned strength rank from legacy JOURYOKU techniques without metadata", () => {
    const actor = {
      items: [
        {
          name: "SHODAN JOURYOKU (RANK ONE STRENGTH)",
          type: "naruto-d20.technique",
          system: { learning: { learned: true } },
          flags: {},
        },
        {
          name: "SANDAN JOURYOKU (RANK THREE STRENGTH)",
          type: "naruto-d20.technique",
          system: { learning: { learned: true } },
          flags: {},
        },
      ],
    };

    assert.equal(getHighestLearnedStrengthRank(actor), 3);
  });

  it("ignores carried weight for both halves when their type is at or below learned JOURYOKU rank", () => {
    const actor = {
      items: [
        learned("SANDAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        }),
        weight({
          id: "w3",
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
          weightValue: 50,
        }),
        weight({
          id: "a2",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
        }),
        weight({
          id: "w5",
          slot: "wrist",
          type: 5,
          rankPenalty: 5,
          learnBonus: 5,
          weightValue: 75,
        }),
      ],
    };

    assert.equal(getIgnoredTrainingWeightTotal(actor), 87.5);
  });

  it("ignores carried unequipped weight without applying effective automation", () => {
    const actor = {
      items: [
        learned("SANDAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        }),
        weight({
          id: "w3",
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
          weightValue: 50,
          equipped: false,
        }),
        weight({
          id: "a2",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
          equipped: false,
        }),
      ],
    };

    assert.equal(getIgnoredTrainingWeightTotal(actor), 87.5);
    assert.deepEqual(getTrainingWeightState(actor), {
      wrist: null,
      ankle: null,
      hasFullSet: false,
      fullSetType: null,
      fullSetLearnBonus: 0,
      strengthRankPenalty: 0,
      speedRankPenalty: 0,
      highestLearnedStrengthRank: 3,
      ignoredCarryWeight: 87.5,
    });
  });

  it("registers the carry patch safely when PF1 globals or converters are missing", () => {
    const originalPf1 = globalThis.pf1;
    const originalConsoleError = console.error;
    const errors = [];
    console.error = (message) => errors.push(message);

    try {
      delete globalThis.pf1;
      assert.doesNotThrow(() => registerTrainingWeightCarryPatch());
      assert.equal(
        errors.at(-1),
        "Naruto D20 | ActorPF not found — training weight carry patch skipped",
      );

      class ActorPF {
        constructor(items) {
          this.items = items;
        }

        getCarriedWeight() {
          return 100;
        }
      }

      globalThis.pf1 = { documents: { actor: { ActorPF } }, utils: {} };
      registerTrainingWeightCarryPatch();
      const actor = new ActorPF([
        learned("SANDAN JOURYOKU", {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        }),
        weight({
          id: "w3",
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
          weightValue: 50,
          equipped: false,
        }),
      ]);

      assert.equal(actor.getCarriedWeight(), 50);
    } finally {
      console.error = originalConsoleError;
      if (originalPf1 === undefined) delete globalThis.pf1;
      else globalThis.pf1 = originalPf1;
    }
  });

  it("returns a learn bonus only for explicitly eligible full-set techniques", () => {
    const actor = {
      items: [
        weight({
          id: "w4",
          slot: "wrist",
          type: 4,
          rankPenalty: 4,
          learnBonus: 4,
          weightValue: 62.5,
        }),
        weight({
          id: "a2",
          slot: "ankle",
          type: 2,
          rankPenalty: 2,
          learnBonus: 2,
          weightValue: 37.5,
        }),
      ],
    };

    assert.deepEqual(
      getTrainingWeightLearnBonus(actor, {
        flags: {
          "naruto-d20": {
            trainingWeightTechnique: {
              eligibleRankKey: "KOUSOKU",
              learnedStrengthRank: 0,
            },
          },
        },
      }),
      { value: 2, type: 2, eligibleRankKey: "KOUSOKU" },
    );

    assert.equal(
      getTrainingWeightLearnBonus(actor, {
        flags: {
          "naruto-d20": {
            trainingWeightTechnique: {
              eligibleRankKey: "",
              learnedStrengthRank: 0,
            },
          },
        },
      }),
      null,
    );
  });
});

describe("training weight learn breakdown", () => {
  it("injects the full-set bonus only for explicitly eligible techniques", () => {
    globalThis.game.i18n = {
      localize: (key) => key,
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
    };

    const actor = {
      flags: {
        "naruto-d20": {
          learn: {
            tai: {
              base: 7,
              abilityMod: 3,
              abilityLabel: "Str",
              buffBonus: 0,
              synergyBonus: 0,
              miscBonus: 0,
            },
          },
        },
      },
      sourceInfo: {},
      items: [
        {
          id: "w3",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 50 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "wrist", type: 3, rankPenalty: 3, learnBonus: 3 },
            },
          },
        },
        {
          id: "a2",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 37.5 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "ankle", type: 2, rankPenalty: 2, learnBonus: 2 },
            },
          },
        },
      ],
    };

    const eligible = {
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "KOUSOKU",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    const ineligible = {
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    assert.equal(
      buildLearnCheckBreakdown(actor, "tai", { item: eligible, includeConditional: true }).parts.at(
        -1,
      ),
      "2[NarutoD20.Breakdown.TrainingWeight]",
    );
    assert.equal(
      buildLearnCheckBreakdown(actor, "tai", {
        item: ineligible,
        includeConditional: true,
      }).parts.at(-1),
      "3[Str]",
    );
  });
});

describe("mastery check breakdown", () => {
  it("limits Hachimon mastery to base, ability, misc, and Knowledge (arcana) synergy", () => {
    globalThis.game.i18n = {
      localize: (key) => key,
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
    };

    const actor = {
      flags: {
        "naruto-d20": {
          learn: {
            tai: {
              base: 8,
              abilityMod: 4,
              abilityLabel: "Str",
              buffBonus: 6,
              synergyBonus: 2,
              miscBonus: 1,
              conditional: 3,
            },
          },
        },
      },
      sourceInfo: {},
      system: {
        skills: {
          kar: { rank: 2 },
          tai: { rank: 4 },
        },
      },
      items: [],
    };
    const item = {
      system: {
        discipline: "Hachimon Tonkou",
      },
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    assert.deepEqual(buildMasteryCheckBreakdown(actor, "tai", { item }).parts, [
      "8[NarutoD20.Breakdown.CharacterLevel]",
      "4[Str]",
      "1[NarutoD20.Breakdown.MiscBonus]",
      "2[NarutoD20.Breakdown.SkillSynergy]",
    ]);
  });

  it("adds training weight to eligible rank mastery checks only", () => {
    globalThis.game.i18n = {
      localize: (key) => key,
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
    };

    const actor = {
      flags: {
        "naruto-d20": {
          learn: {
            tai: {
              base: 7,
              abilityMod: 3,
              abilityLabel: "Str",
              buffBonus: 5,
              synergyBonus: 2,
              miscBonus: 1,
            },
          },
        },
      },
      sourceInfo: {},
      system: {
        skills: {
          kar: { rank: 0 },
          tai: { rank: 4 },
        },
      },
      items: [
        {
          id: "w3",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 50 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "wrist", type: 3, rankPenalty: 3, learnBonus: 3 },
            },
          },
        },
        {
          id: "a2",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 37.5 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "ankle", type: 2, rankPenalty: 2, learnBonus: 2 },
            },
          },
        },
      ],
    };

    const eligible = {
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "KOUSOKU",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    const ineligible = {
      flags: {
        "naruto-d20": {
          trainingWeightTechnique: {
            eligibleRankKey: "",
            learnedStrengthRank: 0,
          },
        },
      },
    };

    assert.deepEqual(buildMasteryCheckBreakdown(actor, "tai", { item: eligible }).parts, [
      "7[NarutoD20.Breakdown.CharacterLevel]",
      "3[Str]",
      "1[NarutoD20.Breakdown.MiscBonus]",
      "2[NarutoD20.Breakdown.TrainingWeight]",
    ]);
    assert.deepEqual(buildMasteryCheckBreakdown(actor, "tai", { item: ineligible }).parts, [
      "7[NarutoD20.Breakdown.CharacterLevel]",
      "3[Str]",
      "1[NarutoD20.Breakdown.MiscBonus]",
    ]);
  });

  it("adds training weight to legacy rank mastery checks without technique metadata", () => {
    globalThis.game.i18n = {
      localize: (key) => key,
      format: (key, data) => `${key}:${JSON.stringify(data)}`,
    };

    const actor = {
      flags: {
        "naruto-d20": {
          learn: {
            tai: {
              base: 7,
              abilityMod: 3,
              abilityLabel: "Str",
              buffBonus: 0,
              synergyBonus: 0,
              miscBonus: 0,
            },
          },
        },
      },
      sourceInfo: {},
      system: {
        skills: {
          kar: { rank: 0 },
          tai: { rank: 4 },
        },
      },
      items: [
        {
          id: "w3",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 50 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "wrist", type: 3, rankPenalty: 3, learnBonus: 3 },
            },
          },
        },
        {
          id: "a2",
          type: "loot",
          system: {
            subType: "gear",
            quantity: 1,
            carried: true,
            equipped: true,
            weight: { total: 37.5 },
          },
          isPhysical: true,
          isActive: true,
          inContainer: false,
          flags: {
            "naruto-d20": {
              trainingWeightItem: { slot: "ankle", type: 2, rankPenalty: 2, learnBonus: 2 },
            },
          },
        },
      ],
    };

    const legacyRankTechnique = {
      name: "SHODAN KOUSOKU (RANK ONE SPEED)",
      flags: {},
    };

    assert.deepEqual(
      buildMasteryCheckBreakdown(actor, "tai", { item: legacyRankTechnique }).parts,
      [
        "7[NarutoD20.Breakdown.CharacterLevel]",
        "3[Str]",
        "2[NarutoD20.Breakdown.TrainingWeight]",
      ],
    );
  });
});

describe("training weight rank penalties", () => {
  const activeRankBuff = ({ id, key, level }) => ({
    id,
    type: "buff",
    system: { active: true, level },
    flags: {
      "naruto-d20": {
        maintenanceBuff: { key, grantType: "paid" },
      },
    },
  });

  const weight = ({ id, slot, type, rankPenalty }) => ({
    id,
    type: "loot",
    system: {
      subType: "gear",
      quantity: 1,
      carried: true,
      equipped: true,
      weight: { total: 25 },
    },
    isPhysical: true,
    isActive: true,
    inContainer: false,
    flags: {
      "naruto-d20": {
        trainingWeightItem: { slot, type, rankPenalty, learnBonus: Math.min(type, 5) },
      },
    },
  });

  it("subtracts wrist penalties from effective JOURYOKU and ankle penalties from effective KOUSOKU", () => {
    const actor = {
      items: [
        activeRankBuff({ id: "jr5", key: "JOURYOKU", level: 5 }),
        activeRankBuff({ id: "kr4", key: "KOUSOKU", level: 4 }),
        weight({ id: "w2", slot: "wrist", type: 2, rankPenalty: 2 }),
        weight({ id: "a3", slot: "ankle", type: 3, rankPenalty: 3 }),
      ],
      statuses: new Set(),
    };

    assert.deepEqual(
      computeEffectiveRank(actor, "JOURYOKU", { rollData: { armor: { type: 0 } } }),
      {
        paid: 5,
        temp: 0,
        bonus: 0,
        penalty: 2,
        effective: 3,
        carryEffective: 5,
        carrierId: "jr5",
      },
    );

    assert.deepEqual(computeEffectiveRank(actor, "KOUSOKU", { rollData: { armor: { type: 0 } } }), {
      paid: 4,
      temp: 0,
      bonus: 0,
      penalty: 3,
      effective: 1,
      carryEffective: 4,
      carrierId: "kr4",
    });
  });
});

describe("realMaintenanceBuffDuration", () => {
  it("builds a round duration ending at turnStart with the given worldTime start", () => {
    assert.deepEqual(realMaintenanceBuffDuration({ totalRounds: 5, worldTime: 120 }), {
      units: "round",
      value: "5",
      end: "turnStart",
      start: 120,
    });
  });

  it("clamps totalRounds to at least 1", () => {
    assert.deepEqual(realMaintenanceBuffDuration({ totalRounds: 0, worldTime: 0 }), {
      units: "round",
      value: "1",
      end: "turnStart",
      start: 0,
    });
  });
});
