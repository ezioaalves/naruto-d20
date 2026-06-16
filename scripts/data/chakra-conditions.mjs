import {
  MODULE_ID,
  LOW_RESERVES_CONDITION_ID,
  CHAKRA_DEPLETION_CONDITION_ID,
} from "../constants.mjs";
import {
  conditionAppliedExhaustedPath,
  conditionAppliedFatiguedPath,
  conditionDepletionActivePath,
  conditionLowReserveFatiguePendingPath,
} from "../flag-paths.mjs";

const MODULE_CONDITION_OWNER_FLAG = "conditionOwner";
const MODULE_CONDITION_STATUS_FLAG = "conditionStatus";

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

export function registerChakraConditionCombatHooks() {
  Hooks.on("deleteCombat", (combat) => {
    const actors = new Set();
    for (const combatant of combat.combatants ?? []) {
      if (combatant.actor) actors.add(combatant.actor);
    }
    for (const actor of actors) {
      if (!actor.activeOwner?.isSelf) continue;
      checkAndUpdateConditions(actor);
    }
  });
}

// ── Condition evaluation ──────────────────────────────────────────────────

export function resolveChakraConditionState({
  reserveValue = 0,
  reserveMax = 0,
  poolValue = 0,
  poolMax = 0,
  depletionActive = false,
  lowReserveFatiguePending = false,
  inCombat = false,
} = {}) {
  const reservePct = reserveMax > 0 ? reserveValue / reserveMax : 1;
  const fullReserve = reserveMax <= 0 || reserveValue >= reserveMax;
  const fullPool = poolMax <= 0 || poolValue >= poolMax;
  const fullyRecovered = fullReserve && fullPool;

  let nextDepletionActive = depletionActive || reserveValue <= 0;
  if (nextDepletionActive && fullyRecovered) nextDepletionActive = false;

  if (nextDepletionActive) {
    return {
      wantsLowReserves: false,
      wantsDepletion: true,
      wantsFatigued: reservePct >= 0.5,
      wantsExhausted: reservePct < 0.5,
      depletionActive: true,
      lowReserveFatiguePending: false,
    };
  }

  const wantsLowReserves = reserveValue > 0 && reservePct < 0.5;
  const immediateLowReserveFatigue = wantsLowReserves && (reservePct < 0.25 || !inCombat);
  const nextPending =
    wantsLowReserves && !immediateLowReserveFatigue
      ? true
      : wantsLowReserves && lowReserveFatiguePending && inCombat;

  return {
    wantsLowReserves,
    wantsDepletion: false,
    wantsFatigued:
      immediateLowReserveFatigue || (wantsLowReserves && lowReserveFatiguePending && !inCombat),
    wantsExhausted: false,
    depletionActive: false,
    lowReserveFatiguePending: Boolean(nextPending && !immediateLowReserveFatigue),
  };
}

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
  const poolValue = chakra.pool?.value ?? 0;
  const poolMax = chakra.pool?.max ?? 0;

  // Previously-tracked implied PF1e conditions (which conditions WE applied)
  const tracked = actor.flags?.[MODULE_ID]?.conditions ?? {};
  const hadFatigued = tracked.appliedFatigued ?? false;
  const hadExhausted = tracked.appliedExhausted ?? false;
  const hadDepletionActive = tracked.depletionActive ?? false;
  const hadLowReserveFatiguePending = tracked.lowReserveFatiguePending ?? false;
  const inCombat = actorIsInStartedCombat(actor);
  const state = resolveChakraConditionState({
    reserveValue,
    reserveMax,
    poolValue,
    poolMax,
    depletionActive: hadDepletionActive,
    lowReserveFatiguePending: hadLowReserveFatiguePending,
    inCombat,
  });

  // Build the setConditions payload
  const condUpdates = {
    [LOW_RESERVES_CONDITION_ID]: state.wantsLowReserves,
    [CHAKRA_DEPLETION_CONDITION_ID]: state.wantsDepletion,
  };

  let newAppliedFatigued = hadFatigued;
  let newAppliedExhausted = hadExhausted;
  const pf1ConditionEffectIdsToDelete = [];

  await _removeLegacyNamespacedConditions(actor);

  if (state.wantsExhausted) {
    condUpdates.exhausted = moduleOwnedConditionData("exhausted");
  } else if (hadExhausted) {
    pf1ConditionEffectIdsToDelete.push(...moduleOwnedConditionEffectIds(actor, "exhausted"));
    newAppliedExhausted = false;
  }

  if (state.wantsFatigued) {
    condUpdates.fatigued = moduleOwnedConditionData("fatigued");
  } else if (hadFatigued) {
    pf1ConditionEffectIdsToDelete.push(...moduleOwnedConditionEffectIds(actor, "fatigued"));
    newAppliedFatigued = false;
  }

  if (pf1ConditionEffectIdsToDelete.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", pf1ConditionEffectIdsToDelete, {
      pf1: { updateConditionTracks: false },
    });
  }

  const appliedConditions = await actor.setConditions(condUpdates);
  if (state.wantsExhausted) {
    newAppliedExhausted =
      actorHasModuleOwnedConditionEffect(actor, "exhausted") ||
      (Object.hasOwn(appliedConditions ?? {}, "exhausted") &&
        !actorHasDirectConditionEffect(actor, "exhausted"));
  }
  if (state.wantsFatigued) {
    newAppliedFatigued =
      actorHasModuleOwnedConditionEffect(actor, "fatigued") ||
      (Object.hasOwn(appliedConditions ?? {}, "fatigued") &&
        !actorHasDirectConditionEffect(actor, "fatigued"));
  }

  // Persist tracking flags — only if something changed to avoid an extra round-trip
  if (
    newAppliedFatigued !== hadFatigued ||
    newAppliedExhausted !== hadExhausted ||
    state.depletionActive !== hadDepletionActive ||
    state.lowReserveFatiguePending !== hadLowReserveFatiguePending
  ) {
    await actor.update({
      [conditionAppliedFatiguedPath]: newAppliedFatigued,
      [conditionAppliedExhaustedPath]: newAppliedExhausted,
      [conditionDepletionActivePath]: state.depletionActive,
      [conditionLowReserveFatiguePendingPath]: state.lowReserveFatiguePending,
    });
  }
}

function actorIsInStartedCombat(actor) {
  return actor.getCombatants?.().some((combatant) => combatant.combat?.started) ?? false;
}

function moduleOwnedConditionData(status) {
  return {
    flags: {
      [MODULE_ID]: {
        [MODULE_CONDITION_OWNER_FLAG]: true,
        [MODULE_CONDITION_STATUS_FLAG]: status,
      },
    },
  };
}

function moduleOwnedConditionEffectIds(actor, status) {
  const statusEffects = (actor.effects ?? []).filter((effect) => effect.statuses?.has(status));
  const ownedEffectIds = statusEffects
    .filter((effect) => isModuleOwnedConditionEffect(effect, status))
    .map((effect) => effect.id);

  if (ownedEffectIds.length) return ownedEffectIds;
  return [];
}

function actorHasDirectConditionEffect(actor, status) {
  return (actor.effects ?? []).some((effect) => effect.statuses?.has(status));
}

function actorHasModuleOwnedConditionEffect(actor, status) {
  return (actor.effects ?? []).some((effect) => isModuleOwnedConditionEffect(effect, status));
}

function isModuleOwnedConditionEffect(effect, status) {
  const moduleFlags = effect.flags?.[MODULE_ID] ?? {};
  return (
    moduleFlags[MODULE_CONDITION_OWNER_FLAG] === true &&
    (moduleFlags[MODULE_CONDITION_STATUS_FLAG] ?? status) === status
  );
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
