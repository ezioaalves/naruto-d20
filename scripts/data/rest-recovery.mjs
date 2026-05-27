import { MODULE_ID } from "../constants.mjs";
import {
    chakraPoolValuePath,
    chakraPoolTempPath,
    chakraReserveValuePath,
} from "../flag-paths.mjs";

/**
 * Naruto D20 — Chakra recovery on rest.
 *
 * Rules (mirrors how PF1e treats analogous resources):
 *  - Pool     → restored to max  (like spell points / daily uses, gated on restoreDailyUses)
 *  - Temp     → always cleared   (temporary by nature)
 *  - Reserve  → recovers actor.system.attributes.hd.total points, capped at max
 *               (like HP, gated on restoreHealth; same hd.total metric PF1e uses for HP)
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

    // Chakra Pool — restored to max (treated like spell points / daily uses)
    if (options.restoreDailyUses !== false) {
        updates[chakraPoolValuePath] = chakra.pool.max ?? 0;
    }

    // Chakra Reserve — recovers 1 point per HD (same metric PF1e uses for HP recovery)
    if (options.restoreHealth !== false) {
        const hdTotal = actor.system.attributes?.hd?.total ?? 0;
        const current = chakra.reserve.value ?? 0;
        const max     = chakra.reserve.max ?? 0;
        updates[chakraReserveValuePath] = Math.min(current + hdTotal, max);
    }

    actor.update(updates);
}
