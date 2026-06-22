import { MODULE_ID, CHAKRA_DEPLETION_CONDITION_ID } from "../../core/constants.mjs";
import {
  chakraPoolValuePath,
  chakraPoolTempPath,
  chakraReserveValuePath,
} from "../../core/flag-paths.mjs";
import { checkAndUpdateConditions } from "./conditions.mjs";

/**
 * Naruto D20 — Chakra recovery on rest.
 *
 * Rules (mirrors how PF1e treats analogous resources):
 *  - Pool     → restored based on Chakra Depletion state (see below)
 *  - Temp     → always cleared (temporary by nature)
 *  - Reserve  → recovers actor.system.attributes.hd.total points, capped at max
 *               (like HP, gated on restoreHealth; same hd.total metric PF1e uses for HP)
 *
 * Chakra Pool recovery (gated on restoreDailyUses):
 *  - Normal rest:             pool restored to full max
 *  - Chakra Depletion active: pool recovers floor(max / 4), capped at max
 *  - Chakra Depletion + longTermCare (absolute rest): recovers floor(max / 2), capped at max
 *
 * After the update, checkAndUpdateConditions re-evaluates whether the conditions
 * should be removed (e.g., if reserve was fully restored).
 *
 * @param {ActorPF} actor
 * @param {ActorRestOptions} options  — { restoreHealth, restoreDailyUses, hours, longTermCare }
 */
export function onActorRest(actor, options) {
  if (!["character", "npc"].includes(actor.type)) return;

  const chakra = actor.flags?.[MODULE_ID]?.chakra;
  if (!chakra) return;

  const updates = {};

  // Temp chakra — always cleared on any rest (it is inherently temporary)
  updates[chakraPoolTempPath] = 0;

  // Chakra Pool — recovery amount depends on whether Chakra Depletion is active
  if (options.restoreDailyUses !== false) {
    const currentPool = chakra.pool.value ?? 0;
    const poolMax = chakra.pool.max ?? 0;
    const hasDepletion = actor.statuses?.has(CHAKRA_DEPLETION_CONDITION_ID) ?? false;

    let nextPoolValue;
    if (hasDepletion) {
      // Depleted: partial recovery rate — doubled if the actor is under long-term care.
      const recoveredPool = options.longTermCare
        ? Math.floor(poolMax / 2)
        : Math.floor(poolMax / 4);
      nextPoolValue = Math.min(currentPool + recoveredPool, poolMax);
    } else {
      nextPoolValue = poolMax;
    }

    updates[chakraPoolValuePath] = nextPoolValue;
  }

  // Chakra Reserve — recovers 1 point per HD (same metric PF1e uses for HP recovery)
  if (options.restoreHealth !== false) {
    const hdTotal = actor.system.attributes?.hd?.total ?? 0;
    const current = chakra.reserve.value ?? 0;
    const max = chakra.reserve.max ?? 0;
    updates[chakraReserveValuePath] = Math.min(current + hdTotal, max);
  }

  // fire-and-forget — matching the existing pattern (no top-level await in this module)
  actor.update(updates).then(() => checkAndUpdateConditions(actor));
}
