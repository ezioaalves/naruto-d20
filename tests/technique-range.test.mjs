import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateNarutoTechniqueRange,
  installTechniqueRangePatch,
} from "../scripts/features/techniques/range.mjs";
import { registerPf1PostInitHook } from "../scripts/lifecycle/pf1-post-init.mjs";

describe("Naruto technique range formulas", () => {
  it("uses Naruto d20 close medium and long formulas from caster level", () => {
    assert.equal(calculateNarutoTechniqueRange("close", { cl: 5 }), 20);
    assert.equal(calculateNarutoTechniqueRange("medium", { cl: 5 }), 40);
    assert.equal(calculateNarutoTechniqueRange("long", { cl: 5 }), 60);

    assert.equal(calculateNarutoTechniqueRange("close", { cl: 0 }), 10);
    assert.equal(calculateNarutoTechniqueRange("medium", { cl: 0 }), 20);
    assert.equal(calculateNarutoTechniqueRange("long", { cl: 0 }), 30);
  });

  it("falls back to zero when caster level is missing or invalid", () => {
    assert.equal(calculateNarutoTechniqueRange("close", {}), 10);
    assert.equal(calculateNarutoTechniqueRange("close", { cl: Number.NaN }), 10);
    assert.equal(calculateNarutoTechniqueRange("spec", { cl: 5 }), null);
  });
});

describe("technique range patch lifecycle", () => {
  it("installs the getRange override during pf1PostInit", () => {
    const originalHooks = globalThis.Hooks;
    const originalPf1 = globalThis.pf1;
    const originalConfig = globalThis.CONFIG;
    const originalGame = globalThis.game;
    const originalFoundry = globalThis.foundry;
    const originalRollPF = globalThis.RollPF;
    const callbacks = {};
    const baseline = () => 35;

    class ItemAction {
      getRange() {
        return baseline();
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
      globalThis.foundry = {
        utils: {
          getProperty: (object, key) => key.split(".").reduce((value, part) => value?.[part], object),
        },
      };
      globalThis.RollPF = {
        safeRollSync: (formula, rollData) => ({ total: rollData?.cl ?? 0 }),
      };
      globalThis.pf1 = {
        config: globalThis.CONFIG.PF1,
        components: { ItemAction },
        registry: {
          scriptCalls: {
            get: () => ({ itemTypes: [] }),
          },
          conditions: {
            register: () => {},
          },
        },
      };

      registerPf1PostInitHook();
      callbacks.pf1PostInit();

      const action = new ItemAction();
      action.item = {
        type: "naruto-d20.technique",
        actor: {
          system: {
            details: { level: { value: 5 } },
          },
        },
        system: {
          derived: { masteryLevel: 0 },
        },
      };
      action.range = { units: "close", value: "", maxIncrements: 1 };
      action.getRollData = () => ({ cl: 5 });

      assert.notEqual(ItemAction.prototype.getRange, baseline);
      assert.equal(action.getRange({ type: "single" }), 20);
    } finally {
      if (originalHooks === undefined) delete globalThis.Hooks;
      else globalThis.Hooks = originalHooks;
      if (originalPf1 === undefined) delete globalThis.pf1;
      else globalThis.pf1 = originalPf1;
      if (originalConfig === undefined) delete globalThis.CONFIG;
      else globalThis.CONFIG = originalConfig;
      if (originalGame === undefined) delete globalThis.game;
      else globalThis.game = originalGame;
      if (originalFoundry === undefined) delete globalThis.foundry;
      else globalThis.foundry = originalFoundry;
      if (originalRollPF === undefined) delete globalThis.RollPF;
      else globalThis.RollPF = originalRollPF;
    }
  });

  it("does not patch twice", () => {
    const originalPf1 = globalThis.pf1;

    class ItemAction {
      getRange() {
        return 0;
      }
    }

    try {
      globalThis.pf1 = { components: { ItemAction } };
      installTechniqueRangePatch();
      const once = ItemAction.prototype.getRange;
      installTechniqueRangePatch();
      assert.equal(ItemAction.prototype.getRange, once);
    } finally {
      if (originalPf1 === undefined) delete globalThis.pf1;
      else globalThis.pf1 = originalPf1;
    }
  });
});
