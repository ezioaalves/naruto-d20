import { test as base, expect } from "@playwright/test";
import { STORAGE_STATE, ensureReady } from "./session.mjs";

/**
 * Fixtures for the naruto-d20 E2E suite.
 *
 * Foundry is a single shared, stateful world, so logging in per test is both
 * slow and pointless. A worker-scoped context logs in once (reusing the
 * persisted storageState) and reaches a ready, test-API-installed world; the
 * built-in `page` fixture is overridden to hand every test that same page.
 * With workers=1 (see playwright.config) the whole suite shares one login.
 *
 * Tests drive the rules through `page.evaluate`, resolving the API in-browser:
 *   const api = game.modules.get("naruto-d20").api;
 *   const actor = api.getActor();          // "Ikazuchi" by default
 * All API methods return plain serializable snapshots so results cross the
 * evaluate boundary cleanly. Isolation between tests comes from api.resetActor.
 */
export const test = base.extend({
  // Worker-scoped: one logged-in, ready Foundry page reused by all tests.
  worldPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ storageState: STORAGE_STATE });
      const page = await context.newPage();
      await ensureReady(page);
      await use(page);
      await context.close();
    },
    { scope: "worker" },
  ],

  // Override the built-in test-scoped `page` to yield the shared world page,
  // so existing specs keep using `{ page }`.
  page: async ({ worldPage }, use) => {
    await use(worldPage);
  },
});

export { expect };
