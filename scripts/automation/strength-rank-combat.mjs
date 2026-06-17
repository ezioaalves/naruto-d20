export const STRENGTH_RANK_COMBAT_TARGET = "strRankCombat";

const STRENGTH_ATTACK_ACTIONS = new Set(["mwak", "rwak", "twak"]);
const STRENGTH_DAMAGE_ACTIONS = new Set(["mwak", "rwak", "twak"]);

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

export function applyStrengthRankCombatToAttack(action, changes, actorChanges = changes, rollData = null) {
  if (!usesStrengthAttack(action, rollData)) return;
  addStrengthRankCombatChanges(changes, actorChanges, "attack", { ablMult: 1 });
}

export function applyStrengthRankCombatToDamage(action, changes, actorChanges = changes, rollData = null) {
  if (!usesStrengthWeaponDamage(action, rollData)) return;
  addStrengthRankCombatChanges(changes, actorChanges, "damage", { ablMult: damageMultiplier(rollData) });
}

function usesStrengthAttack(action, rollData) {
  if (!STRENGTH_ATTACK_ACTIONS.has(action?.actionType)) return false;
  return (rollData?.action?.ability?.attack ?? action?.ability?.attack) === "str";
}

function usesStrengthWeaponDamage(action, rollData) {
  const isNatural = action?.item?.subType === "natural";
  if (!isNatural && !STRENGTH_DAMAGE_ACTIONS.has(action?.actionType)) return false;
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

function addStrengthRankCombatChanges(changes, actorChanges, target, { ablMult = 1 } = {}) {
  for (const change of changeValues(actorChanges)) {
    if (change?.target !== STRENGTH_RANK_COMBAT_TARGET) continue;
    const value = Math.floor(resolveCombatValue(change) * ablMult);
    if (!value) continue;
    changes.push(retargetChange(change, target, value));
  }
  if (actorChanges === changes) {
    for (let i = changes.length - 1; i >= 0; i -= 1) {
      if (changes[i]?.target === STRENGTH_RANK_COMBAT_TARGET) changes.splice(i, 1);
    }
  }
}

/**
 * Resolve @item.strRank.combat against the buff's own roll data.
 *
 * applyChange() cannot compute this at roll time: the actor has no changeOverride
 * for the deferred attack/damage flat paths, so it short-circuits before
 * evaluating the formula. We therefore pre-compute the value here and stamp it on
 * the retargeted change (the same pattern PF1e uses for enhancement-bonus changes).
 */
function resolveCombatValue(change) {
  const RollPF = globalThis.pf1?.dice?.RollPF;
  if (RollPF?.safeRollSync && typeof change?.parent?.getRollData === "function") {
    const rollData = change.parent.getRollData({ refresh: true });
    return Math.floor(RollPF.safeRollSync(change.formula, rollData).total ?? 0);
  }
  const numeric = Number(change?.formula);
  return Number.isFinite(numeric) ? numeric : 0;
}

function changeValues(changes) {
  if (!changes) return [];
  if (Array.isArray(changes)) return changes;
  if (typeof changes.values === "function") return changes.values();
  return changes;
}

function retargetChange(change, target, value) {
  const data = typeof change.toObject === "function" ? change.toObject() : { ...change };
  data.target = target;
  data.formula = String(value);
  data.value = value;
  return typeof change.constructor === "function" && typeof change.applyChange === "function"
    ? new change.constructor(data, { parent: change.parent, strict: false })
    : data;
}
