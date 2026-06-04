import { availableChakra, canPayChakra, payChakra } from "../data/chakra-spend.mjs";
import { getRankBuffFlag, rankBuffDuration, rankMaintenanceForLevel } from "./rank-buffs.mjs";

const pendingMaintenance = new Set();

export function queueRankBuffMaintenance(item) {
  const actor = item.actor;
  if (!actor?.isOwner) return false;
  if (!getRankBuffFlag(item)) return false;

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

  const keepActive = await promptMaintainRankBuff(actor, item, maintenance);
  if (!keepActive) {
    await deleteRankBuff(actor, itemId);
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

  const current = actor.items.get(itemId);
  if (!current) return;

  const duration = rankBuffDuration(maintenance.interval);
  await current.update({
    "system.active": true,
    "system.duration.units": duration.units,
    "system.duration.value": duration.value,
    "system.duration.end": duration.end,
    "system.duration.start": duration.start,
  });
}

function promptMaintainRankBuff(actor, item, maintenance) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    new Dialog({
      title: game.i18n.format("NarutoD20.RankBuffMaintenance.Title", { name: item.name }),
      content: `<p>${game.i18n.format("NarutoD20.RankBuffMaintenance.Message", {
        actor: actor.name,
        name: item.name,
        cost: maintenance.cost,
        interval: maintenance.interval,
      })}</p>`,
      buttons: {
        maintain: {
          icon: '<i class="fas fa-fire"></i>',
          label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Maintain"),
          callback: () => done(true),
        },
        deactivate: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Deactivate"),
          callback: () => done(false),
        },
      },
      default: "maintain",
      close: () => done(false),
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
