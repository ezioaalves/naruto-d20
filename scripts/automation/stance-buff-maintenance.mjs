import { applyStanceModeBuff, applyUpkeepStanceBuff, promptStanceMode } from "./buff-application.mjs";
import { getStanceBuffFlag, stanceBuffKind } from "./stance-buffs.mjs";
import { applyHpCost } from "../data/hp-cost.mjs";

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

  if (stanceBuffKind(flag) === "upkeep") {
    await maintainUpkeepStance(actor, itemId, technique);
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

/**
 * Turn-start upkeep for an HP-upkeep stance (Amatsu). At mastery >= upkeepWaiverStep
 * the cost is waived and the stance auto-maintains silently. Otherwise prompt to pay
 * the HP cost (re-apply on pay) or break the stance.
 */
async function maintainUpkeepStance(actor, itemId, technique) {
  const auto = technique.system?.automation ?? {};
  const waiverStep = Number(auto.upkeepWaiverStep ?? 2) || 0;
  const mastery = Number(technique.system?.mastery ?? 0) || 0;

  if (mastery >= waiverStep) {
    // HP cost waived — keep the stance going without prompting.
    await applyUpkeepStanceBuff(technique, actor);
    return;
  }

  const choice = await promptUpkeep(technique, auto.upkeepFormula ?? "1d4");
  if (choice !== "pay") {
    await deleteStanceBuff(actor, itemId);
    return;
  }

  await applyHpCost(actor, auto.upkeepFormula ?? "1d4");
  await applyUpkeepStanceBuff(technique, actor);
}

function promptUpkeep(technique, formula) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    new Dialog({
      title: game.i18n.format("NarutoD20.StanceBuff.UpkeepTitle", { name: technique.name }),
      content: `<p>${game.i18n.format("NarutoD20.StanceBuff.UpkeepMessage", {
        name: technique.name,
        formula,
      })}</p>`,
      buttons: {
        pay: {
          icon: '<i class="fas fa-heart-broken"></i>',
          label: game.i18n.format("NarutoD20.StanceBuff.PayHp", { formula }),
          callback: () => done("pay"),
        },
        break: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.StanceBuff.Break"),
          callback: () => done("break"),
        },
      },
      default: "pay",
      // Closing the prompt breaks the stance.
      close: () => done("break"),
    }).render(true);
  });
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
