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
import { applyChatVisibility } from "../chat-visibility.mjs";
import {
  buildActionPointContent,
  buildActionPointFlags,
  registerNarutoRerollHandler,
} from "../chat-rerolls.mjs";
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

// ── Progression block (appended onto the roll card) ──────────────────────────

/** Sentinel class so re-appending the block onto a message is idempotent. */
const PROGRESSION_BLOCK_CLASS = "naruto-learn-progression";

/**
 * Render the progression result as PF1e-style property groups (`item-notes.hbs`)
 * to be appended onto the roll card's content — mirroring how native skill
 * checks render footnotes/info. `lead` becomes the "Info" group; `footer` is
 * split into a "Training" group of tags. Wrapped in a sentinel container.
 *
 * The attempt title is intentionally omitted: it duplicates the roll card's own
 * flavor ("Learn: <name>" / "Master: <name>") already shown above the block.
 */
export async function renderProgressionBlock({ lead = "", footer = "", cssClass = "" }) {
  const groups = [];

  if (lead) {
    groups.push(
      await foundry.applications.handlebars.renderTemplate(
        "systems/pf1/templates/chat/parts/item-notes.hbs",
        {
          header: game.i18n.localize("PF1.InfoShort"),
          notes: [{ text: lead }],
          css: "info-properties",
          cssExtra: "general-notes",
        },
      ),
    );
  }

  const footerTags = String(footer)
    .split(/;\s*/)
    .map((part) => part.trim().replace(/\.$/, "").trim())
    .filter(Boolean)
    .map((text) => ({ text }));
  if (footerTags.length) {
    groups.push(
      await foundry.applications.handlebars.renderTemplate(
        "systems/pf1/templates/chat/parts/item-notes.hbs",
        {
          header: game.i18n.localize("NarutoD20.Cards.TrainingHeader"),
          notes: footerTags,
          css: "training-properties",
          cssExtra: "general-notes",
        },
      ),
    );
  }

  return `<div class="${PROGRESSION_BLOCK_CLASS} ${cssClass}">${groups.join("")}</div>`;
}

/**
 * Append `blockHtml` onto a message's existing content, first stripping any
 * previously appended progression block so repeated updates stay idempotent.
 */
export function spliceProgressionBlock(currentContent, blockHtml) {
  const content = String(currentContent ?? "").replace(
    new RegExp(`<div class="${PROGRESSION_BLOCK_CLASS}[\\s\\S]*$`),
    "",
  );
  return `${content}${blockHtml}`;
}

// ── Chat card ───────────────────────────────────────────────────────────────

/**
 * Post a standalone progression chat card (shared template), used by flows with
 * no associated roll (Empathy learning, unmapped technique, interrupted
 * training). Roll-driven attempts instead append a block onto the roll card.
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
  return ChatMessage.create(data);
}

/**
 * Build the reroll flags that let a still-open run re-evaluate (reroll or Action
 * Point) directly on the roll card. Returns null when the run has ended.
 */
export function buildProgressionRollRerollData(
  item,
  actor,
  { skillKey, mode, baseState, result, chakraDeduction, now },
) {
  if (result.runEnded) return null;

  return {
    progression: {
      itemId: item.id,
      skillKey,
      mode,
      baseState: foundry.utils.deepClone(baseState),
      apBonus: Number(result.apBonus ?? 0) || 0,
      deducted: { fromTemp: chakraDeduction.fromTemp, fromPool: chakraDeduction.fromPool },
      result: {
        progress: result.progress,
        attemptsUsed: result.finalAttemptsUsed,
        failureInsight: result.nextFailureInsight,
        lastTrainingAt: now,
      },
    },
  };
}

// ── Action Point / reroll — post-roll commitment on the roll card ────────────

function getProgressionRollContext(flags, actor, config) {
  const progression = flags?.progression;
  if (!progression) return null;

  const item = actor.items.get(progression.itemId);
  if (!item) return null;

  return { progression, actor, item, state: config.getState(item) };
}

function progressionRollCanReroll(_message, ctx, config) {
  if (!ctx?.actor?.isOwner) return false;

  const rollCtx = getProgressionRollContext(ctx.flags, ctx.actor, config);
  if (!rollCtx) return false;

  const { progression, state } = rollCtx;
  if (config.isClosed?.(state)) return false;

  const res = progression.result ?? {};
  if ((Number(state.progress ?? 0) || 0) !== (Number(res.progress ?? 0) || 0)) return false;
  if ((Number(state.attemptsUsed ?? 0) || 0) !== (Number(res.attemptsUsed ?? 0) || 0)) return false;
  if ((Number(state.failureInsight ?? 0) || 0) !== (Number(res.failureInsight ?? 0) || 0))
    return false;
  if ((Number(state.lastTrainingAt ?? 0) || 0) !== (Number(res.lastTrainingAt ?? 0) || 0))
    return false;
  if ((Number(state.actionPointBonus ?? 0) || 0) !== (Number(progression.apBonus ?? 0) || 0))
    return false;

  return true;
}

function buildProgressionDeductionRefund(actor, deducted) {
  const update = {};
  const fromTemp = Number(deducted?.fromTemp ?? 0) || 0;
  const fromPool = Number(deducted?.fromPool ?? 0) || 0;
  if (fromTemp) {
    update[chakraPoolTempPath] =
      (Number(foundry.utils.getProperty(actor, chakraPoolTempPath) ?? 0) || 0) + fromTemp;
  }
  if (fromPool) {
    update[chakraPoolValuePath] =
      (Number(foundry.utils.getProperty(actor, chakraPoolValuePath) ?? 0) || 0) + fromPool;
  }
  return update;
}

async function refundProgressionDeduction(actor, deducted) {
  const update = buildProgressionDeductionRefund(actor, deducted);
  if (!foundry.utils.isEmpty(update)) await actor.update(update);
}

async function applyProgressionRollReroll(message, ctx, { keptRoll, baseContent }, config) {
  const rollCtx = getProgressionRollContext(ctx.flags, ctx.actor, config);
  if (!rollCtx || !progressionRollCanReroll(message, ctx, config)) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Reroll.CannotReroll"));
    return false;
  }

  const { progression, actor, item } = rollCtx;
  await refundProgressionDeduction(actor, progression.deducted);

  // Re-resolve the attempt and return the reroll comparison block plus the fresh
  // progression block as the message's final content (single card, no extra message).
  const outcome = await config.resolveAttempt(item, actor, {
    skillKey: progression.skillKey,
    mode: progression.mode,
    baseState: progression.baseState,
    total: Number(keptRoll.total) || 0,
    apBonus: Number(progression.apBonus ?? 0) || 0,
    returnBlock: true,
  });
  if (!outcome) return false;

  return `${baseContent}${outcome.html}`;
}

function progressionRollCanAddAp(message, ctx, config) {
  if (!progressionRollCanReroll(message, ctx, config)) return false;

  const rollCtx = getProgressionRollContext(ctx.flags, ctx.actor, config);
  if (!rollCtx) return false;

  const apBonus = Number(rollCtx.progression.apBonus ?? 0) || 0;
  const stateApBonus = Number(rollCtx.state.actionPointBonus ?? 0) || 0;
  if (apBonus > 0 || stateApBonus > 0) return false;

  return (Number(foundry.utils.getProperty(ctx.actor, config.actionPointsPath) ?? 0) || 0) >= 1;
}

async function addActionPointToProgressionRoll(message, ctx, config) {
  if (!progressionRollCanAddAp(message, ctx, config)) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Reroll.CannotAddActionPoint"));
    return;
  }

  const rollCtx = getProgressionRollContext(ctx.flags, ctx.actor, config);
  const { progression, actor, item } = rollCtx;
  const currentAp = Number(foundry.utils.getProperty(actor, config.actionPointsPath) ?? 0) || 0;
  if (currentAp < 1) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoActionPoints", { actor: actor.name }),
    );
    return;
  }

  const oldRoll = message.rolls?.[0];
  if (!oldRoll) return;

  const apRoll = new Roll("1d6");
  await apRoll.evaluate({ allowInteractive: false });
  const apBonus = Math.max(0, Number(apRoll.total) || 0);
  const total = (Number(oldRoll.total) || 0) + apBonus;

  const update = buildProgressionDeductionRefund(actor, progression.deducted);
  update[config.actionPointsPath] = currentAp - 1;
  await actor.update(update);

  // Re-resolve with the boosted total, then write the AP comparison block plus
  // the fresh progression block onto the same card in a single update.
  const outcome = await config.resolveAttempt(item, actor, {
    skillKey: progression.skillKey,
    mode: progression.mode,
    baseState: progression.baseState,
    total,
    apBonus,
    apRollText: game.i18n.format(config.apRollTextKey, { value: apBonus }),
    returnBlock: true,
  });

  const apContent = await buildActionPointContent({ oldRoll, apRoll, apBonus, total });
  await message.update({
    content: outcome ? `${apContent}${outcome.html}` : apContent,
    rolls: [oldRoll, apRoll],
    flags: buildActionPointFlags(message, apBonus),
  });
}

export function registerProgressionRollReroll(source, config) {
  registerNarutoRerollHandler(source, {
    canAlter: (message, ctx) => progressionRollCanReroll(message, ctx, config),
    canAddActionPoint: (message, ctx) => progressionRollCanAddAp(message, ctx, config),
    addActionPoint: (message, ctx) => addActionPointToProgressionRoll(message, ctx, config),
    applyReroll: (message, ctx, data) => applyProgressionRollReroll(message, ctx, data, config),
  });
}
