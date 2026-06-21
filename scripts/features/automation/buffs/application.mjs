import { MODULE_ID } from "../../../core/constants.mjs";
import { chakraPoolTempPath } from "../../../core/flag-paths.mjs";
import { resolveRankTechnique } from "../ranks/buffs.mjs";
import {
  MAINTENANCE_BUFF_FLAG,
  MAINTENANCE_BUFF_FLAG_PATH,
  MAINTENANCE_MODES,
  findMaintenanceBuffForTechnique,
  maintenanceBuffDuration,
  maintenanceBuffFlagData,
  maintenanceFacets,
  maintenanceModeBuffName,
  maintenanceModeById,
  realMaintenanceBuffDuration,
  resolveMaintenanceModel,
  toggleMaintenanceBuffDuration,
} from "../maintenance/buffs.mjs";
import { applyConditionBenefits } from "./condition-benefits.mjs";

const SOURCE_FLAG = MODULE_ID;
const DEFAULT_BUFF_PACK_ID = "naruto-d20.technique-buffs";
const buffIndexCache = new Map();

export function extractTemporaryChakraGrant(changes = []) {
  return changes.reduce((total, change) => {
    if (change?.target !== "temporaryChakra") return total;
    if ((change.operator ?? "add") !== "add") return total;
    const amount = Math.max(0, Number(change.formula ?? change.value ?? 0) || 0);
    return total + amount;
  }, 0);
}

/**
 * Entry point: orchestrate buff lookup → target resolution → application.
 * Called from performTechnique after a successful perform check.
 * `action` is the ItemAction that was used — its duration is copied onto the buff.
 */
export async function applyTechniqueBuff(item, actor, action) {
  const auto = item.system.automation;
  if (!auto?.enabled) return;

  if (game.settings.get(MODULE_ID, "buffTargetFiltering") === "off") return;

  const facets = maintenanceFacets(item);
  if (facets) {
    if (facets.choice === "mode") {
      await applyModeBuff(item, actor, null, facets.interval);
      return;
    }
    if (
      facets.resource === "hp" ||
      facets.resource === "chakraDamage" ||
      item.system.automation.maintenance.element
    ) {
      const duration = resolveBuffDurationFromAction(action);
      await applyUpkeepBuff(item, actor, facets.interval, duration);
      return;
    }
  }

  const context = resolveTechniqueBuffContext(item);
  const buffEntry = await resolveBuffMatch(context.buffName);
  if (!buffEntry) {
    console.warn(
      `naruto-d20 | No buff found named "${context.buffName}" in technique-buffs compendia.`,
    );
    return;
  }

  const buffDoc = await resolveBuffDocument(buffEntry);
  if (!buffDoc) return;

  const applyTargets = resolveBuffTargets(item, actor, context);
  if (!applyTargets.length) return;

  const duration = context.duration ?? resolveBuffDurationFromAction(action);

  for (const targetActor of applyTargets) {
    await applyBuffToTarget(buffDoc, targetActor, {
      duration,
      level: context.level,
      maintenanceBuff: context.maintenanceBuff,
    });
  }
}

export function clearBuffLookupCache() {
  buffIndexCache.clear();
}

/**
 * Apply (or switch) a mode-choice maintenance buff on the performer. Each mode maps to
 * a "<technique> (Dexterity|Strength)" buff variant. Switching deletes the previous
 * mode's buff so only one maintenance buff is ever active for the technique. No chakra is
 * spent here — only the initial perform pays; round-to-round upkeep is free.
 */
export async function applyModeBuff(item, actor, modeId = null, interval = 1) {
  if (!actor?.isOwner) return;

  const resolvedModeId = modeId ?? (await promptModeChoice(item, { initial: true }));
  if (!resolvedModeId || resolvedModeId === "break") {
    await removeMaintenanceBuff(actor, item.id);
    return;
  }

  const mode = maintenanceModeById(resolvedModeId);
  if (!mode) return;

  const buffEntry = await resolveBuffMatch(maintenanceModeBuffName(item, mode));
  if (!buffEntry) {
    console.warn(
      `naruto-d20 | No mode buff found named "${maintenanceModeBuffName(item, mode)}" in technique-buffs compendia.`,
    );
    return;
  }

  const buffDoc = await resolveBuffDocument(buffEntry);
  if (!buffDoc) return;

  // Drop any previously applied mode buff for this technique before applying the new one.
  const existing = findMaintenanceBuffForTechnique(actor, item.id);
  if (existing && existing.flags?.[SOURCE_FLAG]?.sourceId !== buffDoc.uuid) {
    await removeMaintenanceBuff(actor, existing.id);
  }

  await applyBuffToTarget(buffDoc, actor, {
    duration: toggleMaintenanceBuffDuration(),
    maintenanceBuff: maintenanceBuffFlagData({
      sourceTechniqueId: item.id,
      modeId: mode.id,
      model: "toggle",
      startRound: game.combat?.round ?? null,
      interval,
    }),
  });
}

/**
 * Apply (or refresh) an HP-upkeep maintenance buff (Amatsu) on the performer. The buff
 * is the per-turn tracker: it expires at turn start and carries the chosen damage
 * element(s) so re-uses and the turn-start maintenance can read them back. The
 * companion buff is looked up by the technique's exact name. No chakra is spent
 * here — entry pays once and round-to-round upkeep is HP (handled in maintenance).
 */
export async function applyUpkeepBuff(item, actor, interval = 1, duration = null) {
  if (!actor?.isOwner) return;

  const { getActiveElements } = await import("../maintenance/element-damage.mjs");
  const elements = getActiveElements(actor, item) ?? [];

  const buffEntry = await resolveBuffMatch(item.name);
  if (!buffEntry) {
    console.warn(
      `naruto-d20 | No upkeep maintenance buff found named "${item.name}" in technique-buffs compendia.`,
    );
    return;
  }

  const buffDoc = await resolveBuffDocument(buffEntry);
  if (!buffDoc) return;

  const facets = maintenanceFacets(item);
  const model = resolveMaintenanceModel(facets, duration);

  if (model === "duration") {
    const totalRounds = Number(duration.value);
    const startRound = game.combat?.round ?? null;
    await applyBuffToTarget(buffDoc, actor, {
      duration: realMaintenanceBuffDuration({ totalRounds, worldTime: game.time.worldTime }),
      maintenanceBuff: maintenanceBuffFlagData({
        sourceTechniqueId: item.id,
        elements,
        hasHeal: !!facets?.heal,
        model: "duration",
        totalRounds,
        startRound,
        interval,
      }),
    });
    await applyConditionBenefits(actor, facets);
    return;
  }

  await applyBuffToTarget(buffDoc, actor, {
    duration: toggleMaintenanceBuffDuration(),
    maintenanceBuff: maintenanceBuffFlagData({
      sourceTechniqueId: item.id,
      elements,
      hasHeal: !!facets?.heal,
      model: "toggle",
      startRound: game.combat?.round ?? null,
      interval,
    }),
  });
  await applyConditionBenefits(actor, facets);
}

async function removeMaintenanceBuff(actor, itemId) {
  if (!actor.items.has(itemId)) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
  } catch (err) {
    if (actor.items.has(itemId)) {
      console.error(`naruto-d20 | failed to delete maintenance buff "${itemId}":`, err);
    }
  }
}

/**
 * Prompt the user to pick a maintenance mode (or break the stance). Reused for the initial
 * activation and the per-turn maintenance prompt.
 * Resolves to a mode id ("dex" / "str"), "break", or null (canceled initial activation).
 */
export function promptModeChoice(
  item,
  { current = null, allowBreak = false, initial = false } = {},
) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const buttons = {};
    for (const mode of MAINTENANCE_MODES) {
      buttons[mode.id] = {
        label: game.i18n.localize(mode.labelKey),
        callback: () => done(mode.id),
      };
    }
    if (allowBreak) {
      buttons.break = {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("NarutoD20.Maintenance.Break"),
        callback: () => done("break"),
      };
    }

    const messageKey = initial
      ? "NarutoD20.Maintenance.MessageInitial"
      : "NarutoD20.Maintenance.Message";

    new Dialog({
      title: game.i18n.format("NarutoD20.Maintenance.Title", { name: item.name }),
      content: `<p>${game.i18n.format(messageKey, { name: item.name })}</p>
        <ul>
          <li>${game.i18n.localize("NarutoD20.Maintenance.DexHint")}</li>
          <li>${game.i18n.localize("NarutoD20.Maintenance.StrHint")}</li>
        </ul>`,
      buttons,
      default: maintenanceModeById(current)?.id ?? MAINTENANCE_MODES[0].id,
      // Closing the initial prompt cancels; closing maintenance breaks the stance.
      close: () => done(initial ? null : allowBreak ? "break" : null),
    }).render(true);
  });
}

/**
 * Personal techniques always affect their performer. Other technique buffs
 * require an explicit canvas target so debuffs are not accidentally self-applied.
 */
function resolveTechniqueBuffContext(item) {
  const rank = resolveRankTechnique(item.name);
  if (rank) {
    return {
      ...rank,
      sourceTechniqueId: item.id,
      duration: toggleMaintenanceBuffDuration(),
      maintenanceBuff: maintenanceBuffFlagData({
        sourceTechniqueId: item.id,
        grantType: "paid",
        key: rank.key,
        model: "toggle",
        startRound: game.combat?.round ?? null,
        interval: rank.interval,
      }),
    };
  }

  return {
    buffName: item.name,
    level: null,
    duration: null,
    maintenanceBuff: null,
    selfTarget: false,
  };
}

function resolveBuffTargets(item, actor, context = null) {
  if (context?.selfTarget) return [actor];

  const targetMode = item.system?.automation?.targetMode ?? "auto";
  if (targetMode === "self") return [actor];
  if (targetMode === "selected") return selectedTargetActors();

  if (isSelfTargetingTechnique(item)) return [actor];

  return selectedTargetActors();
}

function selectedTargetActors() {
  const targets = [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean);
  if (targets.length) return targets;

  ui.notifications.warn(game.i18n.localize("NarutoD20.Automation.NoTargets"));
  return [];
}

function isSelfTargetingTechnique(item) {
  const system = item.system ?? {};
  const range = String(system.range ?? "")
    .trim()
    .toLowerCase();
  const target = String(system.target ?? "")
    .trim()
    .toLowerCase();
  const subtype = String(system.subtype ?? "")
    .trim()
    .toLowerCase();

  if (range.startsWith("personal")) return true;
  if (target === "you" || target.startsWith("you ")) return true;

  return subtype.split(/\s*,\s*/).includes("stance") && target === "";
}

/**
 * Extract duration from the ItemAction that triggered this buff.
 * Returns null to leave the buff's own duration untouched (inst / perm / seeText / missing).
 */
function resolveBuffDurationFromAction(action) {
  // ItemAction exposes duration as a direct property; raw data is the fallback
  const dur = action?.duration ?? action?.data?.duration;
  if (!dur?.units || dur.units === "inst" || dur.units === "perm" || dur.units === "seeText") {
    return null;
  }

  const raw = dur.value;
  let value = "";
  if (raw != null && String(raw).trim() !== "") {
    const actor = action?.item?.actor;
    const rollData = action?.getRollData?.() ?? actor?.getRollData?.() ?? {};
    // Techniques have no caster level — make "cl" resolve to character level.
    if (!Number.isFinite(rollData.cl)) {
      rollData.cl =
        actor?.system?.details?.level?.value ?? actor?.system?.attributes?.hd?.total ?? 0;
    }
    const total = RollPF.safeRollSync(String(raw), rollData)?.total;
    value = Number.isFinite(total) ? total : 0;
  }

  return {
    units: String(dur.units),
    value: String(value),
  };
}

/**
 * Search naruto-d20.technique-buffs (and custom compendia) for a buff by name.
 * Also searches world items (game.items) of type "buff" — compendia take priority.
 * Returns { exact: [...], variants: [...] } where variants match "Name (X)" pattern.
 */
export async function findBuffByName(name) {
  const { exact, variants } = await findCompendiumBuffMatches(name);
  const worldMatches = findWorldBuffMatches(name);

  exact.push(...worldMatches.exact);
  variants.push(...worldMatches.variants);

  return { exact, variants };
}

async function resolveBuffMatch(name) {
  const matches = await findBuffByName(name);
  return selectBuffMatch(matches);
}

function selectBuffMatch({ exact, variants }) {
  return (
    exact.find(isCompendiumBuffEntry) ??
    variants.find(isCompendiumBuffEntry) ??
    exact[0] ??
    variants[0] ??
    null
  );
}

function isCompendiumBuffEntry(entry) {
  return entry?.packId !== null;
}

async function resolveBuffDocument(entry) {
  if (entry.packId === null) {
    return entry.worldItem ?? game.items.get(entry._id);
  }

  const pack = game.packs.get(entry.packId);
  if (!pack) return null;
  return pack.getDocument(entry._id);
}

async function findCompendiumBuffMatches(name) {
  const exact = [];
  const variants = [];
  const variantPrefix = `${name} (`;

  for (const packId of getBuffPackIds()) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const index = await getCachedPackIndex(packId, pack);
    collectBuffMatchesFromIndex(index, { name, variantPrefix, packId, exact, variants });
  }

  return { exact, variants };
}

function getBuffPackIds() {
  const packIds = [DEFAULT_BUFF_PACK_ID];
  const custom = game.settings.get(MODULE_ID, "customBuffCompendia");
  if (custom) {
    for (const id of custom
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      packIds.push(id);
    }
  }
  return packIds;
}

async function getCachedPackIndex(packId, pack) {
  if (buffIndexCache.has(packId)) return buffIndexCache.get(packId);

  const index = await pack.getIndex();
  buffIndexCache.set(packId, index);
  return index;
}

function collectBuffMatchesFromIndex(index, { name, variantPrefix, packId, exact, variants }) {
  for (const entry of index) {
    if (entry.name === name) {
      exact.push({ ...entry, packId });
    } else if (entry.name.startsWith(variantPrefix)) {
      variants.push({ ...entry, packId });
    }
  }
}

function findWorldBuffMatches(name) {
  const exact = [];
  const variants = [];
  const variantPrefix = `${name} (`;

  for (const item of game.items.filter((i) => i.type === "buff")) {
    if (item.name === name) {
      exact.push({ name: item.name, _id: item.id, packId: null, worldItem: item });
    } else if (item.name.startsWith(variantPrefix)) {
      variants.push({ name: item.name, _id: item.id, packId: null, worldItem: item });
    }
  }

  return { exact, variants };
}

/**
 * Apply buff to a single target actor: refresh existing or create from compendium.
 * Tracks origin via flags["naruto-d20"].sourceId so update-vs-create works correctly.
 * If duration is provided it overrides whatever the compendium buff had stored.
 */
export async function applyBuffToTarget(buffDoc, targetActor, options = null) {
  if (!targetActor.isOwner) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Automation.NoPermission", { name: targetActor.name }),
    );
    return;
  }

  const { duration, level, maintenanceBuff } = normalizeBuffApplyOptions(options);
  const sourceId = buffDoc.uuid;
  const existing = findExistingAppliedBuff(targetActor, sourceId);

  if (existing) {
    await refreshExistingBuff(existing, { duration, level, maintenanceBuff });
  } else {
    await createBuffOnTarget(buffDoc, targetActor, sourceId, {
      duration,
      level,
      maintenanceBuff,
    });
  }
}

function normalizeBuffApplyOptions(options) {
  if (
    !options ||
    (!("duration" in Object(options)) &&
      !("level" in Object(options)) &&
      !("maintenanceBuff" in Object(options)))
  ) {
    return { duration: options ?? null, level: null, maintenanceBuff: null };
  }
  return {
    duration: options.duration ?? null,
    level: Number.isInteger(options.level) ? options.level : null,
    maintenanceBuff: options.maintenanceBuff ?? null,
  };
}

function findExistingAppliedBuff(targetActor, sourceId) {
  return targetActor.items.find((i) => i.flags?.[SOURCE_FLAG]?.sourceId === sourceId);
}

async function refreshExistingBuff(existing, { duration, level, maintenanceBuff }) {
  const updates = { "system.active": true };
  if (duration) {
    updates["system.duration.units"] = duration.units;
    updates["system.duration.value"] = duration.value;
    if (duration.end) updates["system.duration.end"] = duration.end;
    if (duration.start !== undefined) updates["system.duration.start"] = duration.start;
  }
  if (level != null) {
    updates["system.level"] = level;
  }
  if (maintenanceBuff) {
    updates[MAINTENANCE_BUFF_FLAG_PATH] = maintenanceBuff;
  }
  await existing.update(updates);
}

async function createBuffOnTarget(
  buffDoc,
  targetActor,
  sourceId,
  { duration, level, maintenanceBuff },
) {
  const itemData = buffDoc.toObject();
  delete itemData._id;
  const temporaryChakraGrant = extractTemporaryChakraGrant(itemData.system?.changes ?? []);

  itemData.flags ??= {};
  itemData.flags[SOURCE_FLAG] ??= {};
  itemData.flags[SOURCE_FLAG].sourceId = sourceId;
  if (maintenanceBuff) itemData.flags[SOURCE_FLAG][MAINTENANCE_BUFF_FLAG] = maintenanceBuff;
  if (temporaryChakraGrant > 0) {
    itemData.flags[SOURCE_FLAG].temporaryChakra = { remaining: temporaryChakraGrant };
  }

  itemData.system ??= {};
  if (duration) {
    itemData.system.duration ??= {};
    itemData.system.duration.units = duration.units;
    itemData.system.duration.value = duration.value;
    if (duration.end) itemData.system.duration.end = duration.end;
    if (duration.start !== undefined) itemData.system.duration.start = duration.start;
  }
  if (level != null) {
    itemData.system.level = level;
  }
  itemData.system.active = true;

  await targetActor.createEmbeddedDocuments("Item", [itemData]);

  if (temporaryChakraGrant > 0) {
    const currentTemp = Math.max(
      0,
      Number(targetActor.flags?.[MODULE_ID]?.chakra?.pool?.temp ?? 0) || 0,
    );
    await targetActor.update({ [chakraPoolTempPath]: currentTemp + temporaryChakraGrant });
  }
}
