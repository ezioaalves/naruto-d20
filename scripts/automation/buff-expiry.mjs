import { MODULE_ID } from "../constants.mjs";
import { queueRankBuffMaintenance } from "./rank-buff-maintenance.mjs";
import { queueStanceBuffMaintenance } from "./stance-buff-maintenance.mjs";

/**
 * Delete module automation buffs when their duration expires.
 *
 * PF1e's Actor#expireActiveEffects only *deactivates* expired buffs
 * (`system.active = false`) via updateEmbeddedDocuments with the option
 * `{ pf1: { reason: "duration" } }`. We listen for that natural-expiration update
 * and remove the buff outright so the actor sheet does not accumulate spent buffs.
 *
 * Manual toggle-offs carry no `reason: "duration"` flag, so they keep the existing
 * behaviour (buff stays on the sheet, just inactive).
 */
export function registerExpiredBuffCleanup() {
  Hooks.on("updateItem", (item, changed, options, userId) => {
    // Only the client that performed the update deletes — avoids multi-client races.
    if (userId !== game.user.id) return;
    // Only natural expiration by duration, not a manual deactivation.
    if (options?.pf1?.reason !== "duration") return;
    if (changed?.system?.active !== false) return;
    if (item.type !== "buff") return;
    // Only buffs applied by this module's automation.
    if (!item.flags?.[MODULE_ID]?.sourceId) return;

    const actor = item.actor;
    if (!actor?.isOwner) return;

    if (queueRankBuffMaintenance(item)) return;
    if (queueStanceBuffMaintenance(item)) return;

    // PF1e expires buffs inside a database transaction (combat turn processing /
    // world-time update). Deleting synchronously here races that transaction and
    // throws "id does not exist". Defer so it runs once the current operation settles,
    // then re-check the item still exists before removing it.
    const itemId = item.id;
    window.setTimeout(async () => {
      const current = actor.items.get(itemId);
      if (!current) return; // already removed elsewhere
      try {
        await actor.deleteEmbeddedDocuments("Item", [itemId]);
      } catch (err) {
        if (actor.items.has(itemId)) {
          console.error(`naruto-d20 | failed to delete expired buff "${current.name}":`, err);
        }
      }
    }, 0);
  });
}
