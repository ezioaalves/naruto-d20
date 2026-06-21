import { MODULE_ID } from "../../../core/constants.mjs";

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

/** Permanent duration for toggle-model maintenance buffs — PF1e never auto-expires these. */
export function toggleMaintenanceBuffDuration() {
  return { units: "perm", value: "" };
}

/**
 * Buff system.duration for the duration model: the technique's real round count,
 * ending at turnStart so PF1e expires it (and triggers teardown) at the owner's turn.
 * `worldTime` is the start stamp PF1e uses to compute remaining seconds.
 */
export function realMaintenanceBuffDuration({ totalRounds, worldTime }) {
  return {
    units: "round",
    value: String(Math.max(1, Number(totalRounds) || 1)),
    end: "turnStart",
    start: worldTime,
  };
}

/** True when a resolved duration is a finite, positive, round-based duration. */
export function isFiniteRoundDuration(duration) {
  if (!duration || duration.units !== "round") return false;
  const value = Number(duration.value);
  return Number.isFinite(value) && value > 0;
}

/**
 * Decide the maintenance model for a technique.
 * `facets` = maintenanceFacets(item) (or null), `duration` = resolved { units, value }.
 * Returns "duration" (finite round duration), "toggle" (everything else), or null (no maintenance).
 */
export function resolveMaintenanceModel(facets, duration) {
  if (!facets) return null;
  return isFiniteRoundDuration(duration) ? "duration" : "toggle";
}

/**
 * Rounds left for a duration-model buff: total - (current - start).
 * A null startRound means the buff has not started counting yet (applied out of combat).
 */
export function maintenanceRoundsRemaining({ totalRounds, startRound, currentRound } = {}) {
  const total = Number(totalRounds);
  if (!Number.isFinite(total)) return Infinity;
  if (startRound === null || startRound === undefined) return total;
  const elapsed = Number(currentRound) - Number(startRound);
  if (!Number.isFinite(elapsed)) return total;
  return total - elapsed;
}

/**
 * Whether the per-turn tick should charge upkeep this round:
 * rounds still remaining, on the interval cadence, and not already charged this round.
 */
export function shouldChargeUpkeep({
  remaining,
  currentRound,
  startRound,
  interval = 1,
  lastUpkeepRound,
} = {}) {
  if (!(Number(remaining) > 0)) return false;
  if (Number(lastUpkeepRound) === Number(currentRound)) return false;
  const step = Math.max(1, Number(interval) || 1);
  const base =
    startRound === null || startRound === undefined ? Number(currentRound) : Number(startRound);
  const elapsed = Number(currentRound) - base;
  if (!Number.isFinite(elapsed)) return true;
  return elapsed % step === 0;
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
 * mode/element techniques carry modeId/elements; duration-model buffs carry
 * model/totalRounds/startRound/interval/lastUpkeepRound.
 */
export function maintenanceBuffFlagData({
  sourceTechniqueId,
  grantType,
  key,
  modeId,
  elements,
  hasHeal = false,
  model,
  totalRounds,
  startRound,
  interval,
} = {}) {
  const data = {};
  if (sourceTechniqueId) data.sourceTechniqueId = sourceTechniqueId;
  if (grantType) data.grantType = grantType;
  if (key) data.key = key;
  if (modeId) data.modeId = modeId;
  if (Array.isArray(elements)) data.elements = elements;
  if (hasHeal) data.hasHeal = true;
  if (model === "toggle") {
    data.model = "toggle";
    data.startRound = startRound ?? null;
    data.interval = Math.max(1, Number(interval) || 1);
  }
  if (model === "duration") {
    data.model = "duration";
    if (Number.isFinite(Number(totalRounds))) data.totalRounds = Number(totalRounds);
    data.startRound = startRound ?? null;
    data.interval = Math.max(1, Number(interval) || 1);
    data.lastUpkeepRound = startRound ?? null;
  }
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
