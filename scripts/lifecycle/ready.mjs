import { runMaintenanceMigrations } from "../data/maintenance-migration.mjs";

export function registerReadyHook() {
  Hooks.once("ready", async () => {
    await runMaintenanceMigrations();
  });
}
