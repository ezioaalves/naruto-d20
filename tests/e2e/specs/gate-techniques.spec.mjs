import { test, expect } from "../fixtures.mjs";

const KAI = "KAI-MON KAI (INITIAL GATE RELEASE)";
const KYU = "KYU-MON KAI (HEAL GATE RELEASE)";
const SEI = "SEI-MON KAI (LIFE GATE RELEASE)";

/**
 * Add a gate technique to the disposable fixture clone, learned and ready to
 * perform. Mastery stays 0 so the upkeep formulas keep their baseline values;
 * perform success is forced at call sites with { forceRoll: 20, rollBonus: 100 }.
 */
async function prepareGate(page, name) {
  return page.evaluate(async (techniqueName) => {
    const api = game.modules.get("naruto-d20").api;
    const actor = api.getActor();
    const item = await api.ensureTechnique(actor, techniqueName, {
      update: {
        "system.learning.learned": true,
        "system.mastery": 0,
        "system.automation.enabled": true,
        "system.automation.targetMode": "self",
      },
    });
    await api.setSetting("automaticBuffs", true);
    await api.setSetting("buffTargetFiltering", "respectTechnique");
    await api.setSetting("enforceLearning", true);
    await api.resetActor(actor, { pool: 20, reserve: 10, temp: 0 });
    await api.clearAutomationBuffs(actor);
    api.clearBuffLookupCache();
    return { id: item.id };
  }, name);
}

test.describe("Gate techniques — Kai-Mon Kai", () => {
  test("performing applies a self-buff with a finite round duration", async ({ page }) => {
    await prepareGate(page, KAI);
    const result = await page.evaluate(async (name) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      const performed = await api.performByName(actor, name, { forceRoll: 20, rollBonus: 100 });
      const buffs = api.listBuffs(actor).filter((buff) => buff.sourceId);
      const doc = actor.items.get(buffs[0]?.id);
      return {
        warnings: performed.warnings,
        buffs,
        duration: doc?.system?.duration ?? null,
        model: doc?.flags?.["naruto-d20"]?.maintenanceBuff?.model ?? null,
      };
    }, KAI);

    expect(result.warnings).toEqual([]);
    expect(result.buffs).toHaveLength(1);
    expect(result.buffs[0].name).toBe(KAI);
    expect(result.buffs[0].active).toBe(true);
    expect(result.model).toBe("duration");
    expect(result.duration.units).toBe("round");
    expect(Number(result.duration.value)).toBeGreaterThan(0);
  });
});
