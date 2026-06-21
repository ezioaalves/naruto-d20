/**
 * Naruto D20 — Technique Mastery
 *
 * Earning mastery steps mirrors the learning flow (`learn-technique.mjs`):
 * roll learn checks vs a DC, count successes toward the current step, and track
 * attempts / failure insight / training blocks / chakra. On reaching a step's
 * required successes the technique advances one mastery step (`system.mastery`).
 *
 * Rule differences vs learning (learn_mechanics.md § Mastery, p.107):
 *   • Gated on the technique already being learned; steps are sequential.
 *   • Mastery Learn DC = learnDC + (Hijutsu +2 / Kinjutsu +5).
 *   • Step-5 attempts take a −2 penalty on the check.
 *   • Per-step successes come from MASTERY_SUCCESSES + the technique's success
 *     modifiers; then mode-scaled exactly like learning.
 */

import { MAX_MASTERY_STEP } from "../../core/constants.mjs";
import { actionPointsPath, masteryCurrentTechniqueIdPath } from "../../core/flag-paths.mjs";
import { chatVisibilityFrom } from "../chat/visibility.mjs";
import { markNarutoRollRerollable } from "../chat/rerolls.mjs";
import { buildLearnCheckBreakdown } from "../chakra/bonus-sources.mjs";
import { MASTERY_SUCCESSES } from "./model.mjs";
import {
  getTechniqueLearningResolution,
  isTechniqueEffectivelyLearned,
  resolveTechniqueLearningSkill,
} from "./learn.mjs";
import {
  PROGRESSION_MODES,
  applyTrainingChakraDeduction,
  blockUnit,
  buildProgressionRollRerollData,
  canPayTrainingChakra,
  getMaxAttempts,
  getTrainingMode,
  marginAward,
  minimumTrainingBlocksForRoll,
  postProgressionCard,
  registerProgressionRollReroll,
  renderProgressionBlock,
  rollTotal,
  spliceProgressionBlock,
  trainingBlocksForRoll,
  trainingChakraCost,
  trainingTimestamp,
  warnInsufficientTrainingChakra,
} from "../../data/training-progression.mjs";

const TRAINING_INTERRUPTION_SECONDS = 30 * 24 * 60 * 60;

/** Mastery-flow Action-Point card config for the shared progression engine. */
const MASTER_CARD_CONFIG = {
  flagKey: "master",
  actionPointsPath,
  apRollTextKey: "NarutoD20.Cards.Master.ActionPointRollText",
  getState: (item) => item.system.masteryLearning ?? {},
  resolveAttempt: (item, actor, opts) => resolveMasterAttempt(item, actor, opts),
};
const MASTER_REROLL_SOURCE = "master-attempt";

function postMasteryCard(actor, item, opts) {
  return postProgressionCard(actor, item, { ...opts, flagKey: "master" });
}

// ── Step / target / DC helpers ──────────────────────────────────────────────

/** Achieved mastery step (0–5). */
function currentStep(item) {
  return Math.max(0, Math.min(MAX_MASTERY_STEP, Number(item.system.mastery ?? 0) || 0));
}

/** The step this run is working toward (achieved + 1), clamped to 5. */
function targetStep(item) {
  return Math.min(MAX_MASTERY_STEP, currentStep(item) + 1);
}

/** Base successes to obtain `step`, plus the technique's success modifiers. */
function stepSuccesses(item, step = targetStep(item)) {
  const base = MASTERY_SUCCESSES[step] ?? 1;
  const modifier = Number(item.system.derived?.successModifier ?? 0) || 0;
  return Math.max(1, base + modifier);
}

function getMasteryDerivedTarget(item, mode, step = targetStep(item)) {
  const successes = stepSuccesses(item, step);
  if (mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS) {
    const rank = Math.max(1, Number(item.system.rank ?? 1) || 1);
    return rank * successes * 2;
  }
  return successes;
}

export function getMasteryTargetProgress(item, mode = getTrainingMode(), step = targetStep(item)) {
  const override = Number(item.system.masteryLearning?.successesOverride);
  if (Number.isFinite(override) && override > 0) return Math.max(1, Math.floor(override));
  return getMasteryDerivedTarget(item, mode, step);
}

export function getMasteryLearnDC(item) {
  const base = Number(item.system.derived?.learnDC ?? 10) || 10;
  const descriptors = item.system.descriptors ?? new Set();
  let dc = base;
  if (item.system.isHijutsu || descriptors.has?.("Hijutsu")) dc += 2;
  if (item.system.isKinjutsu || descriptors.has?.("Kinjutsu")) dc += 5;
  return dc;
}

// ── Sheet view ──────────────────────────────────────────────────────────────

export function buildMasteryView(item, actor, mode = getTrainingMode()) {
  const ml = item.system.masteryLearning ?? {};
  const step = currentStep(item);
  const next = targetStep(item);
  const atMax = step >= MAX_MASTERY_STEP;

  const targetProgress = getMasteryTargetProgress(item, mode, next);
  const progress = Math.min(Number(ml.progress ?? 0) || 0, targetProgress);
  const learned = isTechniqueEffectivelyLearned(item);
  // Skill for display only — resolved without prompting (null for an
  // unconfigured Training technique).
  const skillKey = getTechniqueLearningResolution(item).skillKey;

  return {
    step,
    nextStep: next,
    atMax,
    learned,
    canMaster: learned && !atMax,
    progress,
    targetProgress,
    requiredSuccesses: targetProgress,
    derivedSuccesses: getMasteryDerivedTarget(item, mode, next),
    successesOverride: ml.successesOverride ?? null,
    attemptsUsed: Number(ml.attemptsUsed ?? 0) || 0,
    maxAttempts: getMaxAttempts(actor, skillKey),
    failureInsight: Number(ml.failureInsight ?? 0) || 0,
    trainingBlocks: Number(ml.trainingBlocks ?? 0) || 0,
    chakraSpent: Number(ml.chakraSpent ?? 0) || 0,
    actionPointBonus: Number(ml.actionPointBonus ?? 0) || 0,
    learnDC: getMasteryLearnDC(item),
    mode,
    isFourHourBlocks: mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS,
    isStep5: next === MAX_MASTERY_STEP,
  };
}

// ── Attempt flow ────────────────────────────────────────────────────────────

export async function attemptMasterTechnique(item) {
  const actor = validateMasteryActor(item);
  if (!actor) return;

  if (!validateMasteryState(item)) return;

  const learningSkill = await resolveTechniqueLearningSkill(item);
  if (!learningSkill) return;

  const { skillKey } = learningSkill;
  if (!skillKey) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.MasterySkillRequired", {
        actor: actor.name,
        name: item.name,
      }),
    );
    return;
  }

  const mode = getTrainingMode();
  if (!validateMasterySkillAndChakra(item, actor, skillKey, mode)) return;

  const activeState = await prepareActiveMastery(actor, item);
  const roll = await rollMasteryCheck(item, actor, skillKey, activeState);
  if (!roll) return;

  await resolveMasterAttempt(item, actor, {
    skillKey,
    mode,
    baseState: activeState,
    total: roll.total,
    apBonus: roll.apBonus,
    rollMessage: roll.message,
  });
}

function validateMasteryActor(item) {
  const actor = item.actor;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Notifications.EquipToMaster"));
    return null;
  }
  if (!actor.isOwner) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoPermissionUpdate", { actor: actor.name }),
    );
    return null;
  }
  return actor;
}

function validateMasteryState(item) {
  if (!isTechniqueEffectivelyLearned(item)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotLearnedForMastery", { name: item.name }),
    );
    return false;
  }
  if (currentStep(item) >= MAX_MASTERY_STEP) {
    ui.notifications.info(
      game.i18n.format("NarutoD20.Notifications.AlreadyMaxMastery", { name: item.name }),
    );
    return false;
  }
  return true;
}

function validateMasterySkillAndChakra(item, actor, skillKey, mode) {
  const ranks = Number(actor.system.skills?.[skillKey]?.rank ?? 0) || 0;
  if (ranks < 1) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.SkillRankRequired", {
        actor: actor.name,
        skill: pf1.config.skills?.[skillKey] ?? skillKey,
        name: item.name,
      }),
    );
    return false;
  }

  const minimumChakraCost = trainingChakraCost(
    actor,
    minimumTrainingBlocksForRoll(item.system.rank, mode),
  );
  if (!canPayTrainingChakra(actor, minimumChakraCost)) {
    warnInsufficientTrainingChakra(actor, minimumChakraCost);
    return false;
  }

  return true;
}

async function prepareActiveMastery(actor, item) {
  const state = item.system.masteryLearning ?? {};
  const switched = await resetMasteryInsightForDifferentTechnique(actor, item, state);
  return expireInterruptedMastery(item, switched);
}

async function resetMasteryInsightForDifferentTechnique(actor, item, state) {
  const currentId = foundry.utils.getProperty(actor, masteryCurrentTechniqueIdPath);
  if (currentId === item.id) return { ...state };

  if (currentId) {
    const previous = actor.items.get(currentId);
    if (previous?.system?.masteryLearning?.failureInsight) {
      await previous.update({ "system.masteryLearning.failureInsight": 0 });
    }
    if (item.system.masteryLearning?.failureInsight) {
      await item.update({ "system.masteryLearning.failureInsight": 0 });
    }
  }

  await actor.update({ [masteryCurrentTechniqueIdPath]: item.id });
  return { ...state, failureInsight: 0 };
}

async function expireInterruptedMastery(item, state) {
  const lastTrainingAt = Number(state.lastTrainingAt ?? 0) || 0;
  const now = trainingTimestamp();
  if (!lastTrainingAt || now - lastTrainingAt <= TRAINING_INTERRUPTION_SECONDS) {
    return { ...state };
  }

  await item.update({
    "system.masteryLearning.progress": 0,
    "system.masteryLearning.attemptsUsed": 0,
    "system.masteryLearning.failureInsight": 0,
    "system.masteryLearning.trainingBlocks": 0,
    "system.masteryLearning.chakraSpent": 0,
    "system.masteryLearning.lastTrainingAt": 0,
    "system.masteryLearning.actionPointBonus": 0,
  });

  await postMasteryCard(item.actor, item, {
    title: game.i18n.format("NarutoD20.Cards.Master.TrainingInterruptedTitle", { name: item.name }),
    cssClass: "failed",
    lead: game.i18n.localize("NarutoD20.Cards.Master.TrainingInterruptedLead"),
  });

  return {
    ...state,
    progress: 0,
    attemptsUsed: 0,
    failureInsight: 0,
    trainingBlocks: 0,
    chakraSpent: 0,
    lastTrainingAt: 0,
    actionPointBonus: 0,
  };
}

async function rollMasteryCheck(item, actor, skillKey, activeState) {
  const failureInsight = Math.min(5, Math.max(0, Number(activeState.failureInsight ?? 0) || 0));
  const apBonus = Math.max(0, Number(activeState.actionPointBonus ?? 0) || 0);
  const breakdown = buildLearnCheckBreakdown(actor, skillKey, { item, includeConditional: true });
  if (!breakdown) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.LearnDataNotReady", {
        actor: actor.name,
        skill: skillKey,
      }),
    );
    return null;
  }

  const parts = [...breakdown.parts];
  if (failureInsight > 0) parts.push(`${failureInsight}[Failure Insight]`);
  if (apBonus > 0) parts.push(`${apBonus}[Action Point]`);
  // Step-5 mastery attempts take a −2 penalty on the check.
  if (targetStep(item) === MAX_MASTERY_STEP) parts.push(`-2[Step 5 Mastery]`);

  const masteryDC = getMasteryLearnDC(item);
  const result = await pf1.dice.d20Roll({
    flavor: game.i18n.format("NarutoD20.Cards.Master.Flavor", {
      name: item.name,
      step: targetStep(item),
    }),
    parts,
    rollData: actor.getRollData?.() ?? {},
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    dc: masteryDC,
  });
  if (!result) return null;

  const total = rollTotal(result);
  if (!Number.isFinite(total)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.CouldNotReadRoll", { name: item.name }),
    );
    return null;
  }

  return { total, apBonus, rollVisibility: chatVisibilityFrom(result), message: result };
}

async function resolveMasterAttempt(
  item,
  actor,
  {
    skillKey,
    mode,
    baseState,
    total,
    apBonus = 0,
    apRollText = "",
    rollMessage = null,
    returnBlock = false,
  },
) {
  const result = buildMasteryAttemptResult(item, actor, {
    skillKey,
    mode,
    baseState,
    total,
    apBonus,
  });
  const chakraDeduction = await applyTrainingChakraDeduction(actor, result.chakraCost);
  if (!chakraDeduction.paid) return null;

  const now = trainingTimestamp();
  await persistMasteryAttemptResult(item, actor, result, now);

  const html = await renderProgressionBlock(
    buildMasterAttemptCardParts(item, { result, chakraDeduction, apRollText }),
  );

  if (!returnBlock && rollMessage) {
    await rollMessage.update({ content: spliceProgressionBlock(rollMessage.content, html) });
    const rerollData = buildProgressionRollRerollData(item, actor, {
      skillKey,
      mode,
      baseState,
      result,
      chakraDeduction,
      now,
    });
    if (rerollData) {
      await markNarutoRollRerollable(rollMessage, actor, MASTER_REROLL_SOURCE, rerollData);
    }
  }

  return { html, result };
}

function buildMasteryAttemptResult(item, actor, { skillKey, mode, baseState, total, apBonus }) {
  const step = targetStep(item);
  const learnDC = getMasteryLearnDC(item);
  const targetProgress = getMasteryTargetProgress(item, mode, step);
  const maxAttempts = getMaxAttempts(actor, skillKey);
  const oldProgress = Number(baseState.progress ?? 0) || 0;
  const oldAttempts = Number(baseState.attemptsUsed ?? 0) || 0;
  const baseFailureInsight = Math.min(5, Math.max(0, Number(baseState.failureInsight ?? 0) || 0));
  const attemptsUsed = oldAttempts + 1;
  const success = total >= learnDC;
  const margin = total - learnDC;
  const trainingBlocks = trainingBlocksForRoll(item.system.rank, mode, margin);
  const chakraCost = trainingChakraCost(actor, trainingBlocks);

  let progress = oldProgress;
  let nextFailureInsight;
  let stepAchieved = false;
  let resetRun = false;
  let award = 0;

  if (success) {
    award = marginAward(margin, mode);
    progress = Math.min(targetProgress, oldProgress + award);
    stepAchieved = progress >= targetProgress;
    nextFailureInsight = stepAchieved ? 0 : baseFailureInsight;
  } else {
    nextFailureInsight = Math.min(5, baseFailureInsight + 1);
  }

  if (!stepAchieved && mode === PROGRESSION_MODES.STANDARD && attemptsUsed >= maxAttempts) {
    resetRun = true;
    progress = 0;
    nextFailureInsight = 0;
  }

  const runEnded = stepAchieved || resetRun;
  const newStep = stepAchieved ? step : currentStep(item);

  return {
    skillKey,
    mode,
    total,
    apBonus,
    learnDC,
    step,
    newStep,
    targetProgress,
    maxAttempts,
    attemptsUsed,
    success,
    trainingBlocks,
    chakraCost,
    totalTrainingBlocks: (Number(baseState.trainingBlocks ?? 0) || 0) + trainingBlocks,
    totalChakraSpent: (Number(baseState.chakraSpent ?? 0) || 0) + chakraCost,
    progress,
    nextFailureInsight,
    stepAchieved,
    atMax: stepAchieved && step >= MAX_MASTERY_STEP,
    resetRun,
    runEnded,
    award,
    nextApBonus: runEnded ? 0 : apBonus,
    finalAttemptsUsed: resetRun ? 0 : attemptsUsed,
  };
}

async function persistMasteryAttemptResult(item, actor, result, now) {
  if (result.stepAchieved) {
    // Advance the achieved step and reset the run for the next step.
    await item.update({
      "system.mastery": result.newStep,
      "system.masteryLearning.progress": 0,
      "system.masteryLearning.attemptsUsed": 0,
      "system.masteryLearning.failureInsight": 0,
      "system.masteryLearning.trainingBlocks": 0,
      "system.masteryLearning.chakraSpent": 0,
      "system.masteryLearning.lastTrainingAt": now,
      "system.masteryLearning.actionPointBonus": 0,
    });
    await actor.update({ [masteryCurrentTechniqueIdPath]: null });
    return;
  }

  await item.update({
    "system.masteryLearning.progress": result.progress,
    "system.masteryLearning.attemptsUsed": result.finalAttemptsUsed,
    "system.masteryLearning.failureInsight": result.nextFailureInsight,
    "system.masteryLearning.trainingBlocks": result.totalTrainingBlocks,
    "system.masteryLearning.chakraSpent": result.totalChakraSpent,
    "system.masteryLearning.lastTrainingAt": now,
    "system.masteryLearning.actionPointBonus": result.nextApBonus,
  });
}

/** Build the title/lead/footer/cssClass for a mastery attempt's progression block. */
function buildMasterAttemptCardParts(item, { result, chakraDeduction, apRollText }) {
  const apLine = apRollText ? `${apRollText} → ` : "";
  const chakraLine = chakraDeduction.deducted
    ? game.i18n.format("NarutoD20.Cards.Master.ChakraDeducted", {
        cost: result.chakraCost,
        deducted: chakraDeduction.deducted,
      })
    : `${result.chakraCost}`;
  const blocksUnit = blockUnit(result.trainingBlocks);

  const trainingFooter = game.i18n.format("NarutoD20.Cards.Master.TrainingFooter", {
    blocks: result.trainingBlocks,
    unit: blocksUnit,
    chakra: chakraLine,
  });

  if (result.stepAchieved) {
    return {
      title: game.i18n.format("NarutoD20.Cards.Master.StepAchievedTitle", {
        name: item.name,
        step: result.newStep,
      }),
      cssClass: "success",
      lead: game.i18n.format("NarutoD20.Cards.Master.StepAchievedLead", {
        ap: apLine,
        total: result.total,
        dc: result.learnDC,
        step: result.newStep,
      }),
      footer: trainingFooter,
    };
  }

  if (result.resetRun) {
    return {
      title: game.i18n.format("NarutoD20.Cards.Master.MasteringFailedTitle", { name: item.name }),
      cssClass: "failed",
      lead: game.i18n.format("NarutoD20.Cards.Master.CheckReset", {
        ap: apLine,
        total: result.total,
        dc: result.learnDC,
        used: result.attemptsUsed,
        max: result.maxAttempts,
        step: result.step,
      }),
      footer: trainingFooter,
    };
  }

  const attemptText =
    result.mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS
      ? game.i18n.format("NarutoD20.Cards.Master.BlocksCount", {
          count: result.attemptsUsed,
          unit: blockUnit(result.attemptsUsed),
        })
      : game.i18n.format("NarutoD20.Cards.Master.AttemptsCount", {
          used: result.attemptsUsed,
          max: result.maxAttempts,
        });
  const resultText = result.success
    ? game.i18n.format("NarutoD20.Cards.Master.ResultSuccess", { award: result.award })
    : game.i18n.format("NarutoD20.Cards.Master.ResultFailure", {
        insight: result.nextFailureInsight,
      });

  return {
    title: game.i18n.format("NarutoD20.Cards.Master.MasteringTitle", {
      name: item.name,
      step: result.step,
    }),
    cssClass: result.success ? "success" : "failed",
    lead: game.i18n.format("NarutoD20.Cards.Master.CheckResult", {
      ap: apLine,
      total: result.total,
      dc: result.learnDC,
      result: resultText,
    }),
    footer: game.i18n.format("NarutoD20.Cards.Master.AttemptFooter", {
      progress: result.progress,
      target: result.targetProgress,
      attempts: attemptText,
      blocks: result.trainingBlocks,
      unit: blockUnit(result.trainingBlocks),
      chakra: chakraLine,
    }),
  };
}

/** Register the reroll / "Add Action Point" handlers on the mastery roll card. */
export function registerMasterCardContextMenu() {
  registerProgressionRollReroll(MASTER_REROLL_SOURCE, MASTER_CARD_CONFIG);
}
