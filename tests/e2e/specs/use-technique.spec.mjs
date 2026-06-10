import { test, expect } from "../fixtures.mjs";

/**
 * manual-qa.md → "Uso de tecnicas" (núcleo: passos 1–3, 5, 6).
 *
 * Steps 5 & 6 exercise the chakra-spend engine directly (deterministic, no
 * inventory needed). Steps 1–3 drive performTechnique with a pinned d20; they
 * discover a suitable learned technique on the actor and skip with a clear
 * message if none exists. weaponAttack / PF1e-attack-dialog steps (4, 7–10)
 * are deferred to phase 2.
 */

const DISCIPLINE_SKILL = {
  "Chakra Control": "ckc",
  Fuinjutsu: "fui",
  Genjutsu: "gnj",
  Ninjutsu: "nin",
  Taijutsu: "tai",
};

test.describe("Chakra spend engine", () => {
  test("5 — cost above Temp+Pool (but below +Reserve) is unaffordable; Reserve excluded", async ({
    page,
  }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { temp: 2, pool: 3, reserve: 10 });
      const cost = 6; // Temp+Pool = 5 < 6 ≤ Temp+Pool+Reserve = 15
      return {
        available: api.availableChakra(actor),
        canPay: api.canPayChakra(actor, cost),
      };
    });

    expect(r.available).toBe(5); // reserve does NOT count toward available
    expect(r.canPay).toBe(false);
  });

  test("6 — Emergency Transfer: pool hits 0 with reserve left → pool=1, reserve=0, depletion", async ({
    page,
  }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { temp: 0, pool: 4, reserve: 10 });
      const spend = api.calculateChakraSpend(actor, 4); // drains pool to 0
      const res = await api.payChakra(actor, 4);
      return { spend, res, chakra: api.getChakra(actor), conditions: api.getConditions(actor) };
    });

    expect(r.spend.pool).toBe(1);
    expect(r.spend.reserve).toBe(0);
    expect(r.res.paid).toBe(true);
    expect(r.chakra.pool.value).toBe(1);
    expect(r.chakra.reserve.value).toBe(0);
    expect(r.conditions.chakraDepletion).toBe(true);
  });
});

test.describe("Technique perform", () => {
  test("1 — auto-perform technique runs and spends chakra after use", async ({ page }) => {
    const r = await page.evaluate(async (DISCIPLINE_SKILL) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      // Pick a learned technique with cost > 0 that auto-bypasses the perform
      // check (skillRanks + masteryPerform >= skillThreshold).
      const pick = actor.items.find((i) => {
        if (i.type !== "naruto-d20.technique") return false;
        if (!api.isTechniqueEffectivelyLearned(i)) return false;
        const cost = i.system?.chakraCost ?? 0;
        if (cost <= 0) return false;
        const d = i.system?.derived;
        const skillKey = DISCIPLINE_SKILL[i.system?.discipline];
        if (!skillKey || !d) return false;
        const ranks = actor.system.skills?.[skillKey]?.rank ?? 0;
        return ranks + (d.masteryPerform ?? 0) >= d.skillThreshold;
      });
      if (!pick) return { skip: true };

      await api.setSetting("enforceLearning", true);
      await api.resetActor(actor); // full pool/reserve so it can afford
      const before = api.getChakra(actor);
      const res = await api.performByName(actor, pick.name, { forceRoll: 20 });
      return {
        skip: false,
        name: pick.name,
        cost: pick.system.chakraCost,
        before,
        after: res.chakra,
        warnings: res.warnings,
      };
    }, DISCIPLINE_SKILL);

    test.skip(r.skip, "No learned, auto-perform technique with chakra cost on the actor");
    expect(r.warnings).toEqual([]);
    // Chakra was spent (available dropped by the cost).
    expect(r.after.available).toBe(r.before.available - r.cost);
  });

  test("2 — a perform technique forced to fail spends no chakra", async ({ page }) => {
    const r = await page.evaluate(async (DISCIPLINE_SKILL) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      // Need a technique that actually rolls (ranks + mastery < threshold).
      const pick = actor.items.find((i) => {
        if (i.type !== "naruto-d20.technique") return false;
        if (!api.isTechniqueEffectivelyLearned(i)) return false;
        if ((i.system?.chakraCost ?? 0) <= 0) return false;
        const d = i.system?.derived;
        const skillKey = DISCIPLINE_SKILL[i.system?.discipline];
        if (!skillKey || !d) return false;
        const ranks = actor.system.skills?.[skillKey]?.rank ?? 0;
        return ranks + (d.masteryPerform ?? 0) < d.skillThreshold;
      });
      if (!pick) return { skip: true };

      await api.setSetting("enforceLearning", true);
      await api.resetActor(actor);
      const before = api.getChakra(actor);
      const res = await api.performByName(actor, pick.name, { forceRoll: 1 });
      return { skip: false, name: pick.name, before, after: res.chakra };
    }, DISCIPLINE_SKILL);

    test.skip(r.skip, "No learned technique that requires a perform roll on the actor");
    expect(r.after.available).toBe(r.before.available);
  });

  test("3 — a perform technique forced to succeed spends chakra", async ({ page }) => {
    const r = await page.evaluate(async (DISCIPLINE_SKILL) => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      const pick = actor.items.find((i) => {
        if (i.type !== "naruto-d20.technique") return false;
        if (!api.isTechniqueEffectivelyLearned(i)) return false;
        if ((i.system?.chakraCost ?? 0) <= 0) return false;
        const d = i.system?.derived;
        const skillKey = DISCIPLINE_SKILL[i.system?.discipline];
        if (!skillKey || !d) return false;
        const ranks = actor.system.skills?.[skillKey]?.rank ?? 0;
        return ranks + (d.masteryPerform ?? 0) < d.skillThreshold;
      });
      if (!pick) return { skip: true };

      await api.setSetting("enforceLearning", true);
      await api.resetActor(actor);
      const before = api.getChakra(actor);
      const res = await api.performByName(actor, pick.name, { forceRoll: 20 });
      return { skip: false, cost: pick.system.chakraCost, before, after: res.chakra };
    }, DISCIPLINE_SKILL);

    test.skip(r.skip, "No learned technique that requires a perform roll on the actor");
    expect(r.after.available).toBeLessThan(r.before.available);
  });
});
