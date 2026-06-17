import { injectDeferredChanges } from "./rank-roll-injection.mjs";

export const STRENGTH_RANK_COMBAT_TARGET = "strRankCombat";

const WEAPON_ACTION_TYPES = new Set(["mwak", "rwak", "twak"]);

/**
 * Register Strength Rank combat as a roll-time-only PF1e change target.
 *
 * The buff stores @item.strRank.combat on a custom deferred target so PF1e does
 * not add it to the actor's global Strength modifier during data preparation.
 * At roll time we read those changes off the actor and inject pre-computed copies
 * retargeted to attack/damage, so the bonus only ever reaches attack and weapon
 * damage rolls (never CMB/CMD/Strength checks).
 */
export function registerStrengthRankCombat() {
  if (CONFIG.PF1) {
    CONFIG.PF1.buffTargets[STRENGTH_RANK_COMBAT_TARGET] = {
      label: game.i18n.localize("NarutoD20.BuffTargets.StrRankCombat"),
      category: "attack",
      sort: 116500,
      deferred: true,
    };
  }

  Hooks.on("pf1PreAttackRoll", (action, _config, rollData, _rollOptions, _parts, changes) => {
    applyStrengthRankCombatToAttack(action, changes, action?.item?.actor?.changes, rollData);
  });

  Hooks.on("pf1PreDamageRoll", (action, rollData, _parts, changes) => {
    applyStrengthRankCombatToDamage(action, changes, action?.item?.actor?.changes, rollData);
  });
}

export function applyStrengthRankCombatToAttack(
  action,
  changes,
  actorChanges = changes,
  rollData = null,
) {
  if (!usesStrengthAttack(action, rollData)) return;
  injectDeferredChanges(changes, actorChanges, STRENGTH_RANK_COMBAT_TARGET, "attack");
}

export function applyStrengthRankCombatToDamage(
  action,
  changes,
  actorChanges = changes,
  rollData = null,
) {
  if (!usesStrengthWeaponDamage(action, rollData)) return;
  injectDeferredChanges(changes, actorChanges, STRENGTH_RANK_COMBAT_TARGET, "damage", {
    ablMult: damageMultiplier(rollData),
  });
}

function usesStrengthAttack(action, rollData) {
  if (!WEAPON_ACTION_TYPES.has(action?.actionType)) return false;
  return (rollData?.action?.ability?.attack ?? action?.ability?.attack) === "str";
}

function usesStrengthWeaponDamage(action, rollData) {
  const isNatural = action?.item?.subType === "natural";
  if (!isNatural && !WEAPON_ACTION_TYPES.has(action?.actionType)) return false;
  return (rollData?.action?.ability?.damage ?? action?.ability?.damage) === "str";
}

/**
 * The ability-damage multiplier for the current weapon (e.g. x1.5 two-handed).
 * Set by PF1e on the action roll data before the pre-damage hook fires.
 */
function damageMultiplier(rollData) {
  const mult = Number(rollData?.ablMult);
  return Number.isFinite(mult) && mult > 0 ? mult : 1;
}
