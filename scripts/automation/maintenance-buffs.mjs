import { MODULE_ID } from "../constants.mjs";

export const MAINTENANCE_BUFF_FLAG = "maintenanceBuff";
export const MAINTENANCE_BUFF_FLAG_PATH = `flags.${MODULE_ID}.${MAINTENANCE_BUFF_FLAG}`;

export const MAINTENANCE_MODES = [
  { id: "dex", suffix: "Dexterity", labelKey: "NarutoD20.Maintenance.Dexterity" },
  { id: "str", suffix: "Strength", labelKey: "NarutoD20.Maintenance.Strength" },
];

export const ELEMENTS = [
  { id: "cold", labelKey: "NarutoD20.MaintenanceElement.Cold" },
  { id: "earth", labelKey: "NarutoD20.MaintenanceElement.Earth" },
  { id: "electric", labelKey: "NarutoD20.MaintenanceElement.Electric" },
  { id: "fire", labelKey: "NarutoD20.MaintenanceElement.Fire" },
  { id: "water", labelKey: "NarutoD20.MaintenanceElement.Water" },
  { id: "wind", labelKey: "NarutoD20.MaintenanceElement.Wind" },
];

export const ELEMENT_IDS = ELEMENTS.map((element) => element.id);

export function maintenanceBuffDuration(interval = 1) {
  return {
    units: "round",
    value: String(Math.max(1, Number(interval) || 1)),
    end: "turnStart",
    start: game.time.worldTime,
  };
}

export function maintenanceModeById(id) {
  return MAINTENANCE_MODES.find((mode) => mode.id === id) ?? null;
}

export function maintenanceModeBuffName(item, mode) {
  const resolved = typeof mode === "string" ? maintenanceModeById(mode) : mode;
  if (!resolved) return null;
  return `${item.name} (${resolved.suffix})`;
}

/**
 * Read a technique's maintenance facets, or null if maintenance is disabled.
 * Pure: takes a plain technique-shaped object. Cost/interval default applied here.
 */
export function maintenanceFacets(item) {
  const m = item?.system?.automation?.maintenance;
  if (!m?.enabled) return null;
  return {
    resource: m.resource ?? "",
    cost: m.cost ?? "",
    policy: m.policy ?? "prompt",
    interval: Math.max(1, Number(m.interval) || 1),
    waiver: m.waiver ?? "",
    waiverStep: Number(m.waiverStep ?? 2) || 0,
    freeRounds: Math.max(1, Number(m.freeRounds) || 5),
    choice: m.choice ?? "",
    heal: m.heal ?? "",
    clearConditions: String(m.clearConditions ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Unified maintenance-buff flag payload. Rank buffs carry `key` + `grantType`;
 * mode/element techniques carry modeId/elements.
 */
export function maintenanceBuffFlagData({
  sourceTechniqueId,
  grantType,
  key,
  modeId,
  elements,
  hasHeal = false,
} = {}) {
  const data = {};
  if (sourceTechniqueId) data.sourceTechniqueId = sourceTechniqueId;
  if (grantType) data.grantType = grantType;
  if (key) data.key = key;
  if (modeId) data.modeId = modeId;
  if (Array.isArray(elements)) data.elements = elements;
  if (hasHeal) data.hasHeal = true;
  return data;
}

export function getMaintenanceBuffFlag(item) {
  return item?.flags?.[MODULE_ID]?.[MAINTENANCE_BUFF_FLAG] ?? null;
}

export function findMaintenanceBuffForTechnique(actor, techniqueId) {
  if (!actor || !techniqueId) return null;
  return (
    actor.items.find((item) => getMaintenanceBuffFlag(item)?.sourceTechniqueId === techniqueId) ??
    null
  );
}

export const RANK_MAINTENANCE_KEYS = ["KOUSOKU", "JOURYOKU"];

export function getRankMaintenanceFlag(item) {
  const flag = getMaintenanceBuffFlag(item);
  return flag && RANK_MAINTENANCE_KEYS.includes(flag.key) ? flag : null;
}
