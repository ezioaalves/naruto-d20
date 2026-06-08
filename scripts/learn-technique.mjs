import { TECHNIQUE_ITEM_TYPE } from "./constants.mjs";
import { actionPointsPath, epsPath, learningCurrentTechniqueIdPath } from "./flag-paths.mjs";
import { chatVisibilityFrom } from "./chat-visibility.mjs";
import { markNarutoRollRerollable } from "./chat-rerolls.mjs";
import { normalizeActionIds } from "./data/action-ids.mjs";
import { buildLearnCheckBreakdown } from "./data/bonus-sources.mjs";
import {
  canonicalizeDisciplineName,
  DISCIPLINE_LABEL_KEYS,
  DISCIPLINE_SKILL_MAP,
  LEARN_DISCIPLINES,
} from "./data/skills.mjs";
import {
  PROGRESSION_MODES,
  applyTrainingChakraDeduction,
  blockUnit,
  buildProgressionRollRerollData,
  canPayTrainingChakra,
  characterLevel,
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
} from "./data/training-progression.mjs";

// Back-compat re-exports: external call sites and the mastery flow reuse these.
export { getMaxAttempts as getLearningMaxAttempts };
export const LEARNING_MODES = PROGRESSION_MODES;

const TRAINING_SUBTYPE_SEPARATOR_RE = /\s*(?:,|\/|\bor\b)\s*/i;

/** Learn-flow Action-Point card config for the shared progression engine. */
const LEARN_CARD_CONFIG = {
  flagKey: "learn",
  actionPointsPath,
  apRollTextKey: "NarutoD20.Cards.Learn.ActionPointRollText",
  getState: (item) => item.system.learning ?? {},
  isClosed: (state) => state.learned === true,
  resolveAttempt: (item, actor, opts) => resolveLearnAttempt(item, actor, opts),
};
const LEARN_REROLL_SOURCE = "learn-attempt";

function postLearningCard(actor, item, opts) {
  return postProgressionCard(actor, item, { ...opts, flagKey: "learn" });
}

/**
 * Rules-derived target progress for a mode, ignoring any GM override.
 * Standard → raw successes; four-hour blocks → rank × successes × 2.
 */
function getDerivedTargetProgress(item, mode = getTrainingMode()) {
  const successes = Math.max(1, Number(item.system.derived?.successes ?? 1) || 1);
  if (mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS) {
    const rank = Math.max(1, Number(item.system.rank ?? 1) || 1);
    return rank * successes * 2;
  }
  return successes;
}

/**
 * Target progress required to learn. A GM override (stored as the final
 * target in the *current* mode's units) wins; otherwise it is derived from
 * the rules and scales with the training mode.
 */
export function getLearningTargetProgress(item, mode = getTrainingMode()) {
  const override = Number(item.system.learning?.successesOverride);
  if (Number.isFinite(override) && override > 0) return Math.max(1, Math.floor(override));
  return getDerivedTargetProgress(item, mode);
}

function localizeDiscipline(discipline) {
  const key = DISCIPLINE_LABEL_KEYS[discipline];
  return key ? game.i18n.localize(key) : discipline;
}

function parseTrainingSubtypeOptions(subtype) {
  const text = String(subtype ?? "").trim();
  if (!text) return [];

  const seen = new Set();
  const options = [];
  for (const part of text.split(TRAINING_SUBTYPE_SEPARATOR_RE)) {
    const discipline = canonicalizeDisciplineName(part);
    if (!discipline || !DISCIPLINE_SKILL_MAP[discipline] || seen.has(discipline)) continue;
    seen.add(discipline);
    options.push(discipline);
  }
  return options;
}

function getTrainingDisciplineOptions(item) {
  const options = parseTrainingSubtypeOptions(item.system?.subtype);
  return options.length ? options : [...LEARN_DISCIPLINES];
}

export function getTechniqueLearningResolution(item) {
  const discipline = item.system?.discipline ?? "";
  if (discipline !== "Training") {
    const skillKey = DISCIPLINE_SKILL_MAP[discipline];
    return {
      discipline,
      skillKey,
      options: skillKey ? [discipline] : [],
      requiresChoice: false,
    };
  }

  const options = getTrainingDisciplineOptions(item);
  const stored = canonicalizeDisciplineName(item.system?.learning?.selectedDiscipline);
  if (stored && options.includes(stored)) {
    return {
      discipline: stored,
      skillKey: DISCIPLINE_SKILL_MAP[stored],
      options,
      requiresChoice: false,
    };
  }

  if (options.length === 1) {
    const resolved = options[0];
    return {
      discipline: resolved,
      skillKey: DISCIPLINE_SKILL_MAP[resolved],
      options,
      requiresChoice: false,
    };
  }

  return {
    discipline: null,
    skillKey: null,
    options,
    requiresChoice: true,
  };
}

async function promptTrainingDisciplineChoice(item, options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const selected = options[0] ?? "";
    const content = `
      <form class="naruto-training-discipline-choice">
        <p>${game.i18n.localize("NarutoD20.Cards.Learn.TrainingDisciplinePrompt")}</p>
        ${options
          .map(
            (discipline, index) => `
              <label class="checkbox">
                <input type="radio" name="training-discipline" value="${discipline}" ${index === 0 ? "checked" : ""}>
                ${localizeDiscipline(discipline)}
              </label>
            `,
          )
          .join("")}
      </form>
    `;

    new Dialog({
      title: game.i18n.format("NarutoD20.App.ChooseLearnDiscipline", { name: item.name }),
      content,
      buttons: {
        roll: {
          label: game.i18n.localize("PF1.Roll"),
          callback: (html) => {
            const value =
              html.find("input[name='training-discipline']:checked").val() || selected || null;
            finish(canonicalizeDisciplineName(value));
          },
        },
        cancel: {
          label: game.i18n.localize("Cancel"),
          callback: () => finish(null),
        },
      },
      default: "roll",
      close: () => finish(null),
    }).render(true);
  });
}

export async function resolveTechniqueLearningSkill(item) {
  const resolution = getTechniqueLearningResolution(item);
  if (!resolution.requiresChoice) return resolution;

  const chosen = await promptTrainingDisciplineChoice(item, resolution.options);
  if (!chosen) return null;

  await item.update({ "system.learning.selectedDiscipline": chosen });
  return {
    discipline: chosen,
    skillKey: DISCIPLINE_SKILL_MAP[chosen],
    options: resolution.options,
    requiresChoice: false,
  };
}

export function isTechniqueEffectivelyLearned(item) {
  const learning = item.system.learning ?? {};
  const resolution = getTechniqueLearningResolution(item);
  return learning.learned === true || (!resolution.requiresChoice && !resolution.skillKey);
}

export function buildLearningView(item, actor, mode = getTrainingMode()) {
  const learning = item.system.learning ?? {};
  const resolution = getTechniqueLearningResolution(item);
  const skillKey = resolution.skillKey;
  const targetProgress = getLearningTargetProgress(item, mode);
  const progress = Math.min(Number(learning.progress ?? 0) || 0, targetProgress);
  const attemptsUsed = Number(learning.attemptsUsed ?? 0) || 0;
  const failureInsight = Number(learning.failureInsight ?? 0) || 0;
  const trainingBlocks = Number(learning.trainingBlocks ?? 0) || 0;
  const chakraSpent = Number(learning.chakraSpent ?? 0) || 0;
  const lastTrainingAt = Number(learning.lastTrainingAt ?? 0) || 0;

  return {
    learned: learning.learned === true,
    learnedViaEmpathy: learning.learnedViaEmpathy === true,
    effectivelyLearned: learning.learned === true || (!resolution.requiresChoice && !skillKey),
    progress,
    attemptsUsed,
    failureInsight,
    trainingBlocks,
    chakraSpent,
    lastTrainingAt,
    actionPointBonus: Number(learning.actionPointBonus ?? 0) || 0,
    selectedDiscipline: resolution.discipline,
    selectedDisciplineLabel: resolution.discipline ? localizeDiscipline(resolution.discipline) : "",
    requiresDisciplineChoice: resolution.requiresChoice,
    expiresAt: lastTrainingAt ? lastTrainingAt + 30 * 24 * 60 * 60 : 0,
    targetProgress,
    requiredSuccesses: targetProgress,
    derivedSuccesses: getDerivedTargetProgress(item, mode),
    successesOverride: learning.successesOverride ?? null,
    maxAttempts: getMaxAttempts(actor, skillKey),
    mode,
    isFourHourBlocks: mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS,
    hasSkill: !!skillKey || resolution.requiresChoice,
  };
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
  if (!lastTrainingAt || now - lastTrainingAt <= 30 * 24 * 60 * 60) {
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

  const learningSkill = await resolveTechniqueLearningSkill(item);
  if (!learningSkill) return;

  const { skillKey } = learningSkill;
  if (!skillKey) {
    await learnUnmappedTechnique(item, actor, learning);
    return;
  }

  const mode = getTrainingMode();
  if (!validateLearningSkillAndChakra(item, actor, skillKey, mode)) return;

  const activeLearning = await prepareActiveLearning(actor, item, learning);
  const roll = await rollLearnCheck(item, actor, skillKey, activeLearning);
  if (!roll) return;

  await resolveLearnAttempt(item, actor, {
    skillKey,
    mode,
    baseState: activeLearning,
    total: roll.total,
    apBonus: roll.apBonus,
    rollMessage: roll.message,
  });
}

/**
 * Learn a technique by spending Empathy Points instead of training.
 *
 * Copies `srcItem` onto `actor`, flags it as learned (via Empathy), and deducts
 * a number of Empathy Points equal to the technique's skill threshold. Used by
 * the Empathy-mode technique browser opened from the Chakra tab.
 */
export async function learnTechniqueViaEmpathy(actor, srcItem) {
  if (!actor?.isOwner) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoPermissionUpdate", { actor: actor?.name ?? "" }),
    );
    return;
  }
  if (!srcItem || srcItem.type !== TECHNIQUE_ITEM_TYPE) return;

  const existing = actor.items.find(
    (i) => i.type === TECHNIQUE_ITEM_TYPE && i.name === srcItem.name,
  );
  if (existing) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.AlreadyOwnedTechnique", {
        actor: actor.name,
        name: srcItem.name,
      }),
    );
    return;
  }

  const threshold = Math.max(0, Number(srcItem.system?.derived?.skillThreshold ?? 0) || 0);
  const currentEps = Number(foundry.utils.getProperty(actor, epsPath) ?? 0) || 0;
  if (currentEps < threshold) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NotEnoughEmpathy", {
        actor: actor.name,
        name: srcItem.name,
        cost: threshold,
        have: currentEps,
      }),
    );
    return;
  }

  const itemData = srcItem.toObject();
  const { actions, changed } = normalizeActionIds(itemData.system?.actions);
  if (changed) itemData.system.actions = actions;
  itemData.system.learning = {
    ...(itemData.system.learning ?? {}),
    learned: true,
    learnedViaEmpathy: true,
    progress: getLearningTargetProgress(srcItem),
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
  const remaining = currentEps - threshold;
  await actor.update({ [epsPath]: remaining });

  await postLearningCard(actor, created ?? srcItem, {
    title: game.i18n.format("NarutoD20.Cards.Learn.LearnedViaEmpathyTitle", { name: srcItem.name }),
    cssClass: "success",
    lead: game.i18n.format("NarutoD20.Cards.Learn.EmpathyLead", {
      cost: threshold,
      remaining,
    }),
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

  return { total, apBonus, rollVisibility: chatVisibilityFrom(result), message: result };
}

/**
 * Resolve one learn attempt from a *pre-attempt* learning snapshot and a total.
 * Extracted so the post-roll reroll / "Add Action Point" flows can replay the
 * same attempt with a different total. `apBonus` is the committed Action Point
 * value (0 = none), persisted to `actionPointBonus` so later rolls of the run
 * reuse it.
 *
 * Always returns `{ html, result }` (the rendered progression block). On the
 * initial roll (`rollMessage` given, `returnBlock` falsey) it also appends the
 * block onto the roll card and marks it rerollable, so a single card carries
 * both the roll and the progression info. The reroll / AP handlers pass
 * `returnBlock: true` and splice the block into their own message update.
 */
async function resolveLearnAttempt(
  item,
  actor,
  { skillKey, mode, baseState, total, apBonus = 0, apRollText = "", rollMessage = null, returnBlock = false },
) {
  const result = buildLearnAttemptResult(item, actor, {
    skillKey,
    mode,
    baseLearning: baseState,
    total,
    apBonus,
  });
  const chakraDeduction = await applyTrainingChakraDeduction(actor, result.chakraCost);
  if (!chakraDeduction.paid) return null;

  const now = trainingTimestamp();
  await persistLearnAttemptResult(item, actor, result, now);

  const html = await renderProgressionBlock(
    buildLearnAttemptCardParts(item, { result, chakraDeduction, apRollText }),
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
      await markNarutoRollRerollable(rollMessage, actor, LEARN_REROLL_SOURCE, rerollData);
    }
  }

  return { html, result };
}

export function buildLearnAttemptResult(
  item,
  actor,
  { skillKey, mode, baseLearning, total, apBonus },
) {
  const learnDC = Number(item.system.derived?.learnDC ?? 10) || 10;
  const targetProgress = getLearningTargetProgress(item, mode);
  const maxAttempts = getMaxAttempts(actor, skillKey);
  const oldProgress = Number(baseLearning.progress ?? 0) || 0;
  const oldAttempts = Number(baseLearning.attemptsUsed ?? 0) || 0;
  const baseFailureInsight = Math.min(
    5,
    Math.max(0, Number(baseLearning.failureInsight ?? 0) || 0),
  );
  const attemptsUsed = oldAttempts + 1;
  const success = total >= learnDC;
  const margin = total - learnDC;
  const trainingBlocks = trainingBlocksForRoll(item.system.rank, mode, margin);
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

  if (!learned && mode === PROGRESSION_MODES.STANDARD && attemptsUsed >= maxAttempts) {
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

/** Build the title/lead/footer/cssClass for a learn attempt's progression block. */
function buildLearnAttemptCardParts(item, { result, chakraDeduction, apRollText }) {
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
    return {
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
    };
  }

  if (result.resetRun) {
    return {
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
    };
  }

  const attemptText =
    result.mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS
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

  return {
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
  };
}

/** Register the reroll / "Add Action Point" handlers on the learn roll card. */
export function registerLearnCardContextMenu() {
  registerProgressionRollReroll(LEARN_REROLL_SOURCE, LEARN_CARD_CONFIG);
}
