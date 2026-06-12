import { applyStanceModeBuff, promptStanceMode } from "./buff-application.mjs";
import { getStanceBuffFlag } from "./stance-buffs.mjs";

const pendingMaintenance = new Set();

/**
 * When a stance buff expires at the start of the actor's turn, prompt the user to
 * keep the current mode, switch to the other mode, or break the stance. Mirrors the
 * rank-buff maintenance flow, but the upkeep is free (mode choice only).
 * Returns true when the item is a stance buff so the caller stops further handling.
 */
export function queueStanceBuffMaintenance(item) {
  const flag = getStanceBuffFlag(item);
  if (!flag) return false;

  const actor = item.actor;
  if (!actor?.isOwner) return false;

  const key = `${actor.uuid}:${item.id}`;
  if (pendingMaintenance.has(key)) return true;
  pendingMaintenance.add(key);

  const itemId = item.id;
  window.setTimeout(async () => {
    try {
      await maintainStanceBuff(actor, itemId);
    } finally {
      pendingMaintenance.delete(key);
    }
  }, 0);

  return true;
}

async function maintainStanceBuff(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item) return;
  if (item.system?.active) return;

  const flag = getStanceBuffFlag(item);
  if (!flag) return;

  const technique = flag.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  if (!technique) {
    // Source technique is gone — nothing to maintain, drop the buff.
    await deleteStanceBuff(actor, itemId);
    return;
  }

  const choice = await promptStanceMode(technique, {
    current: flag.modeId,
    allowBreak: true,
  });

  if (!choice || choice === "break") {
    await deleteStanceBuff(actor, itemId);
    return;
  }

  // Switching/keeping re-applies the chosen mode buff (and drops the old mode buff).
  await applyStanceModeBuff(technique, actor, choice);
}

async function deleteStanceBuff(actor, itemId) {
  if (!actor.items.has(itemId)) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
  } catch (err) {
    if (actor.items.has(itemId)) {
      console.error(`naruto-d20 | failed to delete stance buff "${itemId}":`, err);
    }
  }
}
