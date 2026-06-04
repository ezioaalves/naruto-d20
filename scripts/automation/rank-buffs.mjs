import { MODULE_ID } from "../constants.mjs";

export const RANK_BUFF_FLAG = "rankBuff";

const RANK_BUFFS = {
  JOURYOKU: "JOURYOKU (STRENGTH RANK)",
  KOUSOKU: "KOUSOKU (SPEED RANK)",
};

const RANK_LEVELS = {
  SHODAN: 1,
  NIDAN: 2,
  SANDAN: 3,
  YONDAN: 4,
  GODAN: 5,
};

const RANK_MAINTENANCE = {
  1: { cost: 1, interval: 5 },
  2: { cost: 2, interval: 5 },
  3: { cost: 3, interval: 5 },
  4: { cost: 4, interval: 5 },
  5: { cost: 1, interval: 1 },
  6: { cost: 3, interval: 2 },
  7: { cost: 2, interval: 1 },
  8: { cost: 5, interval: 2 },
  9: { cost: 3, interval: 1 },
  10: { cost: 5, interval: 1 },
};

export function resolveRankTechnique(name) {
  const match = String(name ?? "")
    .trim()
    .match(/^([A-Z]+)\s+(JOURYOKU|KOUSOKU)\b/i);
  if (!match) return null;

  const level = RANK_LEVELS[match[1].toUpperCase()];
  const key = match[2].toUpperCase();
  const buffName = RANK_BUFFS[key];
  const maintenance = rankMaintenanceForLevel(level);
  if (!level || !buffName || !maintenance) return null;

  return {
    key,
    buffName,
    level,
    cost: maintenance.cost,
    interval: maintenance.interval,
    selfTarget: true,
  };
}

export function rankMaintenanceForLevel(level) {
  return RANK_MAINTENANCE[Number(level)] ?? null;
}

export function rankBuffDuration(interval) {
  return {
    units: "round",
    value: String(interval),
    end: "turnStart",
    start: game.time.worldTime,
  };
}

export function rankBuffFlagData(context) {
  if (!context) return null;
  return {
    key: context.key,
    level: context.level,
    cost: context.cost,
    interval: context.interval,
  };
}

export function getRankBuffFlag(item) {
  return item?.flags?.[MODULE_ID]?.[RANK_BUFF_FLAG] ?? null;
}

export function isRankBuffItem(item) {
  return Boolean(getRankBuffFlag(item));
}
