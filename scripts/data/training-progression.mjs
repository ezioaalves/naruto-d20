/**
 * Naruto D20 — Shared training-progression engine
 *
 * Behavior-neutral primitives shared by the technique *learning* flow
 * (`learn-technique.mjs`) and the *mastery* flow (`master-technique.mjs`).
 * Both flows roll learn checks, count successes toward a target, and track
 * attempts / failure insight / training time (blocks) / training chakra, with
 * the same four-hour-blocks scaling, interruption window, exceptional
 * success/failure margins, and post-roll Action Point re-evaluation.
 *
 * Only the genuinely shared math/IO lives here; each flow keeps its own
 * orchestration (gating, persistence, chat-card wording).
 */

import { MODULE_ID } from "../constants.mjs";
import { chakraPoolTempPath, chakraPoolValuePath } from "../flag-paths.mjs";
import { applyChatVisibility, chatVisibilityFrom } from "../chat-visibility.mjs";
import { resolveSkillAbility } from "./skills.mjs";

export const PROGRESSION_MODES = Object.freeze({
  STANDARD: "standard",
  FOUR_HOUR_BLOCKS: "fourHourBlocks",
});

export const TRAINING_INTERRUPTION_SECONDS = 30 * 24 * 60 * 60;

export function getTrainingMode() {
  return game.settings.get(MODULE_ID, "learningProgressionMode") || PROGRESSION_MODES.STANDARD;
}

export function trainingTimestamp() {
  const worldTime = Number(game.time?.worldTime ?? 0) || 0;
  return worldTime > 0 ? worldTime : Math.floor(Date.now() / 1000);
}

export function characterLevel(actor) {
  return Number(actor.system.details?.level?.value ?? actor.system.details?.cr?.total ?? 0) || 0;
}

export function blockUnit(count) {
  return game.i18n.localize(count === 1 ? "NarutoD20.Cards.Block" : "NarutoD20.Cards.Blocks");
}

export function rollTotal(result) {
  return result?.rolls?.[0]?.total ?? result?.roll?.total ?? result?.total ?? null;
}

/** Attempts available for a run: 1 + ability mod + 1 per 2 ranks of the skill. */
export function getMaxAttempts(actor, skillKey) {
  if (!actor || !skillKey) return null;
  const ability = resolveSkillAbility(actor, skillKey);
  const abilityMod = Number(actor.system.abilities?.[ability]?.mod ?? 0) || 0;
  const ranks = Number(actor.system.skills?.[skillKey]?.rank ?? 0) || 0;
  return Math.max(1, 1 + abilityMod + Math.floor(ranks / 2));
}

// ── Exceptional success/failure margins ─────────────────────────────────────

export function marginAward(margin, mode) {
  if (mode === PROGRESSION_MODES.STANDARD) return 1;
  if (margin >= 15) return 4;
  const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
  return inclusive ? (margin >= 5 ? 2 : 1) : margin > 5 ? 2 : 1;
}

export function clearsFiveBoundary(margin) {
  const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
  return inclusive ? margin >= 5 : margin > 5;
}

export function failsFiveBoundary(margin) {
  const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
  return inclusive ? margin <= -5 : margin < -5;
}

// ── Training time (blocks) ──────────────────────────────────────────────────

export function trainingBlocksForRoll(rank, mode, margin) {
  if (mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS) return 1;

  const safeRank = Math.max(1, Number(rank) || 1);
  const baseBlocks = safeRank * 2;
  if (margin >= 15) return Math.max(1, Math.ceil(baseBlocks * 0.25));
  if (clearsFiveBoundary(margin)) return Math.max(1, Math.ceil(baseBlocks * 0.5));
  if (failsFiveBoundary(margin)) return Math.max(1, Math.ceil(baseBlocks * 1.5));
  return baseBlocks;
}

export function minimumTrainingBlocksForRoll(rank, mode) {
  if (mode === PROGRESSION_MODES.FOUR_HOUR_BLOCKS) return 1;

  const safeRank = Math.max(1, Number(rank) || 1);
  return Math.max(1, Math.ceil(safeRank * 2 * 0.25));
}

// ── Training chakra ─────────────────────────────────────────────────────────

export function trainingChakraCost(actor, blocks) {
  const poolMax = Number(actor.flags?.[MODULE_ID]?.chakra?.pool?.max ?? 0) || 0;
  return Math.max(0, Math.ceil(poolMax * 0.4 * blocks));
}

export function availableTrainingChakra(actor) {
  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  const tempValue = Math.max(0, Number(chakra.pool?.temp ?? 0) || 0);
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);
  return tempValue + poolValue;
}

export function warnInsufficientTrainingChakra(
  actor,
  amount,
  available = availableTrainingChakra(actor),
) {
  ui.notifications.warn(
    game.i18n.format("NarutoD20.Notifications.TrainingChakraRequired", {
      actor: actor.name,
      amount,
      available,
    }),
  );
}

export function canPayTrainingChakra(actor, amount) {
  if (!game.settings.get(MODULE_ID, "deductLearningChakra") || amount <= 0) return true;
  return availableTrainingChakra(actor) >= amount;
}

export async function applyTrainingChakraDeduction(actor, amount) {
  if (!game.settings.get(MODULE_ID, "deductLearningChakra") || amount <= 0) {
    return { paid: true, deducted: 0, fromTemp: 0, fromPool: 0 };
  }

  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  const tempValue = Math.max(0, Number(chakra.pool?.temp ?? 0) || 0);
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);
  const available = tempValue + poolValue;
  if (available < amount) {
    warnInsufficientTrainingChakra(actor, amount, available);
    return { paid: false, deducted: 0, fromTemp: 0, fromPool: 0 };
  }

  const fromTemp = Math.min(amount, tempValue);
  const fromPool = Math.min(amount - fromTemp, poolValue);
  const deducted = fromTemp + fromPool;

  await actor.update({
    [chakraPoolTempPath]: tempValue - fromTemp,
    [chakraPoolValuePath]: poolValue - fromPool,
  });

  return { paid: true, deducted, fromTemp, fromPool };
}

// ── Chat card ───────────────────────────────────────────────────────────────

/**
 * Post a progression chat card (shared template). `flagKey` namespaces the
 * card flags so each flow's Action-Point context menu only sees its own cards.
 */
export async function postProgressionCard(
  actor,
  item,
  {
    title,
    lead = "",
    footer = "",
    cssClass = "",
    flagKey = "learn",
    flags = null,
    visibility = null,
  },
) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/learning-result.hbs`,
    { title, lead, footer, cssClass },
  );
  const data = applyChatVisibility(
    {
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
    },
    visibility,
  );
  if (flags) data.flags = { [MODULE_ID]: { [flagKey]: flags } };
  await ChatMessage.create(data);
}

/**
 * Build the card flags that let a still-open run re-evaluate with an Action
 * Point. Returns null when the run has ended or an AP is already committed.
 */
export function buildProgressionCardFlags(
  item,
  actor,
  { skillKey, mode, baseState, result, chakraDeduction, now },
) {
  if (result.runEnded || result.apBonus !== 0) return null;

  return {
    itemId: item.id,
    actorUuid: actor.uuid,
    skillKey,
    mode,
    baseState: foundry.utils.deepClone(baseState),
    baseTotalNoAp: result.total,
    deducted: { fromTemp: chakraDeduction.fromTemp, fromPool: chakraDeduction.fromPool },
    result: {
      progress: result.progress,
      attemptsUsed: result.finalAttemptsUsed,
      failureInsight: result.nextFailureInsight,
      lastTrainingAt: now,
    },
  };
}

// ── Action Point — post-roll commitment via the chat card context menu ───────

function resolveMessageFromElement(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.closest?.("[data-message-id]")?.dataset?.messageId;
  return id ? game.messages.get(id) : null;
}

function getProgressionCardContext(message, config) {
  const flags = message?.getFlag?.(MODULE_ID, config.flagKey);
  if (!flags) return null;
  const actor = fromUuidSync(flags.actorUuid);
  if (!(actor instanceof Actor)) return null;
  const item = actor.items.get(flags.itemId);
  if (!item) return null;
  return { flags, actor, item };
}

/** A card may offer "Add Action Point" only while it reflects the current,
 *  still-open run, no AP is committed yet, and the owner has an Action Point. */
export function progressionCardCanAddAp(message, config) {
  const ctx = getProgressionCardContext(message, config);
  if (!ctx) return false;
  const { flags, actor, item } = ctx;
  if (!actor.isOwner) return false;

  const state = config.getState(item);
  if (config.isClosed?.(state)) return false;
  if ((Number(state.actionPointBonus ?? 0) || 0) > 0) return false;

  // Freshness: a newer roll would have moved these on — don't clobber it.
  const res = flags.result ?? {};
  if ((Number(state.progress ?? 0) || 0) !== (Number(res.progress ?? 0) || 0)) return false;
  if ((Number(state.attemptsUsed ?? 0) || 0) !== (Number(res.attemptsUsed ?? 0) || 0)) return false;
  if ((Number(state.failureInsight ?? 0) || 0) !== (Number(res.failureInsight ?? 0) || 0))
    return false;
  if ((Number(state.lastTrainingAt ?? 0) || 0) !== (Number(res.lastTrainingAt ?? 0) || 0))
    return false;

  return (Number(foundry.utils.getProperty(actor, config.actionPointsPath) ?? 0) || 0) >= 1;
}

/** Spend one Action Point: roll 1d6 once, re-evaluate the carded attempt with
 *  the boosted total, and persist the value so the rest of the run reuses it. */
export async function addActionPointToProgressionCard(message, config) {
  const ctx = getProgressionCardContext(message, config);
  if (!ctx) return;
  const { flags, actor, item } = ctx;

  if (!progressionCardCanAddAp(message, config)) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.CannotAddActionPoint", { name: item.name }),
    );
    return;
  }

  const currentAp = Number(foundry.utils.getProperty(actor, config.actionPointsPath) ?? 0) || 0;
  if (currentAp < 1) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoActionPoints", { actor: actor.name }),
    );
    return;
  }

  const apRoll = new Roll("1d6");
  await apRoll.evaluate();
  const apBonus = Math.max(0, Number(apRoll.total) || 0);
  const visibility = chatVisibilityFrom(message);
  await apRoll.toMessage(
    applyChatVisibility(
      {
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        flavor: game.i18n.format(config.apFlavorKey, {
          name: item.name,
          from: currentAp,
          to: currentAp - 1,
        }),
      },
      visibility,
    ),
  );

  // Refund the superseded attempt's training chakra (no-op when none was deducted),
  // then spend the Action Point — all in one actor update.
  const update = { [config.actionPointsPath]: currentAp - 1 };
  const fromTemp = Number(flags.deducted?.fromTemp ?? 0) || 0;
  const fromPool = Number(flags.deducted?.fromPool ?? 0) || 0;
  if (fromTemp) {
    update[chakraPoolTempPath] =
      (Number(foundry.utils.getProperty(actor, chakraPoolTempPath) ?? 0) || 0) + fromTemp;
  }
  if (fromPool) {
    update[chakraPoolValuePath] =
      (Number(foundry.utils.getProperty(actor, chakraPoolValuePath) ?? 0) || 0) + fromPool;
  }
  await actor.update(update);

  await config.resolveAttempt(item, actor, {
    skillKey: flags.skillKey,
    mode: flags.mode,
    baseState: flags.baseState,
    total: (Number(flags.baseTotalNoAp) || 0) + apBonus,
    apBonus,
    supersedes: message,
    apRollText: game.i18n.format(config.apRollTextKey, { value: apBonus }),
    visibility,
  });
}

/** Register the "Add Action Point" entry on a flow's chat card right-click menu.
 *  Mirrors PF1e by binding both the v12 and v13 hook names. */
export function registerProgressionCardContextMenu(config) {
  const addOption = (_html, options) => {
    options.push({
      name: "Add Action Point",
      icon: '<i class="fa-solid fa-bolt"></i>',
      condition: (li) => progressionCardCanAddAp(resolveMessageFromElement(li), config),
      callback: (li) => addActionPointToProgressionCard(resolveMessageFromElement(li), config),
    });
  };
  Hooks.on("getChatLogEntryContext", addOption);
  Hooks.on("getChatMessageContextOptions", addOption);
}
