import { getRankGrantType, rankGrantLevel } from "./rank-buffs.mjs";
import { getRankMaintenanceFlag } from "./maintenance-buffs.mjs";

// "immobilized" excluded — not a native PF1e 11.11 condition; would only work
// if a module registers a custom ActiveEffect status with that exact ID.
export const IMMOBILIZING_CONDITIONS = ["helpless", "paralyzed", "grappled", "pinned"];

const STR_RANK_TABLE = {
  1: { combat: 1, actions: 0, carryMult: 1 },
  2: { combat: 1, actions: 2, carryMult: 1.5 },
  3: { combat: 2, actions: 4, carryMult: 2 },
  4: { combat: 2, actions: 6, carryMult: 2 },
  5: { combat: 3, actions: 8, carryMult: 2.5 },
  6: { combat: 4, actions: 10, carryMult: 2.5 },
  7: { combat: 4, actions: 10, carryMult: 3 },
  8: { combat: 5, actions: 11, carryMult: 3 },
  9: { combat: 5, actions: 11, carryMult: 3.5 },
  10: { combat: 6, actions: 12, carryMult: 4 },
};

/**
 * Combine every active rank buff of `key` on the actor into a single
 * effective rank, per the Strength/Speed Ranks rules:
 *   - "paid" buffs (technique-created) provide the base active rank (max)
 *   - "temp" grants do not stack with other ranks — max with paid
 *   - "bonus" grants stack — summed on top
 *   - effective = clamp(max(paid, temp) + bonus − penalty, 0, 10)
 *
 * The carrier is the one buff whose changes should carry the effective
 * values in its roll data; every other rank buff of the same key is zeroed
 * so their identical change sets don't double-apply.
 *
 * `rollData` must be the roll data already being built for the buff item
 * (it embeds the actor's data, e.g. `armor.type`) — do not call
 * `actor.getRollData()` here, that would recurse.
 */
export function computeEffectiveRank(actor, key, { rollData } = {}) {
  let paid = 0;
  let temp = 0;
  let bonus = 0;
  let carrier = null;
  let paidCarrier = null;

  for (const item of actor?.items ?? []) {
    if (item.type !== "buff" || !item.system?.active) continue;
    if (getRankMaintenanceFlag(item)?.key !== key) continue;

    const level = rankGrantLevel(item);
    switch (getRankGrantType(item)) {
      case "paid":
        if (!paidCarrier || level > paid) paidCarrier = item;
        paid = Math.max(paid, level);
        break;
      case "temp":
        temp = Math.max(temp, level);
        break;
      case "bonus":
        bonus += level;
        break;
    }

    if (!carrier || item.id.localeCompare(carrier.id) < 0) carrier = item;
  }

  // A paid buff always carries; otherwise lowest item id (deterministic across clients)
  if (paidCarrier) carrier = paidCarrier;

  const penalty = key === "KOUSOKU" ? speedRankPenalty(actor, rollData) : 0;
  const effective =
    penalty === Infinity ? 0 : Math.clamp(Math.max(paid, temp) + bonus - penalty, 0, 10);

  return {
    paid,
    temp,
    bonus,
    penalty: penalty === Infinity ? null : penalty,
    effective,
    carrierId: carrier?.id ?? null,
  };
}

/**
 * Armor/condition penalties apply only to Speed Ranks.
 * Returns Infinity when an immobilizing condition zeroes the rank outright.
 */
export function speedRankPenalty(actor, rollData) {
  for (const cond of IMMOBILIZING_CONDITIONS) {
    if (actor?.statuses?.has(cond)) return Infinity;
  }
  // Use PF1e's consolidated armor type (accounts for isActive, containers, HP, quantity)
  const armorType = rollData?.armor?.type ?? 0;
  return armorType >= 3 ? 3 : armorType >= 2 ? 1 : 0;
}

// Table caps: Jump and Hide cap at +10 (rank 10 → +10, not +11)
export function speedRankValues(level) {
  return {
    level,
    jump: level > 0 ? Math.min(level + 1, 10) : 0,
    dodge: level,
    attack: Math.floor(level / 2),
    speed: level > 0 ? (level === 10 ? 60 : level * 5 + 5) : 0,
    hide: level > 0 ? Math.min(level + 1, 10) : 0,
    cmb: -Math.floor(level / 2),
  };
}

// Level 0 (or out of range) must be all zeros — including carryMult — so a
// zeroed non-carrier buff contributes nothing through its changes.
export function strRankValues(level) {
  const row = STR_RANK_TABLE[level] ?? { combat: 0, actions: 0, carryMult: 0 };
  return { level, ...row };
}
