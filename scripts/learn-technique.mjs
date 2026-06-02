import { MODULE_ID } from "./constants.mjs";
import {
  actionPointsPath,
  chakraPoolValuePath,
  chakraReserveValuePath,
  learningCurrentTechniqueIdPath,
} from "./flag-paths.mjs";
import { buildLearnCheckBreakdown } from "./data/bonus-sources.mjs";
import { DISCIPLINE_SKILL_MAP, resolveSkillAbility } from "./data/skills.mjs";

export const LEARNING_MODES = Object.freeze({
  STANDARD: "standard",
  FOUR_HOUR_BLOCKS: "fourHourBlocks",
});

const TRAINING_INTERRUPTION_SECONDS = 30 * 24 * 60 * 60;

function characterLevel(actor) {
  return Number(actor.system.details?.level?.value ?? actor.system.details?.cr?.total ?? 0) || 0;
}

function blockUnit(count) {
  return game.i18n.localize(count === 1 ? "NarutoD20.Cards.Block" : "NarutoD20.Cards.Blocks");
}

function getLearningMode() {
  return game.settings.get(MODULE_ID, "learningProgressionMode") || LEARNING_MODES.STANDARD;
}

function trainingTimestamp() {
  const worldTime = Number(game.time?.worldTime ?? 0) || 0;
  return worldTime > 0 ? worldTime : Math.floor(Date.now() / 1000);
}

export function getLearningTargetProgress(item, mode = getLearningMode()) {
  const successes = Math.max(1, Number(item.system.derived?.successes ?? 1) || 1);
  if (mode === LEARNING_MODES.FOUR_HOUR_BLOCKS) {
    const rank = Math.max(1, Number(item.system.rank ?? 1) || 1);
    return rank * successes * 2;
  }
  return successes;
}

export function getLearningMaxAttempts(actor, skillKey) {
  if (!actor || !skillKey) return null;
  const ability = resolveSkillAbility(actor, skillKey);
  const abilityMod = Number(actor.system.abilities?.[ability]?.mod ?? 0) || 0;
  const ranks = Number(actor.system.skills?.[skillKey]?.rank ?? 0) || 0;
  return Math.max(1, 1 + abilityMod + Math.floor(ranks / 2));
}

export function isTechniqueEffectivelyLearned(item) {
  const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
  return item.system.learning?.learned === true || !skillKey;
}

export function buildLearningView(item, actor, mode = getLearningMode()) {
  const learning = item.system.learning ?? {};
  const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
  const targetProgress = getLearningTargetProgress(item, mode);
  const progress = Math.min(Number(learning.progress ?? 0) || 0, targetProgress);
  const attemptsUsed = Number(learning.attemptsUsed ?? 0) || 0;
  const failureInsight = Number(learning.failureInsight ?? 0) || 0;
  const trainingBlocks = Number(learning.trainingBlocks ?? 0) || 0;
  const chakraSpent = Number(learning.chakraSpent ?? 0) || 0;
  const lastTrainingAt = Number(learning.lastTrainingAt ?? 0) || 0;

  return {
    learned: learning.learned === true,
    effectivelyLearned: learning.learned === true || !skillKey,
    progress,
    attemptsUsed,
    failureInsight,
    trainingBlocks,
    chakraSpent,
    lastTrainingAt,
    actionPointBonus: Number(learning.actionPointBonus ?? 0) || 0,
    expiresAt: lastTrainingAt ? lastTrainingAt + TRAINING_INTERRUPTION_SECONDS : 0,
    targetProgress,
    maxAttempts: getLearningMaxAttempts(actor, skillKey),
    mode,
    isFourHourBlocks: mode === LEARNING_MODES.FOUR_HOUR_BLOCKS,
    hasSkill: !!skillKey,
  };
}

function marginAward(margin, mode) {
  if (mode === LEARNING_MODES.STANDARD) return 1;
  if (margin >= 15) return 4;
  const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
  return inclusive ? (margin >= 5 ? 2 : 1) : margin > 5 ? 2 : 1;
}

function clearsFiveBoundary(margin) {
  const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
  return inclusive ? margin >= 5 : margin > 5;
}

function failsFiveBoundary(margin) {
  const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
  return inclusive ? margin <= -5 : margin < -5;
}

function trainingBlocksForRoll(item, mode, margin) {
  if (mode === LEARNING_MODES.FOUR_HOUR_BLOCKS) return 1;

  const rank = Math.max(1, Number(item.system.rank ?? 1) || 1);
  const baseBlocks = rank * 2;
  if (margin >= 15) return Math.max(1, Math.ceil(baseBlocks * 0.25));
  if (clearsFiveBoundary(margin)) return Math.max(1, Math.ceil(baseBlocks * 0.5));
  if (failsFiveBoundary(margin)) return Math.max(1, Math.ceil(baseBlocks * 1.5));
  return baseBlocks;
}

function trainingChakraCost(actor, blocks) {
  const poolMax = Number(actor.flags?.[MODULE_ID]?.chakra?.pool?.max ?? 0) || 0;
  return Math.max(0, Math.ceil(poolMax * 0.4 * blocks));
}

function minimumTrainingBlocksForRoll(item, mode) {
  if (mode === LEARNING_MODES.FOUR_HOUR_BLOCKS) return 1;

  const rank = Math.max(1, Number(item.system.rank ?? 1) || 1);
  return Math.max(1, Math.ceil(rank * 2 * 0.25));
}

function availableTrainingChakra(actor) {
  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);
  const reserveValue = Math.max(0, Number(chakra.reserve?.value ?? 0) || 0);
  return poolValue + reserveValue;
}

function warnInsufficientTrainingChakra(actor, amount, available = availableTrainingChakra(actor)) {
  ui.notifications.warn(
    game.i18n.format("NarutoD20.Notifications.TrainingChakraRequired", {
      actor: actor.name,
      amount,
      available,
    }),
  );
}

function canPayTrainingChakra(actor, amount) {
  if (!game.settings.get(MODULE_ID, "deductLearningChakra") || amount <= 0) return true;
  return availableTrainingChakra(actor) >= amount;
}

async function applyTrainingChakraDeduction(actor, amount) {
  if (!game.settings.get(MODULE_ID, "deductLearningChakra") || amount <= 0) {
    return { paid: true, deducted: 0, fromPool: 0, fromReserve: 0 };
  }

  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);
  const reserveValue = Math.max(0, Number(chakra.reserve?.value ?? 0) || 0);
  const available = poolValue + reserveValue;
  if (available < amount) {
    warnInsufficientTrainingChakra(actor, amount, available);
    return { paid: false, deducted: 0, fromPool: 0, fromReserve: 0 };
  }

  const fromPool = Math.min(amount, poolValue);
  const fromReserve = Math.min(amount - fromPool, reserveValue);
  const deducted = fromPool + fromReserve;

  await actor.update({
    [chakraPoolValuePath]: poolValue - fromPool,
    [chakraReserveValuePath]: reserveValue - fromReserve,
  });

  return { paid: true, deducted, fromPool, fromReserve };
}

function rollTotal(result) {
  return result?.rolls?.[0]?.total ?? result?.roll?.total ?? result?.total ?? null;
}

async function postLearningCard(
  actor,
  item,
  { title, lead = "", footer = "", cssClass = "", flags = null },
) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/learning-result.hbs`,
    { title, lead, footer, cssClass },
  );
  const data = {
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
  };
  if (flags) data.flags = { [MODULE_ID]: { learn: flags } };
  await ChatMessage.create(data);
}

async function resetFailureInsightForDifferentTechnique(actor, item, learning) {
  const currentId = foundry.utils.getProperty(actor, learningCurrentTechniqueIdPath);
  if (currentId === item.id) return { ...learning };

  if (currentId) {
    const previous = actor.items.get(currentId);
    if (previous?.system?.learning?.failureInsight) {
      await previous.update({ "system.learning.failureInsight": 0 });
    }
    if (item.system.learning?.failureInsight) {
      await item.update({ "system.learning.failureInsight": 0 });
    }
  }

  await actor.update({ [learningCurrentTechniqueIdPath]: item.id });
  return { ...learning, failureInsight: 0 };
}

async function expireInterruptedTraining(item, learning) {
  const lastTrainingAt = Number(learning.lastTrainingAt ?? 0) || 0;
  const now = trainingTimestamp();
  if (!lastTrainingAt || now - lastTrainingAt <= TRAINING_INTERRUPTION_SECONDS) {
    return { ...learning };
  }

  await item.update({
    "system.learning.progress": 0,
    "system.learning.attemptsUsed": 0,
    "system.learning.failureInsight": 0,
    "system.learning.trainingBlocks": 0,
    "system.learning.chakraSpent": 0,
    "system.learning.lastTrainingAt": 0,
    "system.learning.actionPointBonus": 0,
  });

  await postLearningCard(item.actor, item, {
    title: game.i18n.format("NarutoD20.Cards.Learn.TrainingInterruptedTitle", { name: item.name }),
    cssClass: "failed",
    lead: game.i18n.localize("NarutoD20.Cards.Learn.TrainingInterruptedLead"),
  });

  return {
    ...learning,
    progress: 0,
    attemptsUsed: 0,
    failureInsight: 0,
    trainingBlocks: 0,
    chakraSpent: 0,
    lastTrainingAt: 0,
    actionPointBonus: 0,
  };
}

export async function attemptLearnTechnique(item) {
  const actor = validateLearningActor(item);
  if (!actor) return;

  const learning = item.system.learning ?? {};
  if (!validateLearningState(item, actor, learning)) return;

  const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
  if (!skillKey) {
    await learnUnmappedTechnique(item, actor, learning);
    return;
  }

  const mode = getLearningMode();
  if (!validateLearningSkillAndChakra(item, actor, skillKey, mode)) return;

  const activeLearning = await prepareActiveLearning(actor, item, learning);
  const roll = await rollLearnCheck(item, actor, skillKey, activeLearning);
  if (!roll) return;

  await resolveLearnAttempt(item, actor, {
    skillKey,
    mode,
    baseLearning: activeLearning,
    total: roll.total,
    apBonus: roll.apBonus,
  });
}

function validateLearningActor(item) {
  const actor = item.actor;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Notifications.EquipToLearn"));
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

function validateLearningState(item, actor, learning) {
  if (learning.learned) {
    ui.notifications.info(
      game.i18n.format("NarutoD20.Notifications.AlreadyLearned", { name: item.name }),
    );
    return false;
  }

  const rank = Number(item.system.rank ?? 1) || 1;
  const level = characterLevel(actor);
  if (rank > level) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.RankTooHigh", {
        name: item.name,
        rank,
        actor: actor.name,
        level,
      }),
    );
    return false;
  }

  return true;
}

async function learnUnmappedTechnique(item, actor, learning) {
  await item.update({
    "system.learning.learned": true,
    "system.learning.progress": getLearningTargetProgress(item),
    "system.learning.attemptsUsed": learning.attemptsUsed ?? 0,
    "system.learning.failureInsight": 0,
  });
  await actor.update({ [learningCurrentTechniqueIdPath]: null });
  await postLearningCard(actor, item, {
    title: game.i18n.format("NarutoD20.Cards.Learn.LearnedTitle", { name: item.name }),
    cssClass: "success",
    lead: game.i18n.format("NarutoD20.Cards.Learn.NoSkillLead", {
      discipline:
        item.system.discipline || game.i18n.localize("NarutoD20.Cards.Learn.UnmappedDiscipline"),
    }),
  });
}

function validateLearningSkillAndChakra(item, actor, skillKey, mode) {
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

  const minimumChakraCost = trainingChakraCost(actor, minimumTrainingBlocksForRoll(item, mode));
  if (!canPayTrainingChakra(actor, minimumChakraCost)) {
    warnInsufficientTrainingChakra(actor, minimumChakraCost);
    return false;
  }

  return true;
}

async function prepareActiveLearning(actor, item, learning) {
  const switchedLearning = await resetFailureInsightForDifferentTechnique(actor, item, learning);
  return expireInterruptedTraining(item, switchedLearning);
}

async function rollLearnCheck(item, actor, skillKey, activeLearning) {
  const failureInsight = Math.min(5, Math.max(0, Number(activeLearning.failureInsight ?? 0) || 0));
  const apBonus = Math.max(0, Number(activeLearning.actionPointBonus ?? 0) || 0);
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
  // A committed Action Point reuses the same rolled value on every attempt of the run.
  if (apBonus > 0) parts.push(`${apBonus}[Action Point]`);

  const learnDC = Number(item.system.derived?.learnDC ?? 10) || 10;
  // PF1e v11.11's d20Roll dialog exposes Take 10/20 together and does not
  // pass through a button override. Rules disallow Take 20; GMs must enforce
  // that table rule until we replace this with a custom dialog.
  const result = await pf1.dice.d20Roll({
    flavor: game.i18n.format("NarutoD20.Cards.Learn.Flavor", { name: item.name }),
    parts,
    rollData: actor.getRollData?.() ?? {},
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    dc: learnDC,
  });
  if (!result) return null;

  const total = rollTotal(result);
  if (!Number.isFinite(total)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.CouldNotReadRoll", { name: item.name }),
    );
    return null;
  }

  return { total, apBonus };
}

/**
 * Resolve one learn attempt from a *pre-attempt* learning snapshot and a total.
 * Extracted so the post-roll "Add Action Point" flow can replay the same attempt
 * with a boosted total. `apBonus` is the committed Action Point value (0 = none),
 * persisted to `actionPointBonus` so later rolls of the run reuse it. `supersedes`
 * is the chat card being replaced on re-evaluation.
 */
async function resolveLearnAttempt(
  item,
  actor,
  { skillKey, mode, baseLearning, total, apBonus = 0, supersedes = null, apRollText = "" },
) {
  const result = buildLearnAttemptResult(item, actor, {
    skillKey,
    mode,
    baseLearning,
    total,
    apBonus,
  });
  const chakraDeduction = await applyTrainingChakraDeduction(actor, result.chakraCost);
  if (!chakraDeduction.paid) return;

  const now = trainingTimestamp();
  await persistLearnAttemptResult(item, actor, result, now);

  if (supersedes) {
    try {
      await supersedes.delete();
    } catch (_e) {
      /* card already gone */
    }
  }

  await postLearnAttemptResultCard(actor, item, {
    result,
    baseLearning,
    chakraDeduction,
    now,
    apRollText,
  });
}

export function buildLearnAttemptResult(
  item,
  actor,
  { skillKey, mode, baseLearning, total, apBonus },
) {
  const learnDC = Number(item.system.derived?.learnDC ?? 10) || 10;
  const targetProgress = getLearningTargetProgress(item, mode);
  const maxAttempts = getLearningMaxAttempts(actor, skillKey);
  const oldProgress = Number(baseLearning.progress ?? 0) || 0;
  const oldAttempts = Number(baseLearning.attemptsUsed ?? 0) || 0;
  const baseFailureInsight = Math.min(
    5,
    Math.max(0, Number(baseLearning.failureInsight ?? 0) || 0),
  );
  const attemptsUsed = oldAttempts + 1;
  const success = total >= learnDC;
  const margin = total - learnDC;
  const trainingBlocks = trainingBlocksForRoll(item, mode, margin);
  const chakraCost = trainingChakraCost(actor, trainingBlocks);

  let progress = oldProgress;
  let nextFailureInsight;
  let learned = false;
  let resetRun = false;
  let award = 0;

  if (success) {
    award = marginAward(margin, mode);
    progress = Math.min(targetProgress, oldProgress + award);
    learned = progress >= targetProgress;
    nextFailureInsight = learned ? 0 : baseFailureInsight;
  } else {
    nextFailureInsight = Math.min(5, baseFailureInsight + 1);
  }

  if (!learned && mode === LEARNING_MODES.STANDARD && attemptsUsed >= maxAttempts) {
    resetRun = true;
    progress = 0;
    nextFailureInsight = 0;
  }

  const runEnded = learned || resetRun;

  return {
    skillKey,
    mode,
    total,
    apBonus,
    learnDC,
    targetProgress,
    maxAttempts,
    attemptsUsed,
    success,
    trainingBlocks,
    chakraCost,
    totalTrainingBlocks: (Number(baseLearning.trainingBlocks ?? 0) || 0) + trainingBlocks,
    totalChakraSpent: (Number(baseLearning.chakraSpent ?? 0) || 0) + chakraCost,
    progress,
    nextFailureInsight,
    learned,
    resetRun,
    runEnded,
    award,
    // AP persists through the run, clears at run end (no refund).
    nextApBonus: runEnded ? 0 : apBonus,
    finalAttemptsUsed: resetRun ? 0 : attemptsUsed,
  };
}

async function persistLearnAttemptResult(item, actor, result, now) {
  await item.update({
    "system.learning.learned": result.learned,
    "system.learning.progress": result.progress,
    "system.learning.attemptsUsed": result.finalAttemptsUsed,
    "system.learning.failureInsight": result.nextFailureInsight,
    "system.learning.trainingBlocks": result.totalTrainingBlocks,
    "system.learning.chakraSpent": result.totalChakraSpent,
    "system.learning.lastTrainingAt": now,
    "system.learning.actionPointBonus": result.nextApBonus,
  });

  if (result.learned) await actor.update({ [learningCurrentTechniqueIdPath]: null });
}

function buildLearnAttemptCardFlags(item, actor, { result, baseLearning, chakraDeduction, now }) {
  // Re-eval flags: only offer "Add Action Point" while the run is open and no AP is committed yet.
  if (result.runEnded || result.apBonus !== 0) return null;

  return {
    itemId: item.id,
    actorUuid: actor.uuid,
    skillKey: result.skillKey,
    mode: result.mode,
    baseLearning: foundry.utils.deepClone(baseLearning),
    baseTotalNoAp: result.total,
    deducted: { fromPool: chakraDeduction.fromPool, fromReserve: chakraDeduction.fromReserve },
    result: {
      progress: result.progress,
      attemptsUsed: result.finalAttemptsUsed,
      failureInsight: result.nextFailureInsight,
      lastTrainingAt: now,
    },
  };
}

async function postLearnAttemptResultCard(
  actor,
  item,
  { result, baseLearning, chakraDeduction, now, apRollText },
) {
  const apLine = apRollText ? `${apRollText} → ` : "";
  const chakraLine = chakraDeduction.deducted
    ? game.i18n.format("NarutoD20.Cards.Learn.ChakraDeducted", {
        cost: result.chakraCost,
        deducted: chakraDeduction.deducted,
      })
    : `${result.chakraCost}`;
  const blocksUnit = blockUnit(result.trainingBlocks);

  const trainingFooter = game.i18n.format("NarutoD20.Cards.Learn.TrainingFooter", {
    blocks: result.trainingBlocks,
    unit: blocksUnit,
    chakra: chakraLine,
  });

  if (result.learned) {
    await postLearningCard(actor, item, {
      title: game.i18n.format("NarutoD20.Cards.Learn.LearnedTitle", { name: item.name }),
      cssClass: "success",
      lead: game.i18n.format("NarutoD20.Cards.Learn.CheckProgress", {
        ap: apLine,
        total: result.total,
        dc: result.learnDC,
        progress: result.progress,
        target: result.targetProgress,
      }),
      footer: trainingFooter,
    });
    return;
  }

  if (result.resetRun) {
    await postLearningCard(actor, item, {
      title: game.i18n.format("NarutoD20.Cards.Learn.LearningFailedTitle", { name: item.name }),
      cssClass: "failed",
      lead: game.i18n.format("NarutoD20.Cards.Learn.CheckReset", {
        ap: apLine,
        total: result.total,
        dc: result.learnDC,
        used: result.attemptsUsed,
        max: result.maxAttempts,
      }),
      footer: trainingFooter,
    });
    return;
  }

  const attemptText =
    result.mode === LEARNING_MODES.FOUR_HOUR_BLOCKS
      ? game.i18n.format("NarutoD20.Cards.Learn.BlocksCount", {
          count: result.attemptsUsed,
          unit: blockUnit(result.attemptsUsed),
        })
      : game.i18n.format("NarutoD20.Cards.Learn.AttemptsCount", {
          used: result.attemptsUsed,
          max: result.maxAttempts,
        });
  const resultText = result.success
    ? game.i18n.format("NarutoD20.Cards.Learn.ResultSuccess", { award: result.award })
    : game.i18n.format("NarutoD20.Cards.Learn.ResultFailure", {
        insight: result.nextFailureInsight,
      });

  await postLearningCard(actor, item, {
    title: game.i18n.format("NarutoD20.Cards.Learn.LearningTitle", { name: item.name }),
    cssClass: result.success ? "success" : "failed",
    lead: game.i18n.format("NarutoD20.Cards.Learn.CheckResult", {
      ap: apLine,
      total: result.total,
      dc: result.learnDC,
      result: resultText,
    }),
    footer: game.i18n.format("NarutoD20.Cards.Learn.AttemptFooter", {
      progress: result.progress,
      target: result.targetProgress,
      attempts: attemptText,
      blocks: result.trainingBlocks,
      unit: blockUnit(result.trainingBlocks),
      chakra: chakraLine,
    }),
    flags: buildLearnAttemptCardFlags(item, actor, { result, baseLearning, chakraDeduction, now }),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Action Point — post-roll commitment via the learn chat card context menu
// ─────────────────────────────────────────────────────────────────────────

function resolveMessageFromElement(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.closest?.("[data-message-id]")?.dataset?.messageId;
  return id ? game.messages.get(id) : null;
}

function getLearnCardContext(message) {
  const flags = message?.getFlag?.(MODULE_ID, "learn");
  if (!flags) return null;
  const actor = fromUuidSync(flags.actorUuid);
  if (!(actor instanceof Actor)) return null;
  const item = actor.items.get(flags.itemId);
  if (!item) return null;
  return { flags, actor, item };
}

/** A learn card may offer "Add Action Point" only while it reflects the current,
 *  still-open run, no AP is committed yet, and the owner has an Action Point. */
function learnCardCanAddAp(message) {
  const ctx = getLearnCardContext(message);
  if (!ctx) return false;
  const { flags, actor, item } = ctx;
  if (!actor.isOwner) return false;

  const learning = item.system.learning ?? {};
  if (learning.learned) return false;
  if ((Number(learning.actionPointBonus ?? 0) || 0) > 0) return false;

  // Freshness: a newer learn roll would have moved these on — don't clobber it.
  const res = flags.result ?? {};
  if ((Number(learning.progress ?? 0) || 0) !== (Number(res.progress ?? 0) || 0)) return false;
  if ((Number(learning.attemptsUsed ?? 0) || 0) !== (Number(res.attemptsUsed ?? 0) || 0))
    return false;
  if ((Number(learning.failureInsight ?? 0) || 0) !== (Number(res.failureInsight ?? 0) || 0))
    return false;
  if ((Number(learning.lastTrainingAt ?? 0) || 0) !== (Number(res.lastTrainingAt ?? 0) || 0))
    return false;

  return (Number(foundry.utils.getProperty(actor, actionPointsPath) ?? 0) || 0) >= 1;
}

/** Spend one Action Point: roll 1d6 once, re-evaluate the carded attempt with the
 *  boosted total, and persist the value so the rest of the run reuses it. */
export async function addActionPointToLearnCard(message) {
  const ctx = getLearnCardContext(message);
  if (!ctx) return;
  const { flags, actor, item } = ctx;

  if (!learnCardCanAddAp(message)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.CannotAddActionPoint", { name: item.name }),
    );
    return;
  }

  const currentAp = Number(foundry.utils.getProperty(actor, actionPointsPath) ?? 0) || 0;
  if (currentAp < 1) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoActionPoints", { actor: actor.name }),
    );
    return;
  }

  const apRoll = new Roll("1d6");
  await apRoll.evaluate();
  const apBonus = Math.max(0, Number(apRoll.total) || 0);
  await apRoll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format("NarutoD20.Cards.Learn.ActionPointFlavor", {
      name: item.name,
      from: currentAp,
      to: currentAp - 1,
    }),
    rollMode: game.settings.get("core", "rollMode"),
  });

  // Refund the superseded attempt's training chakra (no-op when none was deducted),
  // then spend the Action Point — all in one actor update.
  const update = { [actionPointsPath]: currentAp - 1 };
  const fromPool = Number(flags.deducted?.fromPool ?? 0) || 0;
  const fromReserve = Number(flags.deducted?.fromReserve ?? 0) || 0;
  if (fromPool) {
    update[chakraPoolValuePath] =
      (Number(foundry.utils.getProperty(actor, chakraPoolValuePath) ?? 0) || 0) + fromPool;
  }
  if (fromReserve) {
    update[chakraReserveValuePath] =
      (Number(foundry.utils.getProperty(actor, chakraReserveValuePath) ?? 0) || 0) + fromReserve;
  }
  await actor.update(update);

  await resolveLearnAttempt(item, actor, {
    skillKey: flags.skillKey,
    mode: flags.mode,
    baseLearning: flags.baseLearning,
    total: (Number(flags.baseTotalNoAp) || 0) + apBonus,
    apBonus,
    supersedes: message,
    apRollText: game.i18n.format("NarutoD20.Cards.Learn.ActionPointRollText", { value: apBonus }),
  });
}

/** Register the "Add Action Point" entry on the learn chat card's right-click menu.
 *  Mirrors PF1e by binding both the v12 and v13 hook names. */
export function registerLearnCardContextMenu() {
  const addOption = (_html, options) => {
    options.push({
      name: "Add Action Point",
      icon: '<i class="fa-solid fa-bolt"></i>',
      condition: (li) => learnCardCanAddAp(resolveMessageFromElement(li)),
      callback: (li) => addActionPointToLearnCard(resolveMessageFromElement(li)),
    });
  };
  Hooks.on("getChatLogEntryContext", addOption);
  Hooks.on("getChatMessageContextOptions", addOption);
}
