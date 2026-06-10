import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the naruto-d20 automated QA suite.
 *
 * The suite drives a LIVE Foundry instance (default http://localhost:30000)
 * running a test world with the `naruto-d20` module active and an actor named
 * `Ikazuchi`. It logs in once (global-setup), flips on the hidden `testMode`
 * setting so the module exposes its test API, and reuses that session.
 *
 * Foundry is a single shared, stateful world — tests MUST NOT run in parallel.
 */
const BASE_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";

export default defineConfig({
  testDir: "tests/e2e/specs",
  globalSetup: "./tests/e2e/global-setup.mjs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    storageState: "tests/e2e/.auth/state.json",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "foundry",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
