import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyTechniqueSystemDefaults,
  legacyAutomationToMaintenance,
} from "../scripts/data/technique-defaults.mjs";
import { maintenanceMigrationPatch } from "../scripts/data/maintenance-migration.mjs";
import { computeTechniqueDerived } from "../scripts/data/technique-model.mjs";
import { calculateChakraSpend, canPayChakra } from "../scripts/data/chakra-spend.mjs";
import {
  getRankMaintenanceFlag,
  maintenanceBuffFlagData,
  maintenanceFacets,
  maintenanceModeBuffName,
  maintenanceModeById,
} from "../scripts/automation/maintenance-buffs.mjs";
import { getRankGrantType, rankGrantLevel } from "../scripts/automation/rank-buffs.mjs";
import {
  legacyRankBuffToMaintenance,
  rankMaintenanceFromContext,
} from "../scripts/data/maintenance-migration.mjs";
import { elementCount } from "../scripts/automation/maintenance-element-damage.mjs";
import { diffTechnique, normalizeSystem } from "../scripts/automation/technique-sync.mjs";
import {
  LEARNING_MODES,
  buildLearnAttemptResult,
  getLearningMaxAttempts,
  getLearningTargetProgress,
} from "../scripts/learn-technique.mjs";
import {
  deriveAttackCategories,
  parseWeaponAttackConfig,
  readWeaponAttackRaw,
} from "../scripts/ui/technique-weapon-attack.mjs";
import { validateCompendia } from "../tools/validate-compendia.mjs";

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

function makeSourceRoot(filesByPack) {
  const root = mkdtempSync(join(tmpdir(), "naruto-d20-tests-"));
  const sourceRoot = join(root, "packs/_source");
  for (const pack of ["techniques", "feats", "technique-buffs"]) {
    mkdirSync(join(sourceRoot, pack), { recursive: true });
  }
  for (const [pack, files] of Object.entries(filesByPack)) {
    for (const [filename, data] of Object.entries(files)) {
      writeJson(join(sourceRoot, pack, filename), data);
    }
  }
  return { root, sourceRoot };
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
      summary: "2 temp, 3 pool",
    });
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
    assert.deepEqual(
      rankMaintenanceFromContext({ cost: 4, interval: 5 }),
      {
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
      },
    );
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
});
