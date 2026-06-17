/**
 * Shared helpers for injecting rank bonuses into attack/damage rolls at roll time.
 *
 * Rank "Combat"/"Attack" bonuses are stored on custom **deferred** buff targets
 * (e.g. `strRankCombat`, `speedRankAttack`) that map to no actor data path, so
 * PF1e's data-prep changes engine never writes them anywhere — they cannot leak
 * into CMB, CMD, ability checks, or the static attack bonus. Instead we read them
 * off `actor.changes` inside the `pf1PreAttackRoll`/`pf1PreDamageRoll` hooks and
 * push pre-computed copies retargeted to `attack`/`damage` into that roll only.
 */

/**
 * Read every change with `sourceTarget` from `actorChanges`, and push a copy
 * retargeted to `destTarget` (with a pre-computed value) into `changes`.
 *
 * @param {ItemChange[]} changes - The per-roll change array from the hook (mutated).
 * @param {Iterable<ItemChange>} actorChanges - `actor.changes` (Collection) or an array.
 * @param {string} sourceTarget - Custom deferred target to read (e.g. `strRankCombat`).
 * @param {string} destTarget - Roll target to write (`attack` or `damage`).
 * @param {{ ablMult?: number }} [options] - `ablMult` scales the value (weapon damage multiplier).
 */
export function injectDeferredChanges(
  changes,
  actorChanges,
  sourceTarget,
  destTarget,
  { ablMult = 1 } = {},
) {
  for (const change of changeValues(actorChanges)) {
    if (change?.target !== sourceTarget) continue;
    const value = Math.floor(resolveDeferredValue(change) * ablMult);
    if (!value) continue;
    changes.push(retargetChange(change, destTarget, value));
  }
}

/**
 * Resolve a change's formula against the buff's own roll data.
 *
 * applyChange() cannot compute this at roll time: the actor has no changeOverride
 * for the deferred attack/damage flat paths, so it short-circuits (`if (!override)
 * continue`) before evaluating the formula and leaves `value` at 0. We therefore
 * pre-compute the value here and stamp it on the retargeted change — the same
 * pattern PF1e uses for its enhancement-bonus changes.
 */
export function resolveDeferredValue(change) {
  const RollPF = globalThis.pf1?.dice?.RollPF;
  if (RollPF?.safeRollSync && typeof change?.parent?.getRollData === "function") {
    const rollData = change.parent.getRollData({ refresh: true });
    return Math.floor(RollPF.safeRollSync(change.formula, rollData).total ?? 0);
  }
  const numeric = Number(change?.formula);
  return Number.isFinite(numeric) ? numeric : 0;
}

const COMBAT_MANEUVER_ACTIONS = new Set(["mcman", "rcman"]);

/**
 * True when the action is a combat maneuver (CMB) roll. Used to keep
 * "attack-only" deferred bonuses off CMB, since maneuver attack rolls otherwise
 * pick up `attack`-targeted changes.
 */
export function isCombatManeuver(action) {
  return action?.isCombatManeuver === true || COMBAT_MANEUVER_ACTIONS.has(action?.actionType);
}

export function changeValues(changes) {
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
