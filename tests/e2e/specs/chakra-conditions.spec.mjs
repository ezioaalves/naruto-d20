import { test, expect } from "../fixtures.mjs";

/**
 * Chakra condition recovery — automates "Task 5: Manual Foundry QA" from
 * docs/superpowers/plans/2026-06-16-chakra-condition-recovery.md.
 *
 * The behaviours under test depend on combat state, so each test drives a real
 * combat through the test API (startCombatForActor / deleteCombat) and reads the
 * resolved condition + recovery flags back from actor.statuses / module flags.
 *
 *   - Low Reserve fatigue is DELAYED while a combat is running (25%–50%).
 *   - Below 25% the fatigue applies immediately, even in combat.
 *   - Ending the encounter (deleteCombat) flushes the pending fatigue.
 *   - Chakra Depletion persists until BOTH reserve and pool are full again.
 */
test.describe("Chakra condition recovery", () => {
  test("1 — combat delays low-reserve fatigue between 25% and 50%", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor);
      await api.startCombatForActor(actor);

      const max = api.getChakra(actor).reserve.max;
      const reserve = Math.floor(max * 0.4); // squarely in [25%, 50%)
      await api.resetActor(actor, { reserve });
      return { max, reserve, conditions: api.getConditions(actor) };
    });

    expect(r.reserve).toBeGreaterThan(r.max * 0.25);
    expect(r.reserve).toBeLessThan(r.max * 0.5);
    expect(r.conditions.lowReserves).toBe(true);
    expect(r.conditions.chakraDepletion).toBe(false);
    // Fatigue is held back during the encounter.
    expect(r.conditions.fatigued).toBe(false);
    expect(r.conditions.lowReserveFatiguePending).toBe(true);
  });

  test("2 — reserve below 25% applies fatigue immediately even in combat", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor);
      await api.startCombatForActor(actor);

      const max = api.getChakra(actor).reserve.max;
      const reserve = Math.max(1, Math.floor(max * 0.2)); // below the quarter threshold, > 0
      await api.resetActor(actor, { reserve });
      return { max, reserve, conditions: api.getConditions(actor) };
    });

    expect(r.reserve).toBeGreaterThan(0);
    expect(r.reserve).toBeLessThan(r.max * 0.25);
    expect(r.conditions.lowReserves).toBe(true);
    expect(r.conditions.fatigued).toBe(true);
    expect(r.conditions.lowReserveFatiguePending).toBe(false);
  });

  test("3 — ending the encounter applies the pending low-reserve fatigue", async ({ page }) => {
    const setup = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();
      await api.resetActor(actor);
      const { combatId } = await api.startCombatForActor(actor);

      const max = api.getChakra(actor).reserve.max;
      await api.resetActor(actor, { reserve: Math.floor(max * 0.4) });
      return { combatId, conditions: api.getConditions(actor) };
    });

    // Precondition: fatigue is pending while combat is active.
    expect(setup.conditions.fatigued).toBe(false);
    expect(setup.conditions.lowReserveFatiguePending).toBe(true);

    // End the encounter; the deleteCombat hook re-evaluates conditions async.
    await page.evaluate(async (combatId) => {
      await game.combats.get(combatId)?.delete();
    }, setup.combatId);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const api = game.modules.get("naruto-d20").api;
          return api.getConditions(api.getActor());
        }),
      )
      .toMatchObject({
        fatigued: true,
        lowReserves: true,
        lowReserveFatiguePending: false,
      });
  });

  test("4 — depletion persists until both reserve and pool are full", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      // Drop reserve to 0 to trigger depletion + exhausted.
      await api.resetActor(actor, { reserve: 0 });
      const depleted = api.getConditions(actor);

      // Recover reserve fully but leave the pool one short of max.
      const poolMax = api.getChakra(actor).pool.max;
      await api.resetActor(actor, { pool: Math.max(0, poolMax - 1) });
      return { depleted, conditions: api.getConditions(actor) };
    });

    expect(r.depleted.chakraDepletion).toBe(true);
    expect(r.depleted.exhausted).toBe(true);

    // Reserve is full again but the pool is not — depletion must hold.
    expect(r.conditions.chakraDepletion).toBe(true);
    expect(r.conditions.depletionActive).toBe(true);
    expect(r.conditions.lowReserves).toBe(false);
    expect(r.conditions.exhausted).toBe(false); // reservePct >= 0.5 → fatigued, not exhausted
    expect(r.conditions.fatigued).toBe(true);
  });

  test("5 — depletion clears when reserve and pool are both full", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = game.modules.get("naruto-d20").api;
      const actor = api.getActor();

      await api.resetActor(actor, { reserve: 0 });
      // Default reset restores both pool and reserve to max.
      await api.resetActor(actor);
      return api.getConditions(actor);
    });

    expect(r.chakraDepletion).toBe(false);
    expect(r.depletionActive).toBe(false);
    expect(r.exhausted).toBe(false);
    expect(r.fatigued).toBe(false);
    expect(r.lowReserves).toBe(false);
    expect(r.lowReserveFatiguePending).toBe(false);
  });
});
