import {
  MODULE_ID,
  LOW_RESERVES_CONDITION_ID,
  CHAKRA_DEPLETION_CONDITION_ID,
} from "../constants.mjs";
import { conditionAppliedExhaustedPath, conditionAppliedFatiguedPath } from "../flag-paths.mjs";

/**
 * Naruto D20 — Chakra Condition System
 *
 * Two custom conditions are registered with PF1e's condition registry and applied
 * automatically based on the actor's Chakra Reserve level:
 *
 *   lowReserves     → reserve > 0 AND reserve / max < 0.50 → implies fatigued
 *   chakraDepletion → reserve == 0                         → implies exhausted
 *
 * Conditions are mutually exclusive (depletion supersedes low reserves).
 *
 * The "Emergency Transfer" mechanic (handled in use-technique.mjs):
 *   After a technique spends from temp chakra and pool, if pool.value would
 *   reach 0 but reserve.value > 0, the body automatically zeroes the reserve
 *   and returns 1 chakra to the pool. This means pool == 0 is only possible
 *   when reserve == 0 — and therefore always triggers depletion.
 *
 * PF1e implied conditions (fatigued / exhausted) are applied and removed carefully:
 *   We only remove a PF1e condition if WE were the ones who applied it, tracked via
 *   flags["naruto-d20"].conditions.{appliedFatigued, appliedExhausted}.
 *   This prevents removing conditions that originated from unrelated combat sources.
 */

// ── Condition registration ────────────────────────────────────────────────

/**
 * Register the two naruto-d20 conditions with PF1e's condition registry.
 * Must be called during pf1PostInit (when pf1.registry is available).
 */
export function registerChakraConditions() {
  if (!pf1?.registry?.conditions) {
    console.warn(
      "naruto-d20 | pf1.registry.conditions unavailable — chakra conditions not registered.",
    );
    return;
  }

  pf1.registry.conditions.register(MODULE_ID, LOW_RESERVES_CONDITION_ID, {
    name: game.i18n.localize("NarutoD20.Conditions.LowReserves.Name"),
    texture: "icons/svg/daze.svg",
    hud: { show: true },
    showInAction: false,
    showInDefense: false,
  });

  pf1.registry.conditions.register(MODULE_ID, CHAKRA_DEPLETION_CONDITION_ID, {
    name: game.i18n.localize("NarutoD20.Conditions.ChakraDepletion.Name"),
    texture: "icons/svg/skull.svg",
    hud: { show: true },
    showInAction: false,
    showInDefense: false,
  });

  console.log("naruto-d20 | Chakra conditions registered.");
}

// ── Condition evaluation ──────────────────────────────────────────────────

/**
 * Evaluate the actor's chakra reserve level and apply or remove the two naruto-d20
 * conditions (plus their implied PF1e conditions) accordingly.
 *
 * Must be called AFTER any actor.update() that modifies chakra values so the
 * actor's in-memory state already reflects the new numbers.
 *
 * @param {ActorPF} actor
 */
export async function checkAndUpdateConditions(actor) {
  if (!["character", "npc"].includes(actor.type)) return;

  const chakra = actor.flags?.[MODULE_ID]?.chakra;
  if (!chakra) return;

  const reserveValue = chakra.reserve?.value ?? 0;
  const reserveMax = chakra.reserve?.max ?? 0;

  // Percentage — treat 0-max as 1 (full) to avoid division by zero on new actors
  const reservePct = reserveMax > 0 ? reserveValue / reserveMax : 1;

  const wantsDepletion = reserveValue <= 0;
  const wantsLowReserves = !wantsDepletion && reservePct < 0.5;

  // Previously-tracked implied PF1e conditions (which conditions WE applied)
  const tracked = actor.flags?.[MODULE_ID]?.conditions ?? {};
  const hadFatigued = tracked.appliedFatigued ?? false;
  const hadExhausted = tracked.appliedExhausted ?? false;

  // Build the setConditions payload
  const condUpdates = {
    [LOW_RESERVES_CONDITION_ID]: wantsLowReserves,
    [CHAKRA_DEPLETION_CONDITION_ID]: wantsDepletion,
  };

  let newAppliedFatigued = hadFatigued;
  let newAppliedExhausted = hadExhausted;

  await _removeLegacyNamespacedConditions(actor);

  if (wantsDepletion) {
    // Apply exhausted — track it only if it was not already active from another source
    const exhaustedAlreadyActive = actor.statuses?.has("exhausted") ?? false;
    condUpdates.exhausted = true;
    newAppliedExhausted = !exhaustedAlreadyActive;

    // Remove fatigued if we applied it (depletion supersedes low reserves)
    if (hadFatigued) {
      condUpdates.fatigued = false;
      newAppliedFatigued = false;
    }
  } else {
    // Remove exhausted only if we applied it
    if (hadExhausted) {
      condUpdates.exhausted = false;
      newAppliedExhausted = false;
    }

    if (wantsLowReserves) {
      // Apply fatigued — track it only if it was not already active from another source
      const fatiguedAlreadyActive = actor.statuses?.has("fatigued") ?? false;
      condUpdates.fatigued = true;
      newAppliedFatigued = !fatiguedAlreadyActive;
    } else {
      // Remove fatigued only if we applied it
      if (hadFatigued) {
        condUpdates.fatigued = false;
        newAppliedFatigued = false;
      }
    }
  }

  await actor.setConditions(condUpdates);

  // Persist tracking flags — only if something changed to avoid an extra round-trip
  if (newAppliedFatigued !== hadFatigued || newAppliedExhausted !== hadExhausted) {
    await actor.update({
      [conditionAppliedFatiguedPath]: newAppliedFatigued,
      [conditionAppliedExhaustedPath]: newAppliedExhausted,
    });
  }
}

async function _removeLegacyNamespacedConditions(actor) {
  const legacyIds = new Set([`${MODULE_ID}.lowReserves`, `${MODULE_ID}.chakraDepletion`]);
  const effectIds = actor.effects
    .filter((effect) => [...(effect.statuses ?? [])].some((status) => legacyIds.has(status)))
    .map((effect) => effect.id);

  if (effectIds.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds, {
      pf1: { updateConditionTracks: false },
    });
  }
}
