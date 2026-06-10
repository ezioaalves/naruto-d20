import { availableChakra, canPayChakra, payChakra } from "../data/chakra-spend.mjs";
import {
  consumeRankMasteryFreeUse,
  ensureRankMasteryDailyUse,
  findRankTechniqueForBuff,
  getRankBuffFlag,
  getRankGrantType,
  hasRankMasteryFreeUseAvailable,
  rankBuffDuration,
  rankMaintenanceForLevel,
  RANK_MASTERY_FREE_ROUNDS,
} from "./rank-buffs.mjs";

const pendingMaintenance = new Set();

export function queueRankBuffMaintenance(item) {
  const actor = item.actor;
  if (!actor?.isOwner) return false;
  // Only technique-created (paid) rank buffs have chakra maintenance;
  // temp/bonus grants are free and never expire into this flow.
  if (getRankGrantType(item) !== "paid") return false;

  const key = `${actor.uuid}:${item.id}`;
  if (pendingMaintenance.has(key)) return true;
  pendingMaintenance.add(key);

  const itemId = item.id;
  window.setTimeout(async () => {
    try {
      await maintainRankBuff(actor, itemId);
    } finally {
      pendingMaintenance.delete(key);
    }
  }, 0);

  return true;
}

async function maintainRankBuff(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item) return;
  if (item.system?.active) return;

  const flag = getRankBuffFlag(item);
  const maintenance = rankMaintenanceForLevel(flag?.level);
  if (!maintenance) {
    await deleteRankBuff(actor, itemId);
    return;
  }

  const sourceTechnique = await resolveFreeUseSourceTechnique(actor, flag);
  const choice = await promptMaintainRankBuff(actor, item, maintenance, {
    canUseFree: hasRankMasteryFreeUseAvailable(sourceTechnique),
  });
  if (choice === "deactivate") {
    await deleteRankBuff(actor, itemId);
    return;
  }

  if (choice === "free") {
    const spent = await consumeRankMasteryFreeUse(sourceTechnique);
    if (!spent) {
      ui.notifications.warn(
        game.i18n.format("NarutoD20.Notifications.RankMasteryFreeUseUnavailable", {
          name: sourceTechnique?.name ?? item.name,
        }),
      );
      await deleteRankBuff(actor, itemId);
      return;
    }

    await refreshRankBuff(actor, itemId, RANK_MASTERY_FREE_ROUNDS);
    return;
  }

  if (!canPayChakra(actor, maintenance.cost)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.RankBuffMaintenanceNotEnoughChakra", {
        actor: actor.name,
        name: item.name,
        cost: maintenance.cost,
        available: availableChakra(actor),
      }),
    );
    await deleteRankBuff(actor, itemId);
    return;
  }

  const payment = await payChakra(actor, maintenance.cost);
  if (!payment.paid) {
    await deleteRankBuff(actor, itemId);
    return;
  }

  await refreshRankBuff(actor, itemId, maintenance.interval);
}

async function resolveFreeUseSourceTechnique(actor, flag) {
  const sourceTechnique = findRankTechniqueForBuff(actor, flag);
  if (!sourceTechnique) return null;
  return ensureRankMasteryDailyUse(sourceTechnique);
}

async function refreshRankBuff(actor, itemId, interval) {
  const current = actor.items.get(itemId);
  if (!current) return;

  const duration = rankBuffDuration(interval);
  await current.update({
    "system.active": true,
    "system.duration.units": duration.units,
    "system.duration.value": duration.value,
    "system.duration.end": duration.end,
    "system.duration.start": duration.start,
  });
}

function promptMaintainRankBuff(actor, item, maintenance, { canUseFree = false } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const buttons = {};
    if (canUseFree) {
      buttons.free = {
        icon: '<i class="fas fa-certificate"></i>',
        label: game.i18n.localize("NarutoD20.RankMasteryFreeUse.UseFree"),
        callback: () => done("free"),
      };
    }
    buttons.maintain = {
      icon: '<i class="fas fa-fire"></i>',
      label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Maintain"),
      callback: () => done("maintain"),
    };
    buttons.deactivate = {
      icon: '<i class="fas fa-times"></i>',
      label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Deactivate"),
      callback: () => done("deactivate"),
    };

    new Dialog({
      title: game.i18n.format("NarutoD20.RankBuffMaintenance.Title", { name: item.name }),
      content: `<p>${game.i18n.format("NarutoD20.RankBuffMaintenance.Message", {
        actor: actor.name,
        name: item.name,
        cost: maintenance.cost,
        interval: maintenance.interval,
      })}</p>${
        canUseFree
          ? `<p>${game.i18n.format("NarutoD20.RankMasteryFreeUse.MaintenanceMessage", {
              rounds: RANK_MASTERY_FREE_ROUNDS,
            })}</p>`
          : ""
      }`,
      buttons,
      default: "maintain",
      close: () => done("deactivate"),
    }).render(true);
  });
}

async function deleteRankBuff(actor, itemId) {
  if (!actor.items.has(itemId)) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
  } catch (err) {
    if (actor.items.has(itemId)) {
      const item = actor.items.get(itemId);
      console.error(`naruto-d20 | failed to delete rank buff "${item?.name ?? itemId}":`, err);
    }
  }
}
