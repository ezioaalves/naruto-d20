import { getRankBuffFlag, rankGrantLevel } from "./rank-buffs.mjs";
import {
  computeEffectiveRank,
  speedRankPenalty,
  speedRankValues,
  strRankValues,
} from "./rank-effective-level.mjs";

export function registerRankRollData() {
  Hooks.on("pf1GetRollData", _onGetRollData);
}

function _onGetRollData(item, data) {
  const flag = getRankBuffFlag(item);
  if (!flag || item.type !== "buff" || !item.actor) return;

  let level;
  if (!item.system?.active) {
    // Inactive buffs contribute no changes; inject a standalone preview so
    // the sheet's Changes tab still shows this buff's own numbers.
    level = _standaloneEffective(item, data, flag.key);
  } else {
    const { effective, carrierId } = computeEffectiveRank(item.actor, flag.key, {
      rollData: data,
    });
    // Only the carrier's changes apply the effective values; every other
    // active rank buff of this key is zeroed to prevent double application.
    level = item.id === carrierId ? effective : 0;
  }

  if (flag.key === "KOUSOKU") data.item.speedRank = speedRankValues(level);
  else data.item.strRank = strRankValues(level);
}

function _standaloneEffective(item, data, key) {
  const level = rankGrantLevel(item);
  const penalty = key === "KOUSOKU" ? speedRankPenalty(item.actor, data) : 0;
  return penalty === Infinity ? 0 : Math.clamp(level - penalty, 0, 10);
}
