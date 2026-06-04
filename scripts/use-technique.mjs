import { MODULE_ID } from "./constants.mjs";
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";
import { applyChakraSpend, calculateChakraSpend, canPayChakra } from "./data/chakra-spend.mjs";
import { applyChatVisibility, chatVisibilityFrom } from "./chat-visibility.mjs";
import {
  getTechniqueWeaponAttackConfig,
  rollSelectedWeaponAttackWithTechnique,
} from "./ui/technique-weapon-attack.mjs";
import { isTechniqueEffectivelyLearned } from "./learn-technique.mjs";

export function canAffordTechnique(actor, item) {
  return canPayChakra(actor, item.system.chakraCost ?? 0);
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
  await postTechniqueSuccessCard(actor, item, cost, spend.summary, perform);

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

  const rollMessage = await actor.rollSkill(skillKey);
  if (!rollMessage) return null;

  return {
    succeeded: (rollMessage?.rolls?.[0]?.total ?? 0) + masteryPerform >= performDC,
    performDC,
    masteryNote,
    bypassNote: null,
    rollVisibility: chatVisibilityFrom(rollMessage),
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
      techniqueAction: action,
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

async function postPerformCard(actor, data, visibility = null) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/technique-perform.hbs`,
    data,
  );
  const messageData = applyChatVisibility(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
    },
    visibility,
  );
  await ChatMessage.create(messageData);
}

async function postPerformFailureCard(actor, item, { performDC, masteryNote, rollVisibility }) {
  await postPerformCard(
    actor,
    {
      name: item.name,
      cssClass: "failed",
      message: game.i18n.format("NarutoD20.Cards.Perform.Failed", {
        dc: `${performDC}${masteryNote}`,
      }),
    },
    rollVisibility,
  );
}

async function postTechniqueSuccessCard(actor, item, cost, spendSummary, perform) {
  // Auto-perform (ranks ≥ threshold, or no skill required) is self-evident and the card adds
  // nothing useful — skip it. Only post the outcome card when the perform was actually rolled,
  // matching the roll's visibility so a self/GM roll stays private.
  if (perform.bypassNote) return;
  await postPerformCard(
    actor,
    {
      name: item.name,
      cssClass: "success",
      message: "",
      messageClass: "",
      footer: game.i18n.format("NarutoD20.Cards.Perform.Spent", { cost, summary: spendSummary }),
    },
    perform.rollVisibility,
  );
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
