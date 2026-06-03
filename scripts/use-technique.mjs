import { MODULE_ID } from "./constants.mjs";
import { chakraPoolValuePath, chakraPoolTempPath, chakraReserveValuePath } from "./flag-paths.mjs";
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";
import { checkAndUpdateConditions } from "./data/chakra-conditions.mjs";
import {
  getTechniqueWeaponAttackConfig,
  rollSelectedWeaponAttackWithTechnique,
} from "./ui/technique-weapon-attack.mjs";
import { isTechniqueEffectivelyLearned } from "./learn-technique.mjs";

export function canAffordTechnique(actor, item) {
  if (!actor) return false;
  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  const available = (chakra.pool?.temp ?? 0) + (chakra.pool?.value ?? 0);
  return available >= (item.system.chakraCost ?? 0);
}

export async function performTechnique(item, actionId, event = null) {
  const context = validateTechniqueUse(item, actionId);
  if (!context) return;

  const { actor, actionIndex, cost } = context;

  const perform = await resolvePerformCheck(item, actor);
  if (!perform) return;
  if (!perform.succeeded) {
    await postPerformFailureCard(actor, item, perform);
    return;
  }

  const current = resolveCurrentTechniqueAction(
    actor,
    item,
    actionId,
    actionIndex,
    "after perform check",
  );
  if (!current) return;

  const useResult = await useTechniqueAction(current.item, current.action, actor, event);
  if (!useResult || useResult.err) return;

  if (!canAffordTechnique(actor, current.item)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotEnoughChakra", {
        actor: actor.name,
        name: current.item.name,
      }),
    );
    return;
  }

  const spend = calculateChakraSpend(actor, cost);
  await applyChakraSpend(actor, spend);
  await postTechniqueSuccessCard(actor, item, cost, spend.summary, perform.bypassNote);

  const updated = resolveCurrentTechniqueAction(
    actor,
    current.item,
    current.action.id,
    actionIndex,
    "after chakra update",
  );
  if (!updated) return;

  await applyPostUseAutomation(updated.item, actor, updated.action);
}

function validateTechniqueUse(item, actionId) {
  const actor = item.actor;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Notifications.EquipToUse"));
    return null;
  }

  if (game.settings.get(MODULE_ID, "enforceLearning") && !isTechniqueEffectivelyLearned(item)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotLearned", { name: item.name }),
    );
    return null;
  }

  const action = item.actions?.get(actionId);
  if (!action) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.ActionNotFound", { name: item.name }),
    );
    return null;
  }

  if (!canAffordTechnique(actor, item)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotEnoughChakra", {
        actor: actor.name,
        name: item.name,
      }),
    );
    return null;
  }

  return {
    actor,
    action,
    actionIndex: Array.from(item.actions ?? []).findIndex((a) => a.id === action.id),
    cost: item.system.chakraCost ?? 0,
  };
}

async function resolvePerformCheck(item, actor) {
  const sys = item.system;
  const skillKey = DISCIPLINE_SKILL_MAP[sys.discipline];
  const skillRanks = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
  const threshold = sys.derived.skillThreshold;
  const performDC = sys.derived.performDC;
  const masteryPerform = sys.derived.masteryPerform ?? 0;
  const masteryNote =
    masteryPerform > 0
      ? game.i18n.format("NarutoD20.Cards.Perform.MasteryNote", { value: masteryPerform })
      : "";

  if (!skillKey || skillRanks + masteryPerform >= threshold) {
    return {
      succeeded: true,
      performDC,
      masteryNote,
      bypassNote: skillKey
        ? game.i18n.format("NarutoD20.Cards.Perform.AutoBypass", {
            ranks: skillRanks,
            mastery: masteryNote,
            threshold,
          })
        : game.i18n.localize("NarutoD20.Cards.Perform.NoCheckRequired"),
    };
  }

  const result = await actor.rollSkill(skillKey);
  if (!result) return null;

  const lastMsg = game.messages.contents.at(-1);
  return {
    succeeded: (lastMsg?.rolls?.[0]?.total ?? 0) + masteryPerform >= performDC,
    performDC,
    masteryNote,
    bypassNote: null,
  };
}

function resolveCurrentTechniqueAction(actor, item, actionId, actionIndex, phase) {
  const currentItem = actor.items.get(item.id) ?? item;
  const action =
    currentItem.actions?.get(actionId) ?? Array.from(currentItem.actions ?? [])[actionIndex];
  if (!action) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.ActionNotFoundPhase", { name: item.name, phase }),
    );
    return null;
  }
  return { item: currentItem, action };
}

async function useTechniqueAction(item, action, actor, event) {
  const weaponAttackConfig = getTechniqueWeaponAttackConfig(item);
  if (weaponAttackConfig) {
    return rollSelectedWeaponAttackWithTechnique({
      technique: item,
      actor,
      config: weaponAttackConfig,
      event,
    });
  }

  const useResult = await item.use({
    actionId: action.id,
    skipDialog: !(action.hasAttack || action.hasDamage),
    ev: event,
  });

  // Charge defense penalty is applied by the global pf1PostActionUse hook
  // (registerChargeDefensePenalty), which fires for the weapon attack this
  // technique triggers internally. Applying it again here would duplicate the
  // buff due to the dedup race (the hook runs un-awaited, concurrently).
  return useResult;
}

function calculateChakraSpend(actor, cost) {
  // Deduct chakra: temp first, then pool. Reserve never pays a technique's
  // cost directly; it only participates via the Emergency Transfer rule below.
  const chakra = actor.flags[MODULE_ID]?.chakra ?? {};
  const tempValue = chakra.pool?.temp ?? 0;
  const poolValue = chakra.pool?.value ?? 0;
  const reserveValue = chakra.reserve?.value ?? 0;
  const fromTemp = Math.min(cost, tempValue);
  const remaining = cost - fromTemp;
  const fromPool = Math.min(remaining, poolValue);

  let newPool = poolValue - fromPool;
  let newReserve = reserveValue;

  // Emergency Transfer: if pool hits 0 but reserve still has chakra, the body
  // automatically burns the entire reserve to return 1 chakra to the pool
  // after the normal temp+pool spend resolves. This guarantees pool == 0 only
  // when reserve == 0 (which triggers Chakra Depletion).
  if (newPool <= 0 && newReserve > 0) {
    newPool = 1;
    newReserve = 0;
  }

  // Build a readable spend summary for the technique cost itself.
  const spendParts = [];
  if (fromTemp > 0) spendParts.push(`${fromTemp} temp`);
  if (fromPool > 0) spendParts.push(`${fromPool} pool`);

  return {
    temp: tempValue - fromTemp,
    pool: newPool,
    reserve: newReserve,
    summary: spendParts.join(", ") || "0",
  };
}

async function applyChakraSpend(actor, spend) {
  await actor.update({
    [chakraPoolTempPath]: spend.temp,
    [chakraPoolValuePath]: spend.pool,
    [chakraReserveValuePath]: spend.reserve,
  });

  await checkAndUpdateConditions(actor);
}

async function postPerformCard(actor, data) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/technique-perform.hbs`,
    data,
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}

async function postPerformFailureCard(actor, item, { performDC, masteryNote }) {
  await postPerformCard(actor, {
    name: item.name,
    cssClass: "failed",
    message: game.i18n.format("NarutoD20.Cards.Perform.Failed", {
      dc: `${performDC}${masteryNote}`,
    }),
  });
}

async function postTechniqueSuccessCard(actor, item, cost, spendSummary, bypassNote) {
  // Post outcome card when there was an auto-bypass (roll card covers the roll path).
  await postPerformCard(actor, {
    name: item.name,
    cssClass: "success",
    message: bypassNote || "",
    messageClass: bypassNote ? "naruto-perform-bypass" : "",
    footer: game.i18n.format("NarutoD20.Cards.Perform.Spent", { cost, summary: spendSummary }),
  });
}

async function applyPostUseAutomation(item, actor, action) {
  if (!game.settings.get(MODULE_ID, "automaticBuffs") || !item.system.automation?.enabled) return;

  const { applyTechniqueBuff } = await import("./automation/buff-application.mjs");
  try {
    await applyTechniqueBuff(item, actor, action);
  } catch (err) {
    console.error(`naruto-d20 | buff automation failed for "${item.name}":`, err);
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.BuffAutomationFailed", { name: item.name }),
    );
  }
}
