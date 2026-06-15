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

  test("forced HP upkeep drains 2 HP per combat turn", async ({ page }) => {
    await prepareGate(page, KAI);
    const result = await page.evaluate(async (name) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.performByName(actor, name, { forceRoll: 20, rollBonus: 100 });
      await api.startCombatForActor(actor); // first upkeep tick happens here
      const hpBefore = actor.system.attributes.hp.value;
      await api.advanceCombatTurn(actor); // exactly one more tick
      return {
        hpBefore,
        hpAfter: actor.system.attributes.hp.value,
        buffs: api.listBuffs(actor).filter((buff) => buff.sourceId),
        fatigued: api.getConditions(actor).fatigued,
      };
    }, KAI);

    expect(result.hpAfter).toBe(result.hpBefore - 2);
    expect(result.buffs).toHaveLength(1);
    expect(result.buffs[0].name).toBe(KAI);
    expect(result.buffs[0].active).toBe(true);
    expect(result.fatigued).toBe(false);
  });

  test("lethal upkeep tears the buff down and fatigues instead of dropping below 1 HP", async ({
    page,
  }) => {
    await prepareGate(page, KAI);
    const result = await page.evaluate(async (name) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.performByName(actor, name, { forceRoll: 20, rollBonus: 100 });
      await api.startCombatForActor(actor);
      await actor.update({ "system.attributes.hp.value": 2 }); // next 2-HP tick would hit 0
      await api.advanceCombatTurn(actor);
      return {
        hp: actor.system.attributes.hp.value,
        buffs: api.listBuffs(actor).filter((buff) => buff.sourceId),
        fatigued: api.getConditions(actor).fatigued,
      };
    }, KAI);

    expect(result.buffs).toHaveLength(0);
    expect(result.fatigued).toBe(true);
    expect(result.hp).toBe(2); // teardown skips the lethal subtraction
  });
});

test.describe("Gate techniques — Kyu-Mon Kai", () => {
  test("upkeep spends chakra, fast-heals, and clears fatigued/exhausted each turn", async ({
    page,
  }) => {
    await prepareGate(page, KYU);
    const result = await page.evaluate(async (name) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.performByName(actor, name, { forceRoll: 20, rollBonus: 100 });

      const hpMax = actor.system.attributes.hp.max;
      await actor.update({ "system.attributes.hp.value": hpMax - 10 });
      await api.setCondition(actor, "fatigued", true);
      await api.setCondition(actor, "exhausted", true);

      const poolBefore = api.getChakra(actor).pool.value;
      const hpBefore = actor.system.attributes.hp.value;
      await api.startCombatForActor(actor); // one upkeep tick
      const conditions = api.getConditions(actor);
      return {
        poolBefore,
        poolAfter: api.getChakra(actor).pool.value,
        hpBefore,
        hpAfter: actor.system.attributes.hp.value,
        fastHealing: actor.system.traits?.fastHealing ?? "",
        buffs: api.listBuffs(actor).filter((buff) => buff.sourceId),
        fatigued: conditions.fatigued,
        exhausted: conditions.exhausted,
      };
    }, KYU);

    expect(result.poolAfter).toBe(result.poolBefore - 3); // chakra-damage cost at mastery 0
    expect(result.hpAfter).toBe(result.hpBefore + 2); // fast-healing at mastery 0
    expect(String(result.fastHealing)).toBe("2");
    expect(result.buffs).toHaveLength(1);
    expect(result.buffs[0].name).toBe(KYU);
    expect(result.buffs[0].active).toBe(true);
    expect(result.fatigued).toBe(false);
    expect(result.exhausted).toBe(false);
  });
});

test.describe("Gate techniques — Sei-Mon Kai", () => {
  test("performing grants 8 temporary chakra alongside the self-buff", async ({ page }) => {
    await prepareGate(page, SEI);
    const result = await page.evaluate(async (name) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.performByName(actor, name, { forceRoll: 20, rollBonus: 100 });
      return {
        temp: api.getChakra(actor).pool.temp,
        buffs: api.listBuffs(actor).filter((buff) => buff.sourceId),
      };
    }, SEI);

    expect(result.buffs).toHaveLength(1);
    expect(result.buffs[0].name).toBe(SEI);
    expect(result.temp).toBe(8);
  });

  test("forced HP upkeep drains 4 HP per combat turn", async ({ page }) => {
    await prepareGate(page, SEI);
    const result = await page.evaluate(async (name) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.performByName(actor, name, { forceRoll: 20, rollBonus: 100 });
      await api.startCombatForActor(actor);
      const hpBefore = actor.system.attributes.hp.value;
      await api.advanceCombatTurn(actor);
      return {
        hpBefore,
        hpAfter: actor.system.attributes.hp.value,
        buffs: api.listBuffs(actor).filter((buff) => buff.sourceId),
      };
    }, SEI);

    expect(result.hpAfter).toBe(result.hpBefore - 4);
    expect(result.buffs).toHaveLength(1);
    expect(result.buffs[0].name).toBe(SEI);
    expect(result.buffs[0].active).toBe(true);
  });
});
