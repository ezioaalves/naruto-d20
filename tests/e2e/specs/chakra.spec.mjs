import { test, expect } from "../fixtures.mjs";

/**
 * manual-qa.md → "Chakra" (passos 1–6).
 *
 * Driven through the test API: we read derived maxes and the condition state
 * straight from actor flags / actor.statuses rather than scraping the sheet.
 * One DOM check confirms the Chakra tab actually renders.
 */
test.describe("Chakra", () => {
  test("1 — derived pool/reserve maxes follow the README formulas", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor);

      const level = actor.system.details?.level?.value || actor.system.details?.cr?.total || 0;
      const conMod = actor.system.abilities?.con?.mod ?? 0;
      const c = api.getChakra(actor);
      return {
        level,
        conMod,
        poolMax: c.pool.max,
        reserveMax: c.reserve.max,
        expectedPool: 2 + (2 + conMod) * level + c.pool.maxBonus,
        expectedReserve: 2 * level + c.reserve.maxBonus,
      };
    });

    expect(r.poolMax).toBe(r.expectedPool);
    expect(r.reserveMax).toBe(r.expectedReserve);
  });

  test("2 — changing Con recomputes pool.max and keeps current values", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor);

      const origCon = actor.system.abilities?.con?.value ?? 10;
      const level = actor.system.details?.level?.value || actor.system.details?.cr?.total || 0;

      // Set a known current pool value, then bump Con by +2 (≈ +1 mod).
      await api.resetActor(actor, { pool: 3, temp: 0 });
      await api.setAbility(actor, "con", origCon + 2);
      const after = api.getChakra(actor);
      const conMod = actor.system.abilities?.con?.mod ?? 0;

      // restore Con so the world is left as found
      await api.setAbility(actor, "con", origCon);

      return {
        level,
        conMod,
        poolMaxAfter: after.pool.max,
        poolValueAfter: after.pool.value,
        expected: 2 + (2 + conMod) * level + after.pool.maxBonus,
      };
    });

    expect(r.poolMaxAfter).toBe(r.expected);
    // The current value is not wiped by the recompute.
    expect(r.poolValueAfter).toBe(3);
  });

  test("3 — manual Pool/Temp/Reserve edits persist", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { pool: 5, temp: 4, reserve: 6 });
      // Re-read from flags as the sheet would on reopen.
      return api.getChakra(actor);
    });

    expect(r.pool.value).toBe(5);
    expect(r.pool.temp).toBe(4);
    expect(r.reserve.value).toBe(6);
  });

  test("4 — Reserve below 50% (but >0) triggers Low Reserves + fatigued", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      // full reserve first, then drop to ~25%
      await api.resetActor(actor);
      const max = api.getChakra(actor).reserve.max;
      const low = Math.max(1, Math.floor(max * 0.25));
      await api.resetActor(actor, { reserve: low });
      return { low, max, conditions: api.getConditions(actor) };
    });

    expect(r.low).toBeGreaterThan(0);
    expect(r.conditions.lowReserves).toBe(true);
    expect(r.conditions.chakraDepletion).toBe(false);
    expect(r.conditions.fatigued).toBe(true);
  });

  test("5 — Reserve at 0 triggers Chakra Depletion + exhausted, drops Low Reserves", async ({
    page,
  }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { reserve: 0 });
      return api.getConditions(actor);
    });

    expect(r.chakraDepletion).toBe(true);
    expect(r.exhausted).toBe(true);
    expect(r.lowReserves).toBe(false);
  });

  test("6 — a fatigued the module did NOT apply is preserved when reserve recovers", async ({
    page,
  }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      // Clean slate at full reserve, then apply fatigued from an "external" source.
      await api.resetActor(actor);
      await api.setCondition(actor, "fatigued", true);

      // Recover reserve above 50% and re-evaluate conditions.
      await api.checkAndUpdateConditions(actor);
      const conditions = api.getConditions(actor);

      // cleanup
      await api.setCondition(actor, "fatigued", false);
      return conditions;
    });

    // Module must not remove a fatigued it did not apply.
    expect(r.fatigued).toBe(true);
    expect(r.appliedFatigued).toBe(false);
  });

  test("UI — the Chakra tab renders on the actor sheet", async ({ page }) => {
    // Open the actor sheet via the API, then assert the tab content exists.
    await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await actor.sheet.render(true);
    });

    const chakraTab = page.locator(
      ".app.sheet .tab[data-tab='chakra'], .application .tab[data-tab='chakra']",
    );
    await expect(chakraTab.first()).toBeAttached({ timeout: 15_000 });

    await page.evaluate(() => {
      const api = game.modules.get("naruto-d20").api;
      api.getActor().sheet.close();
    });
  });
});
