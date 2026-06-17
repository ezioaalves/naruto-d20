import { injectDeferredChanges, isCombatManeuver } from "./rank-roll-injection.mjs";

export const ATTACK_NO_MANEUVER_TARGET = "attackNoManeuver";

/**
 * Register a generic "attack roll, but not CMB" deferred change target.
 *
 * Buffs that grant a flat attack-roll bonus (e.g. the Champuru stances) should
 * use this target instead of the native `attack` target. PF1e writes `attack` to
 * `system.attributes.attack.general` during data prep, and `cmb.total` includes
 * that general attack bonus, so a plain `attack` bonus leaks into CMB. This
 * deferred target maps to no actor data path, so it never reaches CMB, CMD, or
 * the static attack bonus; at roll time we inject it into every attack roll
 * EXCEPT combat maneuvers.
 */
export function registerAttackNoManeuver() {
  if (CONFIG.PF1) {
    CONFIG.PF1.buffTargets[ATTACK_NO_MANEUVER_TARGET] = {
      label: game.i18n.localize("NarutoD20.BuffTargets.AttackNoManeuver"),
      category: "attack",
      sort: 116700,
      deferred: true,
    };
  }

  Hooks.on("pf1PreAttackRoll", (action, _config, _rollData, _rollOptions, _parts, changes) => {
    applyAttackNoManeuver(action, changes, action?.item?.actor?.changes);
  });
}

export function applyAttackNoManeuver(action, changes, actorChanges = changes) {
  if (isCombatManeuver(action)) return;
  injectDeferredChanges(changes, actorChanges, ATTACK_NO_MANEUVER_TARGET, "attack");
}
