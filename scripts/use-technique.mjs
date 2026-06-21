import { MODULE_ID } from "./constants.mjs";
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";
import {
  applyChakraSpend,
  availableChakra,
  calculateChakraSpend,
  canPayChakra,
} from "./data/chakra-spend.mjs";
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
import {
  findMaintenanceBuffForTechnique,
  maintenanceFacets,
} from "./automation/maintenance-buffs.mjs";
import {
  clearPendingCastElements,
  elementCount,
  getActiveElements,
  promptElements,
  setPendingCastElements,
} from "./automation/maintenance-element-damage.mjs";
import {
  normalizeEmpowerConfig,
  resolveEmpowerStepLimit,
  resolveEmpowerUse,
  shouldPromptEmpowerBeforePerform,
} from "./automation/technique-empower.mjs";
import { getTechniqueCasterLevel } from "./data/technique-rolldata.mjs";

export function canAffordTechnique(actor, item) {
  return canPayChakra(actor, item.system.chakraCost ?? 0);
}

function getTechniqueAttackAdjustments(item) {
  const raw = item.system?.attackAdjustments ?? {};
  return {
    sizeBonus: Number(raw.sizeBonus ?? 0) || 0,
    critConfirmBonus: String(raw.critConfirmBonus ?? "").trim(),
  };
}

function applyEmpowerDamage(actionUse, empower, cleanup) {
  if (!empower?.steps || !empower.damageFormula) return;

  if (empower.damageTypes?.length) {
    const parts = (actionUse.shared.action.damage.parts ??= []);
    const originalLength = parts.length;
    parts.push({ formula: empower.damageFormula, types: [...empower.damageTypes] });
    cleanup.push(() => parts.splice(originalLength, 1));
  } else {
    actionUse.shared.damageBonus.push(empower.damageFormula);
  }
}

function installTechniqueActionUseHook(item, actor, action, cleanup, empower = null) {
  const adjustments = getTechniqueAttackAdjustments(item);
  if (!adjustments.sizeBonus && !adjustments.critConfirmBonus && !empower?.steps) return null;

  const hook = (actionUse) => {
    if (actionUse.actor?.id !== actor.id) return;
    if (actionUse.item?.id !== item.id) return;
    if (actionUse.action?.id !== action.id) return;

    applyEmpowerDamage(actionUse, empower, cleanup);

    if (adjustments.critConfirmBonus) {
      const previous = actionUse.shared.action.critConfirmBonus;
      actionUse.shared.action.critConfirmBonus = previous
        ? `${previous} + ${adjustments.critConfirmBonus}`
        : adjustments.critConfirmBonus;
      cleanup.push(() => {
        if (previous) actionUse.shared.action.critConfirmBonus = previous;
        else delete actionUse.shared.action.critConfirmBonus;
      });
    }

    if (adjustments.sizeBonus) {
      const rollData = actionUse.shared.rollData;
      const previousSize = rollData.size;
      const itemSize = rollData.item?.size;
      rollData.size = (Number(previousSize) || 0) + adjustments.sizeBonus;
      if (Number.isFinite(itemSize)) rollData.item.size = itemSize + adjustments.sizeBonus;
      cleanup.push(() => {
        rollData.size = previousSize;
        if (Number.isFinite(itemSize)) rollData.item.size = itemSize;
      });
    }
  };

  Hooks.on("pf1CreateActionUse", hook);
  cleanup.push(() => Hooks.off("pf1CreateActionUse", hook));
  return hook;
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
  const upkeepFree =
    maintenanceFacets(currentItem)?.resource === "hp" &&
    Boolean(findMaintenanceBuffForTechnique(actor, currentItem.id));
  const chakraFree = freeUseChoice?.useFree === true || upkeepFree;
  const delegatedWeaponAttack = Boolean(getTechniqueWeaponAttackConfig(currentItem));
  const empowerConfig = normalizeEmpowerConfig(currentItem.system.automation?.empower);
  let empower = null;

  if (!chakraFree && !canAffordTechnique(actor, currentItem)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotEnoughChakra", {
        actor: actor.name,
        name: currentItem.name,
      }),
    );
    return;
  }

  if (
    !delegatedWeaponAttack &&
    !chakraFree &&
    empowerConfig.enabled &&
    shouldPromptEmpowerBeforePerform(empowerConfig)
  ) {
    empower = await resolveEmpowerChoice(currentItem, actor, cost);
    if (empower === "cancel") return;
  }

  const perform = await resolvePerformCheck(currentItem, actor, {
    dcBonus: empower?.performIncrease ?? 0,
    note:
      empower?.performIncrease > 0
        ? game.i18n.format("NarutoD20.Empower.PerformIncrease", {
            value: empower.performIncrease,
          })
        : "",
  });
  if (!perform) return;
  if (!perform.succeeded) {
    await postPerformFailureCard(actor, currentItem, perform);
    return;
  }

  try {
    // Element stances pick their damage element(s) before the attack rolls so the
    // pf1PreDamageRoll hook can type the damage. On entry we prompt; while the stance
    // is already active we reuse the element(s) stored on the buff.
    if (currentItem.system.automation.maintenance?.element === true) {
      const active = getActiveElements(actor, currentItem);
      if (active?.length) {
        setPendingCastElements(actor, currentItem, active);
      } else {
        const elements = await promptElements(currentItem, elementCount(currentItem));
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

    if (!delegatedWeaponAttack && !chakraFree && empowerConfig.enabled && !empower) {
      empower = await resolveEmpowerChoice(current.item, actor, cost);
      if (empower === "cancel") return;
    }

    if (
      !chakraFree &&
      !canPayChakra(actor, empower?.totalCost ?? current.item.system.chakraCost ?? cost)
    ) {
      ui.notifications.warn(
        game.i18n.format("NarutoD20.Notifications.NotEnoughChakra", {
          actor: actor.name,
          name: current.item.name,
        }),
      );
      return;
    }

    const useResult = await useTechniqueAction(current.item, current.action, actor, event, {
      empower,
    });
    if (!useResult || useResult.err) return;

    let spend = null;
    if (upkeepFree) {
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
      cost = empower?.totalCost ?? current.item.system.chakraCost ?? cost;
      spend = calculateChakraSpend(actor, cost);
      await applyChakraSpend(actor, spend);
    }
    await postTechniqueSuccessCard(actor, current.item, cost, spend?.summary ?? null, perform, {
      freeUse: freeUseChoice?.useFree === true,
      upkeepFree,
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
    if (currentItem.system.automation.maintenance?.element === true)
      clearPendingCastElements(actor, currentItem);
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

async function resolveEmpowerChoice(item, actor, baseCost) {
  const config = normalizeEmpowerConfig(item.system.automation?.empower);
  if (!config.enabled) return null;

  const rollData = item.getRollData?.() ?? {};
  rollData.cl = getTechniqueCasterLevel(item);
  const availableExtraChakra = Math.max(
    0,
    availableChakra(actor) - Math.max(0, Number(baseCost) || 0),
  );
  const maxSteps = await resolveEmpowerStepLimit({ config, rollData, availableExtraChakra });
  if (maxSteps <= 0) return resolveEmpowerUse({ config, steps: 0, baseCost });

  const steps = await promptEmpowerSteps(item, config, maxSteps);
  if (steps === null) return "cancel";
  return resolveEmpowerUse({ config, steps, baseCost });
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

function promptEmpowerSteps(item, config, maxSteps) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const content = `
      <form>
        <p>${game.i18n.format("NarutoD20.Empower.Prompt", {
          name: item.name,
          cost: config.costPerStep,
          formula: config.formulaPerStep,
        })}</p>
        <div class="form-group">
          <label>${game.i18n.localize("NarutoD20.Empower.Steps")}</label>
          <input type="number" name="steps" value="0" min="0" max="${maxSteps}" step="1">
        </div>
      </form>`;

    new Dialog({
      title: game.i18n.format("NarutoD20.Empower.Title", { name: item.name }),
      content,
      buttons: {
        roll: {
          icon: '<i class="fas fa-bolt"></i>',
          label: game.i18n.localize("PF1.Roll"),
          callback: (html) => {
            const raw = Number(html.find("input[name='steps']").val());
            done(Math.max(0, Math.min(maxSteps, Math.floor(raw) || 0)));
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.Common.Cancel"),
          callback: () => done(null),
        },
      },
      default: "roll",
      close: () => done(null),
    }).render(true);
  });
}

async function resolvePerformCheck(item, actor, { dcBonus = 0, note = "" } = {}) {
  const sys = item.system;
  const derived = sys.derived;
  const skillKey = DISCIPLINE_SKILL_MAP[sys.discipline];
  const skillRanks = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
  const threshold = derived.skillThreshold;
  const performDC = derived.performDC + Math.max(0, Number(dcBonus) || 0);
  const masteryPerform = derived.masteryPerform ?? 0;
  const masteryNote =
    masteryPerform > 0
      ? game.i18n.format("NarutoD20.Cards.Perform.MasteryNote", { value: masteryPerform })
      : "";
  const empowerNote = note ? ` ${note}` : "";
  const dcNote = `${masteryNote}${empowerNote}`;

  if (!skillKey || skillRanks + masteryPerform >= threshold) {
    return {
      succeeded: true,
      performDC,
      masteryNote: dcNote,
      bypassNote: skillKey
        ? game.i18n.format("NarutoD20.Cards.Perform.AutoBypass", {
            ranks: skillRanks,
            mastery: dcNote,
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
    masteryNote: dcNote,
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

async function useTechniqueAction(item, action, actor, event, options = {}) {
  const weaponAttackConfig = getTechniqueWeaponAttackConfig(item);
  if (weaponAttackConfig) {
    return rollSelectedWeaponAttackWithTechnique({
      technique: item,
      techniqueAction: action,
      actor,
      config: weaponAttackConfig,
      event,
      empower: options.empower,
    });
  }

  const cleanup = [];
  installTechniqueActionUseHook(item, actor, action, cleanup, options.empower);
  try {
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
  } finally {
    for (const restore of cleanup.reverse()) restore();
  }
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
  if (options.upkeepFree) {
    footer = game.i18n.localize("NarutoD20.Cards.Perform.UpkeepFree");
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
