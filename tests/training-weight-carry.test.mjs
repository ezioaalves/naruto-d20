import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerPf1PostInitHook } from "../scripts/lifecycle/pf1-post-init.mjs";

function learnedStrengthRankTechnique() {
  return {
    type: "naruto-d20.technique",
    name: "SANDAN JOURYOKU",
    system: { learning: { learned: true } },
    flags: {
      "naruto-d20": {
        trainingWeightTechnique: {
          eligibleRankKey: "JOURYOKU",
          learnedStrengthRank: 3,
        },
      },
    },
  };
}

function trainingWeight() {
  return {
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
        trainingWeightItem: {
          slot: "wrist",
          type: 3,
          rankPenalty: 3,
          learnBonus: 3,
        },
      },
    },
  };
}

describe("training weight carry lifecycle", () => {
  it("installs the carried-weight patch during pf1PostInit before actor data is prepared", () => {
    const originalHooks = globalThis.Hooks;
    const originalPf1 = globalThis.pf1;
    const originalConfig = globalThis.CONFIG;
    const originalGame = globalThis.game;
    const callbacks = {};

    class ActorPF {
      constructor(items) {
        this.items = items;
      }

      getCarriedWeight() {
        return 100;
      }
    }

    try {
      globalThis.Hooks = {
        once: (name, callback) => {
          callbacks[name] = callback;
        },
        on: () => {},
      };
      globalThis.CONFIG = {
        PF1: {
          buffTargetCategories: {},
          buffTargets: {},
          skills: {},
          weaponGroups: {},
          weaponProficiencies: {},
          weaponTypes: {},
        },
      };
      globalThis.game = {
        i18n: {
          localize: (key) => key,
        },
      };
      globalThis.pf1 = {
        config: globalThis.CONFIG.PF1,
        components: {},
        documents: { actor: { ActorPF } },
        registry: {
          scriptCalls: {
            get: () => ({ itemTypes: [] }),
          },
          conditions: {
            register: () => {},
          },
        },
        utils: {
          convertWeight: (value) => value,
        },
      };

      registerPf1PostInitHook();
      callbacks.pf1PostInit();

      const actor = new ActorPF([learnedStrengthRankTechnique(), trainingWeight()]);

      assert.equal(actor.getCarriedWeight(), 50);
    } finally {
      if (originalHooks === undefined) delete globalThis.Hooks;
      else globalThis.Hooks = originalHooks;
      if (originalPf1 === undefined) delete globalThis.pf1;
      else globalThis.pf1 = originalPf1;
      if (originalConfig === undefined) delete globalThis.CONFIG;
      else globalThis.CONFIG = originalConfig;
      if (originalGame === undefined) delete globalThis.game;
      else globalThis.game = originalGame;
    }
  });
});
