import { MODULE_ID } from "./constants.mjs";
import { actionPointsPath } from "./flag-paths.mjs";

const REROLL_FLAG = "reroll";
const REROLL_HANDLERS = new Map();

function resolveMessageFromElement(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.closest?.("[data-message-id]")?.dataset?.messageId;
  return id ? game.messages.get(id) : null;
}

function isMessageController(message, actor) {
  return !!message && !!actor && actor.isOwner && (message.isAuthor || message.isOwner || game.user.isGM);
}

function canSeeMessageContent(message) {
  if (!message) return false;
  if (typeof message.isContentVisible === "boolean") return message.isContentVisible;
  if (game.user.isGM) return true;

  const whisper = Array.from(message.whisper ?? []);
  if (!whisper.length) return true;
  return whisper.includes(game.user.id) || (message.isAuthor && !message.blind);
}

function getRerollContext(message) {
  const flags = message?.getFlag?.(MODULE_ID, REROLL_FLAG);
  if (!flags) return null;

  const actor = fromUuidSync(flags.actorUuid);
  if (!(actor instanceof Actor)) return null;

  return { flags, actor };
}

function getRerollHandler(flags) {
  return REROLL_HANDLERS.get(flags?.source ?? "") ?? null;
}

function getPrimaryD20Roll(message) {
  if (!message || message.rolls?.length !== 1) return null;

  const roll = message.rolls[0];
  const d20 = roll?.d20 ?? roll?.dice?.find((die) => Number(die.faces) === 20);
  if (!d20) return null;

  if (roll.isStatic || roll.isNonRoll || roll.isNormal === false) return null;
  const modifiers = Array.from(d20.modifiers ?? []);
  if (modifiers.some((modifier) => ["kh", "kl"].includes(modifier))) return null;

  return roll;
}

function canAlterNarutoRoll(message) {
  const ctx = getRerollContext(message);
  if (!ctx) return false;

  const { flags, actor } = ctx;
  if (!isMessageController(message, actor)) return false;
  if (!canSeeMessageContent(message)) return false;
  if (flags.isReroll || flags.actionPointApplied) return false;

  const handler = getRerollHandler(flags);
  if (handler?.canAlter && !handler.canAlter(message, ctx)) return false;

  return !!getPrimaryD20Roll(message);
}

function canAddActionPoint(message) {
  const ctx = getRerollContext(message);
  const handler = getRerollHandler(ctx?.flags);
  if (handler?.canAddActionPoint) return handler.canAddActionPoint(message, ctx);
  if (handler && !handler.canAddActionPoint) return false;

  if (!canAlterNarutoRoll(message)) return false;
  const { actor } = getRerollContext(message);
  return (Number(foundry.utils.getProperty(actor, actionPointsPath) ?? 0) || 0) >= 1;
}

function cloneForReroll(oldRoll) {
  const RollClass = oldRoll.constructor ?? Roll;
  const data = foundry.utils.deepClone(oldRoll.data ?? {});
  const options = foundry.utils.deepClone(oldRoll.options ?? {});
  const context = foundry.utils.deepClone(oldRoll.context ?? {});
  delete options.staticRoll;
  delete options.rollMode;
  return new RollClass(oldRoll.formula, data, options, context);
}

function renderSigned(value) {
  const number = Number(value) || 0;
  return number >= 0 ? `+${number}` : `${number}`;
}

async function renderRollBlock(roll, labelKey, cssClass = "") {
  return `
    <section class="naruto-reroll-entry ${cssClass}">
      <h4>${game.i18n.localize(labelKey)}</h4>
      ${await roll.render()}
    </section>
  `;
}

function buildFlags(message, patch = {}) {
  const systemFlags = foundry.utils.deepClone(message.getFlag(MODULE_ID, REROLL_FLAG) ?? {});
  return {
    [MODULE_ID]: {
      [REROLL_FLAG]: {
        ...systemFlags,
        ...patch,
      },
    },
  };
}

async function updateMessageWithReroll(message, { content, rolls, flags }) {
  await message.update({
    content,
    rolls,
    flags,
  });
}

export async function updateMessageWithActionPoint(message, { oldRoll, apRoll, apBonus, total }) {
  const content = `
    <div class="naruto-reroll-card">
      ${await renderRollBlock(oldRoll, "NarutoD20.Reroll.Original", "kept")}
      ${await renderRollBlock(apRoll, "NarutoD20.Reroll.ActionPointRoll", "kept")}
      <div class="naruto-reroll-summary">
        ${game.i18n.format("NarutoD20.Reroll.ActionPointTotal", {
          base: Math.round(Number(oldRoll.total) * 100) / 100,
          bonus: renderSigned(apBonus),
          total: Math.round(total * 100) / 100,
        })}
      </div>
    </div>
  `;

  await updateMessageWithReroll(message, {
    content,
    rolls: [oldRoll, apRoll],
    flags: buildFlags(message, { actionPointApplied: true, actionPointBonus: apBonus }),
  });
}

async function rerollMessage(message, options = {}) {
  if (!canAlterNarutoRoll(message)) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Reroll.CannotReroll"));
    return;
  }

  const oldRoll = getPrimaryD20Roll(message);
  const newRoll = cloneForReroll(oldRoll);
  await newRoll.evaluate({ allowInteractive: false });

  let keptRoll = newRoll;
  let oldClass = "discarded";
  let newClass = "kept";
  if (
    (options.keep === "higher" && Number(oldRoll.total) > Number(newRoll.total)) ||
    (options.keep === "lower" && Number(oldRoll.total) < Number(newRoll.total))
  ) {
    keptRoll = oldRoll;
    oldClass = "kept";
    newClass = "discarded";
  }

  const ctx = getRerollContext(message);
  const handler = getRerollHandler(ctx?.flags);
  const applied = await handler?.applyReroll?.(message, ctx, {
    oldRoll,
    newRoll,
    keptRoll,
    keep: options.keep ?? "new",
  });
  if (applied === false) return;

  const content = `
    <div class="naruto-reroll-card">
      ${await renderRollBlock(oldRoll, "NarutoD20.Reroll.Original", oldClass)}
      ${await renderRollBlock(newRoll, "NarutoD20.Reroll.Rerolled", newClass)}
      <div class="naruto-reroll-summary">
        ${game.i18n.format("NarutoD20.Reroll.KeptTotal", {
          total: Math.round(Number(keptRoll.total) * 100) / 100,
        })}
      </div>
    </div>
  `;

  await updateMessageWithReroll(message, {
    content,
    rolls: [keptRoll],
    flags: buildFlags(message, { isReroll: true, keep: options.keep ?? "new" }),
  });
}

async function addActionPointToMessage(message) {
  const ctx = getRerollContext(message);
  const handler = getRerollHandler(ctx?.flags);
  if (handler?.addActionPoint) {
    await handler.addActionPoint(message, ctx);
    return;
  }

  if (!ctx || !canAddActionPoint(message)) {
    ui.notifications.warn(game.i18n.localize("NarutoD20.Reroll.CannotAddActionPoint"));
    return;
  }

  const { actor } = ctx;
  const currentAp = Number(foundry.utils.getProperty(actor, actionPointsPath) ?? 0) || 0;
  if (currentAp < 1) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoActionPoints", { actor: actor.name }),
    );
    return;
  }

  const oldRoll = getPrimaryD20Roll(message);
  const apRoll = new Roll("1d6");
  await apRoll.evaluate({ allowInteractive: false });

  const apBonus = Math.max(0, Number(apRoll.total) || 0);
  const total = (Number(oldRoll.total) || 0) + apBonus;
  await actor.update({ [actionPointsPath]: currentAp - 1 });
  await updateMessageWithActionPoint(message, { oldRoll, apRoll, apBonus, total });
}

export function buildNarutoRerollMessageData(actor, source) {
  return {
    flags: {
      [MODULE_ID]: {
        [REROLL_FLAG]: {
          actorUuid: actor.uuid,
          source,
        },
      },
    },
  };
}

export async function markNarutoRollRerollable(message, actor, source, data = {}) {
  if (!message || !actor || !getPrimaryD20Roll(message)) return;
  await message.setFlag(MODULE_ID, REROLL_FLAG, {
    actorUuid: actor.uuid,
    source,
    ...foundry.utils.deepClone(data),
  });
}

export function registerNarutoRerollHandler(source, handler) {
  if (!source || !handler) return;
  REROLL_HANDLERS.set(source, handler);
}

export function registerNarutoRollContextMenu() {
  const addOptions = (_app, options) => {
    options.push(
      {
        name: game.i18n.localize("NarutoD20.Reroll.ActionPoint"),
        icon: '<i class="fa-solid fa-bolt"></i>',
        condition: (li) => canAddActionPoint(resolveMessageFromElement(li)),
        callback: (li) => addActionPointToMessage(resolveMessageFromElement(li)),
      },
      {
        name: game.i18n.localize("NarutoD20.Reroll.KeepNew"),
        icon: '<i class="fa-solid fa-dice"></i>',
        condition: (li) => canAlterNarutoRoll(resolveMessageFromElement(li)),
        callback: (li) => rerollMessage(resolveMessageFromElement(li)),
      },
      {
        name: game.i18n.localize("NarutoD20.Reroll.KeepLower"),
        icon: '<i class="fa-solid fa-dice-one"></i>',
        condition: (li) => canAlterNarutoRoll(resolveMessageFromElement(li)),
        callback: (li) => rerollMessage(resolveMessageFromElement(li), { keep: "lower" }),
      },
      {
        name: game.i18n.localize("NarutoD20.Reroll.KeepHigher"),
        icon: '<i class="fa-solid fa-dice-six"></i>',
        condition: (li) => canAlterNarutoRoll(resolveMessageFromElement(li)),
        callback: (li) => rerollMessage(resolveMessageFromElement(li), { keep: "higher" }),
      },
    );
  };

  Hooks.on("getChatLogEntryContext", addOptions);
  Hooks.on("getChatMessageContextOptions", addOptions);
}
