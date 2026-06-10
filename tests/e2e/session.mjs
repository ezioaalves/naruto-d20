/**
 * Shared Foundry session helpers used by both the Playwright global-setup and
 * the per-worker page fixture. Centralises the login flow so there is one
 * source of truth for "get this page into the running world, ready".
 */
export const BASE_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";
export const USER = process.env.FOUNDRY_USER ?? "Chicó";
export const PASSWORD = process.env.FOUNDRY_PASSWORD ?? "esquecademimhomi";
export const ACTOR = process.env.FOUNDRY_ACTOR ?? "Ikazuchi";
export const STORAGE_STATE = "tests/e2e/.auth/state.json";
export const READY_TIMEOUT = 120_000;

export async function waitForGameReady(page) {
  await page.waitForFunction(() => window.game?.ready === true, null, { timeout: READY_TIMEOUT });
}

async function isInGame(page) {
  return page.evaluate(() => Boolean(window.game?.ready)).catch(() => false);
}

/** Fill + submit Foundry's /join form for the configured user. */
export async function joinWorld(page) {
  await page.waitForSelector("form#join-game, form.join-form, select[name='userid']", {
    timeout: READY_TIMEOUT,
  });
  await page.locator("select[name='userid']").selectOption({ label: USER });
  if (PASSWORD) await page.locator("input[name='password']").fill(PASSWORD);
  await Promise.all([
    page.waitForLoadState("load"),
    page
      .locator("button[name='join'], button[data-action='join'], button[type='submit']")
      .first()
      .click(),
  ]);
}

/**
 * Navigate to the world and make sure we end up in the running game. Joins the
 * world if the page lands on the user-select screen (e.g. a stale session).
 */
export async function ensureReady(page, { requireApi = true } = {}) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  // Resolve the load race: wait until EITHER the world is ready (valid session)
  // OR the /join user-select is on screen, then decide whether to log in.
  await page.waitForFunction(
    () => window.game?.ready === true || document.querySelector("select[name='userid']") !== null,
    null,
    { timeout: READY_TIMEOUT },
  );
  if (!(await isInGame(page))) await joinWorld(page);
  await waitForGameReady(page);
  if (requireApi) {
    await page.waitForFunction(
      () => Boolean(window.game.modules.get("naruto-d20")?.api?.ready),
      null,
      { timeout: READY_TIMEOUT },
    );
  }
}
