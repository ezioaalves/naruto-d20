import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../core/constants.mjs";

export const TRAINING_WEIGHT_ITEM_FLAG = "trainingWeightItem";
export const TRAINING_WEIGHT_TECHNIQUE_FLAG = "trainingWeightTechnique";

export const TRAINING_WEIGHT_TABLE = Object.freeze({
  1: Object.freeze({ weight: 25, rankPenalty: 1, learnBonus: 1, learnedStrengthRank: 1 }),
  2: Object.freeze({ weight: 37.5, rankPenalty: 2, learnBonus: 2, learnedStrengthRank: 2 }),
  3: Object.freeze({ weight: 50, rankPenalty: 3, learnBonus: 3, learnedStrengthRank: 3 }),
  4: Object.freeze({ weight: 62.5, rankPenalty: 4, learnBonus: 4, learnedStrengthRank: 4 }),
  5: Object.freeze({ weight: 75, rankPenalty: 5, learnBonus: 5, learnedStrengthRank: 5 }),
  6: Object.freeze({ weight: 150, rankPenalty: 6, learnBonus: 5, learnedStrengthRank: 6 }),
  7: Object.freeze({ weight: 250, rankPenalty: 8, learnBonus: 5, learnedStrengthRank: 8 }),
  8: Object.freeze({ weight: 500, rankPenalty: 10, learnBonus: 5, learnedStrengthRank: 10 }),
});

const RANK_WORDS = Object.freeze({
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SHODAN: 1,
  NIDAN: 2,
  SANDAN: 3,
  YONDAN: 4,
  GODAN: 5,
});

export function getTrainingWeightItemFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[TRAINING_WEIGHT_ITEM_FLAG];
  if (!flag) return null;
  if (!["wrist", "ankle"].includes(flag.slot)) return null;
  if (!TRAINING_WEIGHT_TABLE[Number(flag.type)]) return null;
  return {
    slot: flag.slot,
    type: Number(flag.type),
    rankPenalty: Number(flag.rankPenalty ?? TRAINING_WEIGHT_TABLE[flag.type].rankPenalty),
    learnBonus: Number(flag.learnBonus ?? TRAINING_WEIGHT_TABLE[flag.type].learnBonus),
  };
}

export function getTrainingWeightTechniqueFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[TRAINING_WEIGHT_TECHNIQUE_FLAG];
  if (!flag) return inferTrainingWeightTechniqueFlag(item);
  return {
    eligibleRankKey: ["KOUSOKU", "JOURYOKU"].includes(flag.eligibleRankKey)
      ? flag.eligibleRankKey
      : "",
    learnedStrengthRank: Math.max(0, Number(flag.learnedStrengthRank) || 0),
  };
}

function inferTrainingWeightTechniqueFlag(item) {
  const name = String(item?.name ?? "").toUpperCase();
  const nameMatch = name.match(/\b(SHODAN|NIDAN|SANDAN|YONDAN|GODAN)\s+(KOUSOKU|JOURYOKU)\b/);
  if (nameMatch) {
    const eligibleRankKey = nameMatch[2];
    return {
      eligibleRankKey,
      learnedStrengthRank: eligibleRankKey === "JOURYOKU" ? RANK_WORDS[nameMatch[1]] : 0,
    };
  }

  const rankNameMatch = name.match(/\bRANK\s+(ONE|TWO|THREE|FOUR|FIVE|[1-5])\s+(SPEED|STRENGTH)\b/);
  if (!rankNameMatch) return null;

  const rank = Number(rankNameMatch[1]) || RANK_WORDS[rankNameMatch[1]];
  const eligibleRankKey = rankNameMatch[2] === "SPEED" ? "KOUSOKU" : "JOURYOKU";
  return {
    eligibleRankKey,
    learnedStrengthRank: eligibleRankKey === "JOURYOKU" ? rank : 0,
  };
}

function isEffectiveTrainingWeightItem(item) {
  const flag = getTrainingWeightItemFlag(item);
  if (!flag) return false;
  if (item?.type !== "loot") return false;
  if (item?.system?.subType !== "gear") return false;
  if (!item?.isPhysical) return false;
  if (item?.inContainer) return false;
  if (!item?.isActive) return false;
  if ((Number(item?.system?.quantity ?? 0) || 0) <= 0) return false;
  if (item?.system?.carried === false) return false;
  return true;
}

function isCarriedTrainingWeightItem(item) {
  const flag = getTrainingWeightItemFlag(item);
  if (!flag) return false;
  if (item?.type !== "loot") return false;
  if (item?.system?.subType !== "gear") return false;
  if (!item?.isPhysical) return false;
  if (item?.inContainer) return false;
  if ((Number(item?.system?.quantity ?? 0) || 0) <= 0) return false;
  if (item?.system?.carried === false) return false;
  return true;
}

function chooseSlotItem(actor, slot) {
  let chosen = null;
  for (const item of actor?.items ?? []) {
    if (!isEffectiveTrainingWeightItem(item)) continue;
    const flag = getTrainingWeightItemFlag(item);
    if (!flag || flag.slot !== slot) continue;
    const candidate = {
      itemId: item.id ?? item._id ?? item.name,
      slot,
      type: flag.type,
      rankPenalty: flag.rankPenalty,
      learnBonus: flag.learnBonus,
      weight:
        Number(
          item.system?.weight?.total ??
            item.system?.weight?.value ??
            TRAINING_WEIGHT_TABLE[flag.type].weight,
        ) || 0,
    };
    if (
      !chosen ||
      candidate.type > chosen.type ||
      (candidate.type === chosen.type &&
        String(candidate.itemId).localeCompare(String(chosen.itemId)) < 0)
    ) {
      chosen = candidate;
    }
  }
  return chosen;
}

export function getHighestLearnedStrengthRank(actor) {
  let highest = 0;
  for (const item of actor?.items ?? []) {
    if (item?.type !== TECHNIQUE_ITEM_TYPE) continue;
    if (item?.system?.learning?.learned !== true) continue;
    const flag = getTrainingWeightTechniqueFlag(item);
    if (!flag) continue;
    highest = Math.max(highest, flag.learnedStrengthRank);
  }
  return highest;
}

export function getIgnoredTrainingWeightTotal(actor) {
  const highest = getHighestLearnedStrengthRank(actor);
  let total = 0;
  for (const item of actor?.items ?? []) {
    if (!isCarriedTrainingWeightItem(item)) continue;
    const flag = getTrainingWeightItemFlag(item);
    const row = TRAINING_WEIGHT_TABLE[flag.type];
    if (highest >= row.learnedStrengthRank) {
      total += Number(item.system?.weight?.total ?? item.system?.weight?.value ?? row.weight) || 0;
    }
  }
  return total;
}

export function getTrainingWeightState(actor) {
  const wrist = chooseSlotItem(actor, "wrist");
  const ankle = chooseSlotItem(actor, "ankle");
  const highestLearnedStrengthRank = getHighestLearnedStrengthRank(actor);
  const hasFullSet = Boolean(wrist && ankle);
  const fullSetType = hasFullSet ? Math.min(wrist.type, ankle.type) : null;
  const fullSetLearnBonus = fullSetType ? TRAINING_WEIGHT_TABLE[fullSetType].learnBonus : 0;
  return {
    wrist,
    ankle,
    hasFullSet,
    fullSetType,
    fullSetLearnBonus,
    strengthRankPenalty: wrist?.rankPenalty ?? 0,
    speedRankPenalty: ankle?.rankPenalty ?? 0,
    highestLearnedStrengthRank,
    ignoredCarryWeight: getIgnoredTrainingWeightTotal(actor),
  };
}

export function getTrainingWeightLearnBonus(actor, technique) {
  const state = getTrainingWeightState(actor);
  if (!state.hasFullSet) return null;
  const flag = getTrainingWeightTechniqueFlag(technique);
  if (!flag?.eligibleRankKey) return null;
  return {
    value: state.fullSetLearnBonus,
    type: state.fullSetType,
    eligibleRankKey: flag.eligibleRankKey,
  };
}
