import { injectDeferredChanges, isCombatManeuver } from "./rank-roll-injection.mjs";

export const SPEED_RANK_ATTACK_TARGET = "speedRankAttack";

/**
 * Register Speed Rank attack as a roll-time-only PF1e change target.
 *
 * The KOUSOKU buff stores @item.speedRank.attack on this custom deferred target so
 * PF1e does not write it to `system.attributes.attack.general` during data prep —
 * which would otherwise inflate the static CMB (cmb.total includes the general
 * attack bonus) and force a negative `cmb` compensation change. At roll time we
 * inject the bonus into every attack roll EXCEPT combat maneuvers, so it reaches
 * weapon/natural/spell attacks but never CMB. The Dodge → AC change keeps feeding
 * CMD as before.
 */
export function registerSpeedRankAttack() {
  if (CONFIG.PF1) {
    CONFIG.PF1.buffTargets[SPEED_RANK_ATTACK_TARGET] = {
      label: game.i18n.localize("NarutoD20.BuffTargets.SpeedRankAttack"),
      category: "attack",
      sort: 116600,
      deferred: true,
    };
  }

  Hooks.on("pf1PreAttackRoll", (action, _config, _rollData, _rollOptions, _parts, changes) => {
    applySpeedRankAttack(action, changes, action?.item?.actor?.changes);
  });
}

export function applySpeedRankAttack(action, changes, actorChanges = changes) {
  if (isCombatManeuver(action)) return;
  injectDeferredChanges(changes, actorChanges, SPEED_RANK_ATTACK_TARGET, "attack");
}
