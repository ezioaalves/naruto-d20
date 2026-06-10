import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ACTOR, STORAGE_STATE, ensureReady, waitForGameReady } from "./session.mjs";

/**
 * Global setup: log into the running Foundry test world once, enable the
 * module's hidden `testMode` switch, confirm the test actor exists, and persist
 * the authenticated session so each worker can re-enter the world quickly.
 *
 * Env (all optional): FOUNDRY_URL, FOUNDRY_USER, FOUNDRY_PASSWORD, FOUNDRY_ACTOR.
 */
async function enableTestMode(page) {
  const state = await page.evaluate(async () => {
    const mod = game.modules.get("naruto-d20");
    if (!mod) return { ok: false, reason: "module naruto-d20 not active" };
    if (!game.user?.isGM)
      return { ok: false, reason: "logged-in user is not a GM (cannot set world setting)" };
    const already = game.settings.get("naruto-d20", "testMode");
    if (!already) await game.settings.set("naruto-d20", "testMode", true);
    return { ok: true, already, hasApi: Boolean(mod.api?.ready) };
  });

  if (!state.ok) throw new Error(`naruto-d20 testMode could not be enabled: ${state.reason}`);

  // The API installs on the `ready` hook, so a reload is needed after the
  // setting flips (unless it was already on and the API is present).
  if (!state.already || !state.hasApi) {
    await page.reload();
    await waitForGameReady(page);
  }
  await page.waitForFunction(() => Boolean(game.modules.get("naruto-d20")?.api?.ready), null, {
    timeout: 120_000,
  });
}

export default async function globalSetup() {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Log in and reach the world (API not required yet — we may be enabling it).
    await ensureReady(page, { requireApi: false });

    const probe = await page.evaluate((name) => {
      const lower = name.toLowerCase();
      const found =
        game.actors.getName(name) ?? game.actors.find((a) => a.name.toLowerCase().includes(lower));
      return {
        world: game.world?.id ?? game.world?.title ?? "?",
        found: Boolean(found),
        resolved: found?.name ?? null,
        actors: game.actors.contents.map((a) => a.name),
      };
    }, ACTOR);
    if (!probe.found) {
      throw new Error(
        `Test actor "${ACTOR}" not found in world "${probe.world}". ` +
          `Open the test world that contains it, or set FOUNDRY_ACTOR. ` +
          `Actors present: ${probe.actors.join(", ") || "(none)"}`,
      );
    }

    await enableTestMode(page);
    await context.storageState({ path: STORAGE_STATE });
  } finally {
    await browser.close();
  }
}
