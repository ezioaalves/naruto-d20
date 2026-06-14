import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";
import { maintenanceBuffFlagData } from "../automation/maintenance-buffs.mjs";
import { resolveRankTechnique } from "../automation/rank-buffs.mjs";

export const MAINTENANCE_MIGRATION_SETTING = "maintenanceMigrationVersion";
export const MAINTENANCE_MIGRATION_VERSION = 2;

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

export function legacyRankBuffToMaintenance(flag = {}) {
  return maintenanceBuffFlagData({
    sourceTechniqueId: flag.sourceTechniqueId,
    grantType: flag.grantType ?? "paid",
    key: flag.key,
  });
}

export function rankMaintenanceFromContext(context) {
  return {
    enabled: true,
    resource: "chakra",
    cost: String(context.cost),
    policy: "prompt",
    interval: context.interval,
    waiver: "freeUse",
    waiverStep: 5,
    freeRounds: 5,
    choice: "",
    element: false,
    elementDoubleStep: 5,
  };
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

async function migrateVersion2(actors) {
  for (const actor of actors.values()) {
    const updates = [];
    for (const item of actor.items) {
      if (item.type === TECHNIQUE_ITEM_TYPE) {
        const context = resolveRankTechnique(item.name);
        if (context) {
          updates.push({
            _id: item.id,
            "system.automation.maintenance": rankMaintenanceFromContext(context),
          });
        }
        continue;
      }

      const legacy = item.flags?.[MODULE_ID]?.rankBuff;
      if (!legacy) continue;
      updates.push({
        _id: item.id,
        [`flags.${MODULE_ID}.maintenanceBuff`]: legacyRankBuffToMaintenance(legacy),
        [`flags.${MODULE_ID}.-=rankBuff`]: null,
      });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  for (const item of game.items) {
    const legacy = item.flags?.[MODULE_ID]?.rankBuff;
    if (!legacy) continue;
    await item.update({
      [`flags.${MODULE_ID}.maintenanceBuff`]: legacyRankBuffToMaintenance(legacy),
      [`flags.${MODULE_ID}.-=rankBuff`]: null,
    });
  }
}

export async function runMaintenanceMigrations() {
  if (!game.user.isGM) return;
  let completed = Number(game.settings.get(MODULE_ID, MAINTENANCE_MIGRATION_SETTING)) || 0;
  if (completed >= MAINTENANCE_MIGRATION_VERSION) return;

  const actors = collectMigrationActors();
  if (completed < 1) {
    await migrateVersion1(actors);
    completed = 1;
    await game.settings.set(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, completed);
  }
  if (completed < 2) {
    await migrateVersion2(actors);
    completed = 2;
    await game.settings.set(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, completed);
  }
}
