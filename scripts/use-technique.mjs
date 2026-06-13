import { MODULE_ID } from "./constants.mjs";
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";
import { applyChakraSpend, calculateChakraSpend, canPayChakra } from "./data/chakra-spend.mjs";
import { applyChatVisibility, chatVisibilityFrom } from "./chat-visibility.mjs";
import { markNarutoRollRerollable } from "./chat-rerolls.mjs";
import {
  getTechniqueWeaponAttackConfig,
  rollSelectedWeaponAttackWithTechnique,
} from "./ui/technique-weapon-attack.mjs";
import { isTechniqueEffectivelyLearned } from "./learn-technique.mjs";
import {
  consumeRankMasteryFreeUse,
  ensureRankMasteryDailyUse,
  hasRankMasteryFreeUseAvailable,
  isRankMasteryFreeUseEligible,
  RANK_MASTERY_FREE_ROUNDS,
} from "./automation/rank-buffs.mjs";
import { findStanceBuffForTechnique, isElementStance, isUpkeepStance } from "./automation/stance-buffs.mjs";
import {
  clearPendingCastElements,
  getActiveStanceElements,
  promptStanceElements,
  setPendingCastElements,
  stanceElementCount,
} from "./automation/stance-element-damage.mjs";

export function canAffordTechnique(actor, item) {
  return canPayChakra(actor, item.system.chakraCost ?? 0);
}

export async function performTechnique(item, actionId, event = null) {
  const context = validateTechniqueUse(item, actionId);
  if (!context) return;

  const { actor, actionIndex } = context;
  let { cost } = context;
  let currentItem = item;

  const freeUseChoice = await resolveRankMasteryFreeUseChoice(item, actor, cost);
  if (freeUseChoice === null) return;
  if (freeUseChoice?.item) currentItem = freeUseChoice.item;

  // Using an upkeep stance (Amatsu) that is already active is free — only the
  // initial entry pays chakra; round-to-round upkeep is HP (handled at turn start).
  const stanceFree =
    isUpkeepStance(currentItem) && Boolean(findStanceBuffForTechnique(actor, currentItem.id));
  const chakraFree = freeUseChoice?.useFree === true || stanceFree;

  if (!chakraFree && !canAffordTechnique(actor, currentItem)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotEnoughChakra", {
        actor: actor.name,
        name: currentItem.name,
      }),
    );
    return;
  }

  const perform = await resolvePerformCheck(currentItem, actor);
  if (!perform) return;
  if (!perform.succeeded) {
    await postPerformFailureCard(actor, currentItem, perform);
    return;
  }

  try {
    // Element stances pick their damage element(s) before the attack rolls so the
    // pf1PreDamageRoll hook can type the damage. On entry we prompt; while the stance
    // is already active we reuse the element(s) stored on the buff.
    if (isElementStance(currentItem)) {
      const active = getActiveStanceElements(actor, currentItem);
      if (active?.length) {
        setPendingCastElements(actor, currentItem, active);
      } else {
        const elements = await promptStanceElements(currentItem, stanceElementCount(currentItem));
        if (!elements) return;
        setPendingCastElements(actor, currentItem, elements);
      }
    }

    const current = resolveCurrentTechniqueAction(
      actor,
      currentItem,
      actionId,
      actionIndex,
      "after perform check",
    );
    if (!current) return;

    const useResult = await useTechniqueAction(current.item, current.action, actor, event);
    if (!useResult || useResult.err) return;

    if (!chakraFree && !canAffordTechnique(actor, current.item)) {
      ui.notifications.warn(
        game.i18n.format("NarutoD20.Notifications.NotEnoughChakra", {
          actor: actor.name,
          name: current.item.name,
        }),
      );
      return;
    }

    let spend = null;
    if (stanceFree) {
      // Active-stance re-use: the attack costs no chakra.
    } else if (freeUseChoice?.useFree) {
      const spent = await consumeRankMasteryFreeUse(current.item);
      if (!spent) {
        ui.notifications.warn(
          game.i18n.format("NarutoD20.Notifications.RankMasteryFreeUseUnavailable", {
            name: current.item.name,
          }),
        );
        return;
      }
    } else {
      cost = current.item.system.chakraCost ?? cost;
      spend = calculateChakraSpend(actor, cost);
      await applyChakraSpend(actor, spend);
    }
    await postTechniqueSuccessCard(actor, current.item, cost, spend?.summary ?? null, perform, {
      freeUse: freeUseChoice?.useFree === true,
      stanceFree,
    });

    const updated = resolveCurrentTechniqueAction(
      actor,
      current.item,
      current.action.id,
      actionIndex,
      freeUseChoice?.useFree ? "after daily use update" : "after chakra update",
    );
    if (!updated) return;

    await applyPostUseAutomation(updated.item, actor, updated.action);
  } finally {
    if (isElementStance(currentItem)) clearPendingCastElements(actor, currentItem);
  }
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

  return {
    actor,
    action,
    actionIndex: Array.from(item.actions ?? []).findIndex((a) => a.id === action.id),
    cost: item.system.chakraCost ?? 0,
  };
}

async function resolveRankMasteryFreeUseChoice(item, actor, cost) {
  if (!isRankMasteryFreeUseEligible(item) || Number(cost ?? 0) <= 0) {
    return { useFree: false, item };
  }

  const currentItem = await ensureRankMasteryDailyUse(actor.items.get(item.id) ?? item);
  if (!hasRankMasteryFreeUseAvailable(currentItem)) {
    return { useFree: false, item: currentItem };
  }

  const choice = await promptRankMasteryFreeUse(actor, currentItem, cost);
  if (choice === "cancel") return null;
  return { useFree: choice === "free", item: currentItem };
}

function promptRankMasteryFreeUse(actor, item, cost) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    new Dialog({
      title: game.i18n.format("NarutoD20.RankMasteryFreeUse.Title", { name: item.name }),
      content: `<p>${game.i18n.format("NarutoD20.RankMasteryFreeUse.ActivationMessage", {
        actor: actor.name,
        name: item.name,
        cost,
      })}</p>`,
      buttons: {
        free: {
          icon: '<i class="fas fa-certificate"></i>',
          label: game.i18n.localize("NarutoD20.RankMasteryFreeUse.UseFree"),
          callback: () => done("free"),
        },
        pay: {
          icon: '<i class="fas fa-fire"></i>',
          label: game.i18n.localize("NarutoD20.RankMasteryFreeUse.PayChakra"),
          callback: () => done("pay"),
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.Common.Cancel"),
          callback: () => done("cancel"),
        },
      },
      default: "free",
      close: () => done("cancel"),
    }).render(true);
  });
}

async function resolvePerformCheck(item, actor) {
  const sys = item.system;
  const derived = sys.derived;
  const skillKey = DISCIPLINE_SKILL_MAP[sys.discipline];
  const skillRanks = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
  const threshold = derived.skillThreshold;
  const performDC = derived.performDC;
  const masteryPerform = derived.masteryPerform ?? 0;
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
  await markNarutoRollRerollable(rollMessage, actor, "technique-perform");

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

async function postTechniqueSuccessCard(actor, item, cost, spendSummary, perform, options = {}) {
  // Auto-perform (ranks ≥ threshold, or no skill required) is self-evident and the card adds
  // nothing useful — skip it. Only post the outcome card when the perform was actually rolled,
  // matching the roll's visibility so a self/GM roll stays private.
  if (perform.bypassNote) return;
  let footer;
  if (options.stanceFree) {
    footer = game.i18n.localize("NarutoD20.Cards.Perform.StanceFree");
  } else if (options.freeUse) {
    footer = game.i18n.format("NarutoD20.Cards.Perform.FreeUse", {
      rounds: RANK_MASTERY_FREE_ROUNDS,
    });
  } else {
    footer = game.i18n.format("NarutoD20.Cards.Perform.Spent", { cost, summary: spendSummary });
  }
  await postPerformCard(
    actor,
    {
      name: item.name,
      cssClass: "success",
      message: "",
      messageClass: "",
      footer,
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
