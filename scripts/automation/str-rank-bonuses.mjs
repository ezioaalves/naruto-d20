import { getRankBuffFlag, isRankBuffItem } from "./rank-buffs.mjs";

const STR_RANK_TABLE = {
  1:  { combat: 1, actions: 0,  carryMult: 1   },
  2:  { combat: 1, actions: 2,  carryMult: 1.5 },
  3:  { combat: 2, actions: 4,  carryMult: 2   },
  4:  { combat: 2, actions: 6,  carryMult: 2   },
  5:  { combat: 3, actions: 8,  carryMult: 2.5 },
  6:  { combat: 4, actions: 10, carryMult: 2.5 },
  7:  { combat: 4, actions: 10, carryMult: 3   },
  8:  { combat: 5, actions: 11, carryMult: 3   },
  9:  { combat: 5, actions: 11, carryMult: 3.5 },
  10: { combat: 6, actions: 12, carryMult: 4   },
};

export function registerStrRankBonuses() {
  Hooks.on("pf1GetRollData", _onGetRollData);
}

function _onGetRollData(item, data) {
  if (!isRankBuffItem(item) || getRankBuffFlag(item)?.key !== "JOURYOKU") return;
  const flag = getRankBuffFlag(item);
  const level = Math.max(0, Math.min(10, flag?.level ?? item.system?.level ?? 0));
  const row = STR_RANK_TABLE[level] ?? { combat: 0, actions: 0, carryMult: 1 };
  data.item.strRank = { level, ...row };
}
