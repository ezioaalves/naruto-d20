import { test, expect } from "../fixtures.mjs";

/**
 * manual-qa.md → "Tap Reserves" (passos 2–6).
 *
 * api.tapReserves() renders the real TapReservesDialog, fills its inputs, pins
 * the d20, and clicks Roll — so the dialog's own validation + rule logic is
 * exercised, not a reimplementation. Warnings are captured via the API's
 * ui.notifications spy.
 */
test.describe("Tap Reserves", () => {
  test("2 — draining 0 warns and changes nothing", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { reserve: 6, temp: 0 });
      const before = api.getChakra(actor);
      const res = await api.tapReserves(actor, { amount: 0 });
      return { before, after: res.chakra, warnings: res.warnings };
    });

    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.after.reserve.value).toBe(r.before.reserve.value);
    expect(r.after.pool.temp).toBe(r.before.pool.temp);
  });

  test("3 — draining more than the reserve warns and changes nothing", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { reserve: 3, temp: 0 });
      const before = api.getChakra(actor);
      const res = await api.tapReserves(actor, { amount: 99 });
      return { before, after: res.chakra, warnings: res.warnings };
    });

    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.after.reserve.value).toBe(r.before.reserve.value);
    expect(r.after.pool.temp).toBe(r.before.pool.temp);
  });

  test("4/5 — a successful tap moves chakra from Reserve to Temp", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { reserve: 8, temp: 1 });
      const before = api.getChakra(actor);
      // nat 20 → DC (10 + amount) is comfortably beaten
      const res = await api.tapReserves(actor, { amount: 3, seal: "none", forceRoll: 20 });
      return { before, after: res.chakra, warnings: res.warnings };
    });

    expect(r.warnings.length).toBe(0);
    expect(r.after.reserve.value).toBe(r.before.reserve.value - 3);
    expect(r.after.pool.temp).toBe(r.before.pool.temp + 3);
  });

  test("6 — a failed tap leaves Reserve and Temp unchanged", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { reserve: 8, temp: 1 });
      const before = api.getChakra(actor);
      // nat 1 → fails the DC
      const res = await api.tapReserves(actor, { amount: 5, seal: "none", forceRoll: 1 });
      return { before, after: res.chakra };
    });

    expect(r.after.reserve.value).toBe(r.before.reserve.value);
    expect(r.after.pool.temp).toBe(r.before.pool.temp);
  });

  test("5 — draining the reserve to 0 triggers Chakra Depletion", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor, { reserve: 3, temp: 0 });
      const res = await api.tapReserves(actor, { amount: 3, seal: "hand", forceRoll: 20 });
      return { after: res.chakra, conditions: api.getConditions(actor) };
    });

    expect(r.after.reserve.value).toBe(0);
    expect(r.conditions.chakraDepletion).toBe(true);
  });
});
