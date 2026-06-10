import { MODULE_ID } from "../constants.mjs";

export const RANK_BUFF_FLAG = "rankBuff";
export const RANK_BUFF_FLAG_PATH = `flags.${MODULE_ID}.${RANK_BUFF_FLAG}`;
export const RANK_KEYS = ["KOUSOKU", "JOURYOKU"];
export const RANK_GRANT_TYPES = ["paid", "temp", "bonus"];
export const RANK_MASTERY_FREE_ROUNDS = 5;
export const RANK_MASTERY_REQUIRED_STEP = 5;

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

export function isRankMasteryFreeUseEligible(item) {
  return (
    Boolean(resolveRankTechnique(item?.name)) &&
    Number(item?.system?.mastery ?? 0) >= RANK_MASTERY_REQUIRED_STEP
  );
}

export function hasRankMasteryFreeUseAvailable(item) {
  if (!isRankMasteryFreeUseEligible(item)) return false;
  return Number(item.system?.uses?.value ?? 0) > 0;
}

export async function ensureRankMasteryDailyUse(item) {
  if (!isRankMasteryFreeUseEligible(item)) return item;

  const uses = item.system?.uses ?? {};
  const updates = {};
  if (uses.per !== "day") updates["system.uses.per"] = "day";
  if (Number(uses.max ?? 0) !== 1) updates["system.uses.max"] = 1;
  if (uses.maxFormula !== "1") updates["system.uses.maxFormula"] = "1";
  if (uses.autoDeductChargesCost !== "0") updates["system.uses.autoDeductChargesCost"] = "0";
  if (!Number.isFinite(Number(uses.value))) updates["system.uses.value"] = 1;

  if (foundry.utils.isEmpty(updates)) return item;
  await item.update(updates);
  return item.actor?.items.get(item.id) ?? item;
}

export async function consumeRankMasteryFreeUse(item) {
  if (!hasRankMasteryFreeUseAvailable(item)) return false;
  await item.update({ "system.uses.value": 0 });
  return true;
}

export function findRankTechniqueForBuff(actor, rankBuffFlag) {
  if (!actor || !rankBuffFlag) return null;

  if (rankBuffFlag.sourceTechniqueId) {
    const item = actor.items.get(rankBuffFlag.sourceTechniqueId);
    if (item) return item;
  }

  return actor.items.find((item) => {
    const context = resolveRankTechnique(item.name);
    return context?.key === rankBuffFlag.key && context?.level === rankBuffFlag.level;
  });
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
    grantType: "paid",
    level: context.level,
    cost: context.cost,
    interval: context.interval,
    sourceTechniqueId: context.sourceTechniqueId ?? null,
  };
}

export function getRankBuffFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[RANK_BUFF_FLAG] ?? null;
  // key "" (sheet's "None" option) or anything malformed counts as no flag
  if (!flag || !RANK_KEYS.includes(flag.key)) return null;
  return flag;
}

export function isRankBuffItem(item) {
  return Boolean(getRankBuffFlag(item));
}

export function getRankGrantType(item) {
  const flag = getRankBuffFlag(item);
  if (!flag) return null;
  return RANK_GRANT_TYPES.includes(flag.grantType) ? flag.grantType : "paid";
}

export function rankGrantLevel(item) {
  const flag = getRankBuffFlag(item);
  if (!flag) return 0;
  const level =
    getRankGrantType(item) === "paid"
      ? flag.level ?? item.system?.level ?? 0
      : item.system?.level ?? 0;
  return Math.max(0, Number(level) || 0);
}
