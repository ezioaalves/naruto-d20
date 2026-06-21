import { MODULE_ID } from "../../../core/constants.mjs";
import { chakraPoolTempPath } from "../../../core/flag-paths.mjs";
import { rollHpCost, commitHpCost, applyHpCost } from "../../../data/hp-cost.mjs";
import {
  getMaintenanceBuffFlag,
  maintenanceBuffDuration,
  maintenanceFacets,
  maintenanceRoundsRemaining,
  shouldChargeUpkeep,
} from "./buffs.mjs";
import { applyModeBuff, applyUpkeepBuff, promptModeChoice } from "../buffs/application.mjs";
import { availableChakra, canPayChakra, payChakra } from "../../chakra/spend.mjs";
import {
  consumeRankMasteryFreeUse,
  ensureRankMasteryDailyUse,
  hasRankMasteryFreeUseAvailable,
} from "../ranks/buffs.mjs";
import { calculateChakraDamage, commitChakraDamage } from "../../chakra/damage.mjs";
import { applyConditionBenefits } from "../buffs/condition-benefits.mjs";

const pending = new Set();

export function registerTurnMaintenance() {
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if (userId !== game.user.id) return;
    if (options?.pf1?.reason !== "duration") return;
    if (changed?.system?.active !== false) return;
    if (item.type !== "buff") return;
    if (!item.flags?.[MODULE_ID]?.sourceId) return;

    const mFlag = item.flags?.[MODULE_ID]?.maintenanceBuff;
    if (mFlag?.model === "duration") {
      const tdActor = item.actor;
      if (!tdActor?.isOwner) return;
      const itemId = item.id;
      window.setTimeout(() => tearDownDurationBuff(tdActor, itemId, "expired"), 0);
      return;
    }

    const actor = item.actor;
    if (!actor?.isOwner) return;

    if (queueMaintenance(item)) return;

    // No maintenance descriptor → delete the spent buff (deferred past the
    // expiry transaction, then re-checked).
    const itemId = item.id;
    window.setTimeout(async () => {
      const current = actor.items.get(itemId);
      if (!current) return;
      try {
        await actor.deleteEmbeddedDocuments("Item", [itemId]);
      } catch (err) {
        if (actor.items.has(itemId)) {
          console.error(`naruto-d20 | failed to delete expired buff "${current.name}":`, err);
        }
      }
    }, 0);
  });

  Hooks.on("updateCombat", (combat, changed) => {
    if (changed?.turn === undefined && changed?.round === undefined) return;
    const actor = combat.combatant?.actor;
    if (!actor) return;
    if (!actor.activeOwner?.isSelf) return;
    runTurnUpkeep(actor, combat);
  });

  Hooks.on("deleteItem", (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.type !== "buff") return;
    const actor = item.actor;
    if (!actor?.isOwner) return;
    const flag = getMaintenanceBuffFlag(item);
    const shouldClearHealing =
      flag?.sourceTechniqueId && flag.hasHeal && !!actor.system?.traits?.fastHealing;
    const remainingTemp = Math.max(
      0,
      Number(item.flags?.[MODULE_ID]?.temporaryChakra?.remaining ?? 0) || 0,
    );
    if (!shouldClearHealing && remainingTemp <= 0) return;
    window.setTimeout(() => {
      const updates = {};
      if (shouldClearHealing) {
        updates["system.traits.fastHealing"] = "";
      }
      if (remainingTemp > 0) {
        const currentTemp = Math.max(
          0,
          Number(actor.flags?.[MODULE_ID]?.chakra?.pool?.temp ?? 0) || 0,
        );
        updates[chakraPoolTempPath] = Math.max(0, currentTemp - remainingTemp);
      }
      actor.update(updates).catch((err) => {
        console.error(`naruto-d20 | failed to clear fastHealing for "${actor.name}":`, err);
      });
    }, 0);
  });
}

function runTurnUpkeep(actor, combat) {
  const currentRound = Number(combat.round) || 0;
  for (const item of actor.items) {
    if (item.type !== "buff") continue;
    const flag = getMaintenanceBuffFlag(item);
    if (!flag?.sourceTechniqueId) continue;

    if (flag.model === "duration") {
      if (!item.system?.active) continue;

      const remaining = maintenanceRoundsRemaining({
        totalRounds: flag.totalRounds,
        startRound: flag.startRound,
        currentRound,
      });
      if (
        !shouldChargeUpkeep({
          remaining,
          currentRound,
          startRound: flag.startRound,
          interval: flag.interval,
          lastUpkeepRound: flag.lastUpkeepRound,
        })
      ) {
        continue;
      }

      queueDeferred(item, () => chargeDurationUpkeep(actor, item.id, currentRound));
    } else if (flag.model === "toggle") {
      if (!item.system?.active) continue;
      const startRound = flag.startRound ?? null;
      if (startRound === null) {
        // Activated out of combat (no game.combat at apply time) → anchor on the
        // current round so upkeep begins next turn, without charging this turn.
        const itemId = item.id;
        queueDeferred(item, () =>
          actor.items
            .get(itemId)
            ?.update({ [`flags.${MODULE_ID}.maintenanceBuff.startRound`]: currentRound }),
        );
        continue;
      }
      if (currentRound <= startRound) continue;
      const interval = Math.max(1, Number(flag.interval) || 1);
      if ((currentRound - startRound) % interval !== 0) continue;
      queueDeferred(item, () => runToggleMaintenance(actor, item.id));
    }
  }
}

async function runToggleMaintenance(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || !item.system?.active) return;
  // Deactivate without pf1.reason="duration" so the updateItem handler does not
  // also fire maintenance (it bails when reason !== "duration").
  await item.update({ "system.active": false });
  await runMaintenance(actor, itemId);
}

async function chargeDurationUpkeep(actor, itemId, currentRound) {
  const item = actor.items.get(itemId);
  if (!item || !item.system?.active) return;

  const flag = getMaintenanceBuffFlag(item);
  const technique = flag?.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  if (!technique) {
    await deleteMaintenanceBuff(actor, itemId);
    return;
  }
  const facets = maintenanceFacets(technique);
  if (!facets) {
    await deleteMaintenanceBuff(actor, itemId);
    return;
  }

  const rollData = masteryRollData(actor, technique);

  if (facets.resource === "hp") {
    const { roll, amount } = await rollHpCost(actor, facets.cost || "0", rollData);
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    if (hp - amount < 1) {
      await tearDownDurationBuff(actor, itemId);
      return;
    }
    await commitHpCost(actor, roll, amount);
  } else if (facets.resource === "chakraDamage") {
    const roll = await RollPF.safeRoll(String(facets.cost || "0"), rollData);
    const amount = Math.max(0, Math.floor(Number(roll?.total) || 0));
    const calc = calculateChakraDamage(actor, amount);
    if (calc.hpOverflow > 0) {
      const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
      if (hp - calc.hpOverflow < 1) {
        await tearDownDurationBuff(actor, itemId);
        return;
      }
    }
    await commitChakraDamage(actor, technique, calc, amount);
  }

  await applyTurnBenefits(actor, technique, facets);
  const flagUpdates = { [`flags.${MODULE_ID}.maintenanceBuff.lastUpkeepRound`]: currentRound };
  if (flag.startRound === null || flag.startRound === undefined) {
    flagUpdates[`flags.${MODULE_ID}.maintenanceBuff.startRound`] = currentRound;
  }
  await item.update(flagUpdates);
}

async function tearDownDurationBuff(actor, itemId, reason = "cost") {
  const item = actor.items.get(itemId);
  if (!item) return;
  const flag = getMaintenanceBuffFlag(item);
  const technique = flag?.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  const name = technique?.name ?? item.name;

  try {
    await actor.setConditions({ fatigued: true });
  } catch (err) {
    console.error(`naruto-d20 | failed to set fatigued on "${actor.name}":`, err);
  }

  await deleteMaintenanceBuff(actor, itemId);

  ui.notifications.info(
    game.i18n.format(
      reason === "expired"
        ? "NarutoD20.Maintenance.UpkeepExpired"
        : "NarutoD20.Maintenance.UpkeepEnded",
      { name },
    ),
  );
}

function queueMaintenance(item) {
  const flag = getMaintenanceBuffFlag(item);
  if (!flag?.sourceTechniqueId) return false;
  // bonus/temp rank grants don't pay maintenance — let the generic delete handle them.
  if (flag?.key && (flag.grantType ?? "paid") !== "paid") return false;
  const actor = item.actor;
  const technique = actor.items.get(flag.sourceTechniqueId);
  if (!technique || !maintenanceFacets(technique)) {
    // Source gone or no longer maintained → fall through to generic delete.
    return false;
  }
  return queueDeferred(item, () => runMaintenance(actor, item.id));
}

function queueDeferred(item, run) {
  const actor = item.actor;
  const key = `${actor.uuid}:${item.id}`;
  if (pending.has(key)) return true;
  pending.add(key);
  window.setTimeout(async () => {
    try {
      await run();
    } finally {
      pending.delete(key);
    }
  }, 0);
  return true;
}

async function runMaintenance(actor, itemId) {
  const item = actor.items.get(itemId);
  if (!item || item.system?.active) return;

  const flag = getMaintenanceBuffFlag(item);
  const technique = flag?.sourceTechniqueId ? actor.items.get(flag.sourceTechniqueId) : null;
  if (!technique) return deleteMaintenanceBuff(actor, itemId);

  const facets = maintenanceFacets(technique);
  if (!facets) return deleteMaintenanceBuff(actor, itemId);

  if (facets.resource === "hp") {
    return maintainHpUpkeep(actor, itemId, technique, facets, flag);
  }

  if (facets.resource === "chakra") {
    return maintainChakraUpkeep(actor, itemId, technique, facets, flag);
  }

  if (facets.resource === "chakraDamage") {
    return maintainChakraDamageUpkeep(actor, itemId, technique, facets, flag);
  }

  // No-cost choice (Champuru), or a maintained buff with no cost/choice.
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

async function maintainHpUpkeep(actor, itemId, technique, facets, flag) {
  const formula = facets.cost || "0";
  const rollData = masteryRollData(actor, technique);

  if (facets.policy === "forced") {
    const { roll, amount } = await rollHpCost(actor, formula, rollData);
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    if (hp - amount < 1) {
      await deleteMaintenanceBuff(actor, itemId);
      ui.notifications.info(
        game.i18n.format("NarutoD20.Maintenance.UpkeepEnded", { name: technique.name }),
      );
      return;
    }
    await commitHpCost(actor, roll, amount);
    await completeMaintenance(actor, itemId, technique, facets, flag);
    return;
  }

  // policy "prompt" with optional step waiver.
  if (facets.waiver === "step") {
    const mastery = Number(technique.system?.mastery ?? 0) || 0;
    if (mastery >= facets.waiverStep) {
      await completeMaintenance(actor, itemId, technique, facets, flag);
      return;
    }
  }

  const choice = await promptHpUpkeep(technique, formula);
  if (choice !== "pay") return deleteMaintenanceBuff(actor, itemId);
  await applyHpCost(actor, formula, rollData);
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

function masteryRollData(actor, technique) {
  const step = Number(technique.system?.mastery) || 0;
  return { ...(actor.getRollData?.() ?? {}), mastery: step };
}

async function maintainChakraDamageUpkeep(actor, itemId, technique, facets, flag) {
  const roll = await RollPF.safeRoll(String(facets.cost || "0"), masteryRollData(actor, technique));
  const amount = Math.max(0, Math.floor(Number(roll?.total) || 0));

  const calc = calculateChakraDamage(actor, amount);

  if (calc.hpOverflow > 0) {
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    if (hp - calc.hpOverflow < 1) {
      await deleteMaintenanceBuff(actor, itemId);
      ui.notifications.info(
        game.i18n.format("NarutoD20.Maintenance.UpkeepEnded", { name: technique.name }),
      );
      return;
    }
  }

  await commitChakraDamage(actor, technique, calc, amount);
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

async function maintainChakraUpkeep(actor, itemId, technique, facets, flag) {
  const cost = Math.max(0, Number(facets.cost) || 0);

  if (facets.policy === "forced") {
    if (!canPayChakra(actor, cost)) {
      warnInsufficientChakra(actor, technique, cost);
      await deleteMaintenanceBuff(actor, itemId);
      return;
    }
    const payment = await payChakra(actor, cost);
    if (!payment.paid) return deleteMaintenanceBuff(actor, itemId);
    await completeMaintenance(actor, itemId, technique, facets, flag);
    return;
  }

  const source =
    facets.waiver === "freeUse" ? await ensureRankMasteryDailyUse(technique) : technique;
  const canUseFree =
    facets.waiver === "freeUse" &&
    Number(source.system?.mastery ?? 0) >= facets.waiverStep &&
    hasRankMasteryFreeUseAvailable(source);
  const choice = await promptChakraUpkeep(actor, source, cost, facets.interval, {
    canUseFree,
    freeRounds: facets.freeRounds,
  });

  if (choice === "deactivate") {
    await deleteMaintenanceBuff(actor, itemId);
    return;
  }

  if (choice === "free") {
    if (!(await consumeRankMasteryFreeUse(source))) {
      ui.notifications.warn(
        game.i18n.format("NarutoD20.Notifications.RankMasteryFreeUseUnavailable", {
          name: source.name,
        }),
      );
      await deleteMaintenanceBuff(actor, itemId);
      return;
    }
    await completeMaintenance(actor, itemId, technique, facets, flag, facets.freeRounds);
    return;
  }

  if (!canPayChakra(actor, cost)) {
    warnInsufficientChakra(actor, source, cost);
    await deleteMaintenanceBuff(actor, itemId);
    return;
  }
  const payment = await payChakra(actor, cost);
  if (!payment.paid) return deleteMaintenanceBuff(actor, itemId);
  await completeMaintenance(actor, itemId, technique, facets, flag);
}

function warnInsufficientChakra(actor, technique, cost) {
  ui.notifications.warn(
    game.i18n.format("NarutoD20.Notifications.RankBuffMaintenanceNotEnoughChakra", {
      actor: actor.name,
      name: technique.name,
      cost,
      available: availableChakra(actor),
    }),
  );
}

function promptChakraUpkeep(
  actor,
  technique,
  cost,
  interval,
  { canUseFree = false, freeRounds = 5 } = {},
) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const buttons = {};
    if (canUseFree) {
      buttons.free = {
        icon: '<i class="fas fa-certificate"></i>',
        label: game.i18n.localize("NarutoD20.RankMasteryFreeUse.UseFree"),
        callback: () => finish("free"),
      };
    }
    buttons.maintain = {
      icon: '<i class="fas fa-fire"></i>',
      label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Maintain"),
      callback: () => finish("maintain"),
    };
    buttons.deactivate = {
      icon: '<i class="fas fa-times"></i>',
      label: game.i18n.localize("NarutoD20.RankBuffMaintenance.Deactivate"),
      callback: () => finish("deactivate"),
    };

    new Dialog({
      title: game.i18n.format("NarutoD20.RankBuffMaintenance.Title", {
        name: technique.name,
      }),
      content: `<p>${game.i18n.format("NarutoD20.RankBuffMaintenance.Message", {
        actor: actor.name,
        name: technique.name,
        cost,
        interval,
      })}</p>${
        canUseFree
          ? `<p>${game.i18n.format("NarutoD20.RankMasteryFreeUse.MaintenanceMessage", {
              rounds: freeRounds,
            })}</p>`
          : ""
      }`,
      buttons,
      default: canUseFree ? "free" : "maintain",
      close: () => finish("deactivate"),
    }).render(true);
  });
}

async function completeMaintenance(
  actor,
  itemId,
  technique,
  facets,
  flag,
  interval = facets.interval,
) {
  await applyTurnBenefits(actor, technique, facets);

  if (facets.choice === "mode") {
    const choice = await promptModeChoice(technique, {
      current: flag.modeId,
      allowBreak: true,
    });
    if (!choice || choice === "break") {
      await deleteMaintenanceBuff(actor, itemId);
      return;
    }
    await applyModeBuff(technique, actor, choice, interval);
    return;
  }

  if (
    facets.resource === "hp" ||
    facets.resource === "chakraDamage" ||
    technique.system?.automation?.maintenance?.element
  ) {
    await applyUpkeepBuff(technique, actor, interval);
    return;
  }

  await refreshMaintenanceBuff(actor, itemId, interval);
}

async function applyTurnBenefits(actor, technique, facets) {
  if (facets.heal) {
    const roll = await RollPF.safeRoll(String(facets.heal), masteryRollData(actor, technique));
    const amount = Math.max(0, Math.floor(Number(roll?.total) || 0));
    const hp = actor.system?.attributes?.hp ?? {};
    const cur = Number(hp.value ?? 0) || 0;
    const max = Number(hp.max ?? cur) || cur;
    const healed = Math.min(amount, Math.max(0, max - cur));

    // Always stamp fastHealing each turn so the defenses card stays current; the teardown hook clears it.
    const updates = { "system.traits.fastHealing": String(amount) };
    if (healed > 0) updates["system.attributes.hp.value"] = cur + healed;
    await actor.update(updates);

    if (healed > 0) {
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p>${game.i18n.format("NarutoD20.Maintenance.FastHealingFlavor", {
          name: technique.name,
          amount,
          hp: healed,
        })}</p>`,
      });
    }
  }

  await applyConditionBenefits(actor, facets);
}

function promptHpUpkeep(technique, formula) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    new Dialog({
      title: game.i18n.format("NarutoD20.Maintenance.UpkeepTitle", { name: technique.name }),
      content: `<p>${game.i18n.format("NarutoD20.Maintenance.UpkeepMessage", {
        name: technique.name,
        formula,
      })}</p>`,
      buttons: {
        pay: {
          icon: '<i class="fas fa-heart-broken"></i>',
          label: game.i18n.format("NarutoD20.Maintenance.PayHp", { formula }),
          callback: () => finish("pay"),
        },
        break: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.Maintenance.Break"),
          callback: () => finish("break"),
        },
      },
      default: "pay",
      close: () => finish("break"),
    }).render(true);
  });
}

export async function refreshMaintenanceBuff(actor, itemId, interval) {
  const current = actor.items.get(itemId);
  if (!current) return;
  const flag = getMaintenanceBuffFlag(current);
  if (flag?.model === "toggle") {
    await current.update({
      "system.active": true,
      "system.duration.units": "perm",
      "system.duration.value": "",
      [`flags.${MODULE_ID}.maintenanceBuff.startRound`]: game.combat?.round ?? null,
    });
    return;
  }
  const d = maintenanceBuffDuration(interval);
  await current.update({
    "system.active": true,
    "system.duration.units": d.units,
    "system.duration.value": d.value,
    "system.duration.end": d.end,
    "system.duration.start": d.start,
  });
}

async function deleteMaintenanceBuff(actor, itemId) {
  if (!actor.items.has(itemId)) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
  } catch (err) {
    if (actor.items.has(itemId)) {
      console.error(`naruto-d20 | failed to delete maintenance buff "${itemId}":`, err);
    }
  }
}
