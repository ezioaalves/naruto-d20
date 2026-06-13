import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";

export const MAINTENANCE_MIGRATION_SETTING = "maintenanceMigrationVersion";
export const MAINTENANCE_MIGRATION_VERSION = 1;

const LEGACY_AUTOMATION_KEYS = [
  "stanceMode",
  "stanceUpkeep",
  "elementChoice",
  "upkeepFormula",
  "upkeepMode",
  "upkeepWaiverStep",
  "elementDoubleStep",
];

export function maintenanceMigrationPatch(maintenance) {
  const patch = {
    "system.automation.maintenance": structuredClone(maintenance),
  };
  for (const key of LEGACY_AUTOMATION_KEYS) {
    patch[`system.automation.-=${key}`] = null;
  }
  return patch;
}

function collectMigrationActors() {
  const actors = new Map(game.actors.map((actor) => [actor.uuid, actor]));
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
    }
  }
  return actors;
}

async function migrateVersion1(actors) {
  for (const actor of actors.values()) {
    const updates = [];
    for (const item of actor.items) {
      if (item.type !== TECHNIQUE_ITEM_TYPE) continue;
      const maintenance = item.system?.automation?.maintenance;
      if (!maintenance) continue;
      updates.push({ _id: item.id, ...maintenanceMigrationPatch(maintenance) });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
}

export async function runMaintenanceMigrations() {
  if (!game.user.isGM) return;
  const current = Number(game.settings.get(MODULE_ID, MAINTENANCE_MIGRATION_SETTING)) || 0;
  if (current >= MAINTENANCE_MIGRATION_VERSION) return;

  const actors = collectMigrationActors();
  if (current < 1) {
    await migrateVersion1(actors);
    await game.settings.set(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, 1);
  }
}
