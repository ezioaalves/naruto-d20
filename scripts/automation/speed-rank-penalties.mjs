import { getRankBuffFlag, isRankBuffItem } from "./rank-buffs.mjs";

// "immobilized" excluded — not a native PF1e 11.11 condition; would only work
// if a module registers a custom ActiveEffect status with that exact ID.
const IMMOBILIZING_CONDITIONS = ["helpless", "paralyzed", "grappled", "pinned"];

export function registerSpeedRankPenalties() {
  Hooks.on("pf1GetRollData", _onGetRollData);
}

function _onGetRollData(item, data) {
  if (!isRankBuffItem(item) || getRankBuffFlag(item)?.key !== "KOUSOKU") return;
  const actor = item.actor;
  if (!actor) return;

  const flag = getRankBuffFlag(item);
  const baseLevel = flag?.level ?? item.system?.level ?? 0;
  const effectiveLevel = _computeEffectiveLevel(actor, data, baseLevel);

  // Table caps: Jump and Hide cap at +10 (rank 10 → +10, not +11)
  data.item.speedRank = {
    level:  effectiveLevel,
    jump:   effectiveLevel > 0 ? Math.min(effectiveLevel + 1, 10) : 0,
    dodge:  effectiveLevel,
    attack: Math.floor(effectiveLevel / 2),
    speed:  effectiveLevel > 0 ? (effectiveLevel === 10 ? 60 : effectiveLevel * 5 + 5) : 0,
    hide:   effectiveLevel > 0 ? Math.min(effectiveLevel + 1, 10) : 0,
    cmb:    -Math.floor(effectiveLevel / 2),
  };
}

function _computeEffectiveLevel(actor, data, baseLevel) {
  for (const cond of IMMOBILIZING_CONDITIONS) {
    if (actor.statuses?.has(cond)) return 0;
  }
  // Use PF1e's consolidated armor type (accounts for isActive, containers, HP, quantity)
  const armorType = data.armor?.type ?? 0;
  const armorPenalty = armorType >= 3 ? 3 : armorType >= 2 ? 1 : 0;
  return Math.max(0, baseLevel - armorPenalty);
}
