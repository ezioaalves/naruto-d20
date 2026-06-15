/**
 * Playwright-only API for driving a live Foundry world.
 *
 * This module is not imported by the runtime entry point. The E2E harness loads
 * it explicitly after `game.ready`, then creates disposable actor clones for
 * every test. Rule logic remains in the production modules.
 */

import {
  CHAKRA_DEPLETION_CONDITION_ID,
  LOW_RESERVES_CONDITION_ID,
  MODULE_ID,
  TECHNIQUE_ITEM_TYPE,
} from "../constants.mjs";
import {
  chakraPoolTempPath,
  chakraPoolValuePath,
  chakraReserveValuePath,
  conditionAppliedExhaustedPath,
  conditionAppliedFatiguedPath,
} from "../flag-paths.mjs";
import { DISCIPLINE_SKILL_MAP } from "../data/skills.mjs";
import { performTechnique, canAffordTechnique } from "../use-technique.mjs";
import {
  availableChakra,
  calculateChakraSpend,
  canPayChakra,
  payChakra,
} from "../data/chakra-spend.mjs";
import { checkAndUpdateConditions } from "../data/chakra-conditions.mjs";
import {
  applyBuffToTarget,
  applyTechniqueBuff,
  clearBuffLookupCache,
  findBuffByName,
} from "../automation/buff-application.mjs";
import { isTechniqueEffectivelyLearned } from "../learn-technique.mjs";

const FIXTURE_FLAG = "e2eFixture";
const DEFAULT_TECHNIQUE_PACK = "naruto-d20.techniques";
const DEFAULT_BUFF_PACK = "naruto-d20.technique-buffs";

let activeFixture = null;
let pendingRollCleanup = null;

function moduleRecord() {
  const mod = game.modules.get(MODULE_ID);
  if (!mod) throw new Error(`Module "${MODULE_ID}" is not active`);
  return mod;
}

function exactActor(name) {
  const actor = game.actors.getName(name);
  if (!actor) throw new Error(`Test actor "${name}" was not found by exact name`);
  return actor;
}

function getActor(name = null) {
  if (name) return exactActor(name);
  const actor = activeFixture?.actorId ? game.actors.get(activeFixture.actorId) : null;
  if (!actor) throw new Error("No active E2E actor fixture");
  return actor;
}

function fixtureActorIds() {
  return new Set([activeFixture?.actorId, ...(activeFixture?.extraActorIds ?? [])].filter(Boolean));
}

function cloneData(source, { name, runId }) {
  const data = source.toObject();
  delete data._id;
  data.name = name;
  data.folder = null;
  data.flags ??= {};
  data.flags.pf1 ??= {};
  data.flags.pf1.forTesting = true;
  data.flags[MODULE_ID] ??= {};
  data.flags[MODULE_ID][FIXTURE_FLAG] = { runId, sourceActorId: source.id };
  return data;
}

async function removeStaleFixtures() {
  for (const scene of game.scenes) {
    const ids = scene.tokens
      .filter((token) => token.flags?.[MODULE_ID]?.[FIXTURE_FLAG]?.runId)
      .map((token) => token.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
  }

  const worldItemIds = game.items
    .filter((item) => item.flags?.[MODULE_ID]?.[FIXTURE_FLAG]?.runId)
    .map((item) => item.id);
  if (worldItemIds.length) await Item.implementation.deleteDocuments(worldItemIds);

  const stalePacks = game.packs.filter(
    (pack) => pack.metadata.package === "world" && pack.metadata.name.startsWith("naruto-e2e-"),
  );
  for (const pack of stalePacks) {
    await pack.deleteCompendium();
  }

  const stale = game.actors.filter((actor) => actor.flags?.[MODULE_ID]?.[FIXTURE_FLAG]?.runId);
  for (const actor of stale) {
    await actor.delete();
  }
}

async function beginTestFixture({ sourceActorName, requiredTechnique }) {
  if (activeFixture) await endTestFixture();
  await removeStaleFixtures();

  const source = exactActor(sourceActorName);
  const technique = source.items.find(
    (item) => item.type === TECHNIQUE_ITEM_TYPE && item.name === requiredTechnique,
  );
  if (!technique) {
    throw new Error(`"${sourceActorName}" must contain technique "${requiredTechnique}"`);
  }

  const runId = foundry.utils.randomID(16);
  const actor = await Actor.implementation.create(
    cloneData(source, { name: `${source.name} [E2E ${runId.slice(0, 6)}]`, runId }),
    { renderSheet: false },
  );

  activeFixture = {
    runId,
    sourceActorId: source.id,
    sourceSnapshot: JSON.stringify(source.toObject()),
    actorId: actor.id,
    extraActorIds: [],
    tokenRefs: [],
    worldItemIds: [],
    packIds: [],
    combatIds: [],
    settingValues: new Map(),
    initialTargetIds: [...(game.user.targets ?? [])].map((token) => token.id),
  };

  return {
    runId,
    sourceActorId: source.id,
    actorId: actor.id,
    actorName: actor.name,
    techniqueId: actor.items.find((item) => item.name === requiredTechnique)?.id ?? null,
  };
}

async function closeFixtureApplications() {
  const actorIds = fixtureActorIds();
  const applications = new Set([
    ...Object.values(ui.windows ?? {}),
    ...Array.from(foundry.applications.instances?.values?.() ?? []),
  ]);

  for (const app of applications) {
    const actorId = app.actor?.id ?? app.object?.actor?.id ?? app.object?.id;
    if (actorIds.has(actorId) || app.id === "tap-reserves-dialog") {
      await app.close({ force: true }).catch(() => {});
    }
  }
}

async function restoreSettings() {
  if (!activeFixture) return;
  for (const [key, value] of activeFixture.settingValues) {
    await game.settings.set(MODULE_ID, key, value);
  }
}

async function restoreTargets() {
  if (!activeFixture) return;
  for (const target of [...(game.user.targets ?? [])]) {
    target.setTarget(false, { releaseOthers: false });
  }
  for (const id of activeFixture.initialTargetIds) {
    canvas.tokens?.get(id)?.setTarget(true, { releaseOthers: false });
  }
}

async function deleteFixtureMessages() {
  const actorIds = fixtureActorIds();
  const ids = game.messages.contents
    .filter((message) => actorIds.has(message.speaker?.actor))
    .map((message) => message.id);
  if (ids.length) await ChatMessage.implementation.deleteDocuments(ids);
}

async function deleteFixtureCombats() {
  if (!activeFixture) return;
  for (const id of activeFixture.combatIds) {
    const combat = game.combats.get(id);
    if (combat) await combat.delete();
  }
}

async function deleteFixtureTokens() {
  if (!activeFixture) return;
  for (const { sceneId, tokenId } of activeFixture.tokenRefs) {
    const scene = game.scenes.get(sceneId);
    if (scene?.tokens.has(tokenId)) {
      await scene.deleteEmbeddedDocuments("Token", [tokenId]);
    }
  }
}

async function deleteFixtureItemsAndPacks() {
  if (!activeFixture) return;
  if (activeFixture.worldItemIds.length) {
    await Item.implementation.deleteDocuments(activeFixture.worldItemIds);
  }
  for (const packId of activeFixture.packIds) {
    const pack = game.packs.get(packId);
    if (pack) await pack.deleteCompendium();
  }
}

async function endTestFixture() {
  if (!activeFixture) return;
  clearForcedRoll();
  const errors = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  try {
    await attempt(closeFixtureApplications);
    await attempt(deleteFixtureMessages);
    await attempt(restoreTargets);
    await attempt(restoreSettings);
    await attempt(deleteFixtureCombats);
    await attempt(deleteFixtureTokens);
    await attempt(deleteFixtureItemsAndPacks);

    for (const actorId of [...activeFixture.extraActorIds, activeFixture.actorId]) {
      await attempt(async () => {
        const actor = game.actors.get(actorId);
        if (actor) await actor.delete();
      });
    }

    const source = game.actors.get(activeFixture.sourceActorId);
    if (!source || JSON.stringify(source.toObject()) !== activeFixture.sourceSnapshot) {
      errors.push(new Error("The source E2E actor changed during the test run"));
    }
  } finally {
    activeFixture = null;
    clearBuffLookupCache();
  }
  if (errors.length) {
    throw new AggregateError(errors, "One or more E2E fixture cleanup operations failed");
  }
}

function getChakra(actor) {
  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  return {
    pool: {
      value: chakra.pool?.value ?? 0,
      temp: chakra.pool?.temp ?? 0,
      max: chakra.pool?.max ?? 0,
      maxBonus: chakra.pool?.maxBonus ?? 0,
    },
    reserve: {
      value: chakra.reserve?.value ?? 0,
      max: chakra.reserve?.max ?? 0,
      maxBonus: chakra.reserve?.maxBonus ?? 0,
    },
    nature: chakra.nature ?? { primary: "", secondary: [] },
    available: availableChakra(actor),
  };
}

function getLearn(actor) {
  const learn = actor.flags?.[MODULE_ID]?.learn ?? {};
  return Object.fromEntries(
    Object.entries(learn).map(([key, value]) => [
      key,
      {
        total: value?.total ?? 0,
        base: value?.base ?? 0,
        buffBonus: value?.buffBonus ?? 0,
      },
    ]),
  );
}

function getConditions(actor) {
  const has = (id) => actor.statuses?.has(id) ?? false;
  const tracked = actor.flags?.[MODULE_ID]?.conditions ?? {};
  return {
    fatigued: has("fatigued"),
    exhausted: has("exhausted"),
    lowReserves: has(LOW_RESERVES_CONDITION_ID),
    chakraDepletion: has(CHAKRA_DEPLETION_CONDITION_ID),
    statuses: [...(actor.statuses ?? [])],
    appliedFatigued: tracked.appliedFatigued ?? false,
    appliedExhausted: tracked.appliedExhausted ?? false,
  };
}

async function resetActor(actor, state = {}) {
  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  await actor.update({
    [chakraPoolValuePath]: state.pool ?? chakra.pool?.max ?? 0,
    [chakraPoolTempPath]: state.temp ?? 0,
    [chakraReserveValuePath]: state.reserve ?? chakra.reserve?.max ?? 0,
    [conditionAppliedFatiguedPath]: false,
    [conditionAppliedExhaustedPath]: false,
  });
  await actor.setConditions({
    [LOW_RESERVES_CONDITION_ID]: false,
    [CHAKRA_DEPLETION_CONDITION_ID]: false,
    fatigued: false,
    exhausted: false,
  });
  await checkAndUpdateConditions(actor);
  return getChakra(actor);
}

async function setCondition(actor, id, active) {
  await actor.setConditions({ [id]: active });
}

async function setAbility(actor, key, value) {
  await actor.update({ [`system.abilities.${key}.value`]: value });
  return { mod: actor.system.abilities?.[key]?.mod ?? 0 };
}

function getTechnique(actor, name) {
  return (
    actor.items.find((item) => item.type === TECHNIQUE_ITEM_TYPE && item.name === name) ?? null
  );
}

async function ensureTechnique(
  actor,
  name,
  { packId = DEFAULT_TECHNIQUE_PACK, update = null } = {},
) {
  let item = getTechnique(actor, name);
  if (!item) {
    const pack = game.packs.get(packId);
    if (!pack) throw new Error(`Technique pack "${packId}" is unavailable`);
    const index = await pack.getIndex();
    const entry = index.find((candidate) => candidate.name === name);
    if (!entry) throw new Error(`Technique "${name}" is not in ${packId}`);
    const source = (await pack.getDocument(entry._id)).toObject();
    delete source._id;
    [item] = await actor.createEmbeddedDocuments("Item", [source]);
  }
  if (update) {
    await item.update(update);
    item = actor.items.get(item.id);
  }
  return item;
}

function listTechniques(actor) {
  return actor.items
    .filter((item) => item.type === TECHNIQUE_ITEM_TYPE)
    .map((item) => ({
      id: item.id,
      name: item.name,
      learned: isTechniqueEffectivelyLearned(item),
      chakraCost: item.system?.chakraCost ?? 0,
      automation: item.system?.automation ?? null,
      firstActionId: firstActionId(item),
    }));
}

function firstActionId(item) {
  const first = item?.actions?.contents?.[0] ?? Array.from(item?.actions ?? [])[0];
  return first?.id ?? null;
}

function validateD20Face(face) {
  const value = Number(face);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`Static d20 result must be an integer from 1 to 20; received ${face}`);
  }
  return value;
}

function clearForcedRoll() {
  if (pendingRollCleanup) pendingRollCleanup();
  pendingRollCleanup = null;
}

function forceNextRoll(actor, face, bonus = 0) {
  clearForcedRoll();
  const staticRoll = validateD20Face(face);
  const forcedBonus = Number(bonus) || 0;
  let skillHookId = null;
  let d20HookId = null;

  const cleanup = () => {
    if (skillHookId !== null) Hooks.off("pf1PreActorRollSkill", skillHookId);
    if (d20HookId !== null) Hooks.off("pf1PreD20Roll", d20HookId);
    skillHookId = null;
    d20HookId = null;
    if (pendingRollCleanup === cleanup) pendingRollCleanup = null;
  };

  skillHookId = Hooks.on("pf1PreActorRollSkill", (rolledActor, options) => {
    if (rolledActor.id !== actor.id) return;
    options.skipDialog = true;
    options.staticRoll = staticRoll;
  });

  d20HookId = Hooks.on("pf1PreD20Roll", (roll, options) => {
    if (options?.speaker?.actor !== actor.id) return;
    roll.options.staticRoll = staticRoll;
    if (forcedBonus) roll.addBonus(`${forcedBonus}[E2E]`);
    cleanup();
  });

  pendingRollCleanup = cleanup;
}

async function withForcedRoll(face, fn, { actor, bonus = 0 }) {
  forceNextRoll(actor, face, bonus);
  try {
    return await fn();
  } finally {
    clearForcedRoll();
  }
}

function spyNotifications() {
  const captured = { warn: [], error: [], info: [], all: [] };
  const methods = ["warn", "error", "info"];
  const originals = {};

  for (const method of methods) {
    originals[method] = ui.notifications[method].bind(ui.notifications);
    ui.notifications[method] = (message, ...rest) => {
      captured[method].push(message);
      captured.all.push({ type: method, message });
      return originals[method](message, ...rest);
    };
  }

  return {
    captured,
    warnings: captured.warn,
    restore() {
      for (const method of methods) ui.notifications[method] = originals[method];
    },
  };
}

async function performByName(
  actor,
  techniqueName,
  { forceRoll = 20, rollBonus = 0, actionId } = {},
) {
  const item = getTechnique(actor, techniqueName);
  if (!item) throw new Error(`Technique "${techniqueName}" is not on ${actor.name}`);
  const resolvedActionId = actionId ?? firstActionId(item);
  const startedAt = Date.now();
  const spy = spyNotifications();
  try {
    await withForcedRoll(forceRoll, () => performTechnique(item, resolvedActionId), {
      actor,
      bonus: rollBonus,
    });
  } finally {
    spy.restore();
  }
  return {
    chakra: getChakra(actor),
    conditions: getConditions(actor),
    warnings: spy.warnings,
    messages: chatSince(startedAt),
  };
}

function techniquePerformState(actor, item) {
  const skillKey = DISCIPLINE_SKILL_MAP[item.system?.discipline];
  const ranks = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : null;
  const threshold = item.system?.derived?.skillThreshold ?? null;
  const mastery = item.system?.derived?.masteryPerform ?? 0;
  return {
    skillKey,
    ranks,
    threshold,
    mastery,
    bypasses: !skillKey || ranks + mastery >= threshold,
  };
}

function listBuffs(actor) {
  return actor.items
    .filter((item) => item.type === "buff")
    .map((item) => ({
      id: item.id,
      name: item.name,
      active: item.system?.active ?? false,
      sourceId: item.flags?.[MODULE_ID]?.sourceId ?? null,
      duration: item.system?.duration ?? null,
    }));
}

async function clearAutomationBuffs(actor) {
  const ids = actor.items
    .filter((item) => item.type === "buff" && item.flags?.[MODULE_ID]?.sourceId)
    .map((item) => item.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  return ids.length;
}

async function buffTemplateData() {
  const pack = game.packs.get(DEFAULT_BUFF_PACK);
  if (!pack) throw new Error(`Buff pack "${DEFAULT_BUFF_PACK}" is unavailable`);
  const index = await pack.getIndex();
  const entry = index.contents?.[0] ?? index[0];
  if (!entry) throw new Error(`Buff pack "${DEFAULT_BUFF_PACK}" is empty`);
  const data = (await pack.getDocument(entry._id)).toObject();
  delete data._id;
  return data;
}

async function createBuffLookupFixture({ packNames = [], worldNames = [] } = {}) {
  if (!activeFixture) throw new Error("No active E2E fixture");
  const template = await buffTemplateData();
  const result = { packId: null, pack: [], world: [] };

  if (packNames.length) {
    const name = `naruto-e2e-${activeFixture.runId.toLowerCase()}`;
    const pack = await CompendiumCollection.createCompendium({
      label: `Naruto E2E ${activeFixture.runId}`,
      name,
      type: "Item",
    });
    activeFixture.packIds.push(pack.collection);
    result.packId = pack.collection;

    for (const itemName of packNames) {
      const data = foundry.utils.deepClone(template);
      data.name = itemName;
      const document = await Item.implementation.create(data, { pack: pack.collection });
      result.pack.push({ name: itemName, uuid: document.uuid });
    }
  }

  for (const itemName of worldNames) {
    const data = foundry.utils.deepClone(template);
    data.name = itemName;
    data.flags ??= {};
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][FIXTURE_FLAG] = { runId: activeFixture.runId };
    const document = await Item.implementation.create(data);
    activeFixture.worldItemIds.push(document.id);
    result.world.push({ name: itemName, uuid: document.uuid });
  }

  return result;
}

async function createTargetActor() {
  if (!activeFixture) throw new Error("No active E2E fixture");
  const source = game.actors.get(activeFixture.sourceActorId);
  const actor = await Actor.implementation.create(
    cloneData(source, {
      name: `${source.name} [E2E target ${activeFixture.runId.slice(0, 6)}]`,
      runId: activeFixture.runId,
    }),
    { renderSheet: false },
  );
  activeFixture.extraActorIds.push(actor.id);
  return actor;
}

async function createToken(actor, { x = 0, y = 0 } = {}) {
  if (!activeFixture) throw new Error("No active E2E fixture");
  const scene = canvas.scene;
  if (!scene) throw new Error("An active scene is required for target tests");

  const tokenDocument = await actor.getTokenDocument({ x, y });
  const data = tokenDocument.toObject();
  delete data._id;
  data.flags ??= {};
  data.flags[MODULE_ID] ??= {};
  data.flags[MODULE_ID][FIXTURE_FLAG] = { runId: activeFixture.runId };

  const [created] = await scene.createEmbeddedDocuments("Token", [data]);
  activeFixture.tokenRefs.push({ sceneId: scene.id, tokenId: created.id });
  return created;
}

async function startCombatForActor(actor, { x = 100, y = 100 } = {}) {
  if (!activeFixture) throw new Error("No active E2E fixture");
  const scene = canvas.scene;
  if (!scene) throw new Error("An active scene is required for combat tests");

  let token = actor.getActiveTokens?.()[0]?.document ?? null;
  if (!token) token = await createToken(actor, { x, y });

  const ids = durationBuffIds(actor);
  const combat = await Combat.implementation.create({ scene: scene.id });
  activeFixture.combatIds.push(combat.id);
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: token.id, sceneId: scene.id, actorId: actor.id },
  ]);
  await combat.activate();
  await combat.startCombat();
  await waitForUpkeepSettle(actor, ids, combat.round);
  return { combatId: combat.id, round: combat.round, turn: combat.turn };
}

async function advanceCombatTurn(actor) {
  if (!activeFixture) throw new Error("No active E2E fixture");
  const combat = game.combats.get(activeFixture.combatIds.at(-1)) ?? game.combat;
  if (!combat) throw new Error("No active combat to advance");
  const ids = durationBuffIds(actor);
  await combat.nextRound();
  const live = game.combats.get(combat.id) ?? combat;
  await waitForUpkeepSettle(actor, ids, live.round);
  return { round: live.round, turn: live.turn };
}

function durationBuffIds(actor) {
  return actor.items
    .filter(
      (item) =>
        item.type === "buff" && item.flags?.[MODULE_ID]?.maintenanceBuff?.model === "duration",
    )
    .map((item) => item.id);
}

async function waitForUpkeepSettle(actor, ids, round) {
  if (!ids.length) return;
  await waitFor(
    () =>
      ids.every((id) => {
        const item = actor.items.get(id);
        if (!item) return true; // torn down by lethal guard / expiry
        return Number(item.flags?.[MODULE_ID]?.maintenanceBuff?.lastUpkeepRound) === round;
      }),
    { label: `gate upkeep settle at round ${round}` },
  );
}

function setTargetByActor(actor) {
  const token = actor.getActiveTokens?.()[0];
  if (!token) return false;
  token.setTarget(true, { releaseOthers: true });
  return true;
}

function clearTargets() {
  for (const target of [...(game.user?.targets ?? [])]) {
    target.setTarget(false, { releaseOthers: false });
  }
}

const getSetting = (key) => game.settings.get(MODULE_ID, key);

async function setSetting(key, value) {
  if (activeFixture && !activeFixture.settingValues.has(key)) {
    activeFixture.settingValues.set(key, game.settings.get(MODULE_ID, key));
  }
  return game.settings.set(MODULE_ID, key, value);
}

function chatSince(timestamp) {
  return game.messages.contents
    .filter((message) => message.timestamp >= timestamp)
    .map((message) => ({
      id: message.id,
      content: message.content,
      flavor: message.flavor,
      speaker: message.speaker,
      total: message.rolls?.[0]?.total ?? null,
      rerollSource: message.flags?.[MODULE_ID]?.reroll?.source ?? null,
    }));
}

function clearNotifications() {
  ui.notifications.clear();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(condition, { timeout = 5_000, interval = 25, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(interval);
  }
}

async function expireActorEffects(actor, seconds = 86_400) {
  // PF1e creates a buff's duration-tracking ActiveEffect asynchronously after
  // the buff document itself (fire-and-forget in ItemBuffPF._onCreate), and
  // Actor#expireActiveEffects only looks at those effects. Wait for the
  // trackers of the module's automation buffs before advancing time.
  const untracked = () =>
    actor.items.filter(
      (item) =>
        item.type === "buff" &&
        item.system?.active &&
        item.flags?.[MODULE_ID]?.sourceId &&
        !item.effects.some((effect) => effect.getFlag("pf1", "tracker")),
    );
  await waitFor(() => untracked().length === 0, {
    label: `duration trackers on ${untracked()
      .map((item) => item.name)
      .join(", ")}`,
  });

  await actor.expireActiveEffects({
    worldTime: game.time.worldTime + seconds,
    event: "turnStart",
  });

  // turn-maintenance.mjs deletes expired automation buffs in a deferred task
  // (setTimeout 0 + async delete); wait until none linger deactivated.
  const lingering = () =>
    actor.items.some(
      (item) => item.type === "buff" && !item.system?.active && item.flags?.[MODULE_ID]?.sourceId,
    );
  await waitFor(() => !lingering(), { label: "expired automation buff deletion" });
}

export function installTestApi() {
  const mod = moduleRecord();
  mod.api = {
    ready: true,
    MODULE_ID,
    beginTestFixture,
    endTestFixture,
    getActor,
    resetActor,
    getChakra,
    getLearn,
    getConditions,
    setCondition,
    setAbility,
    getTechnique,
    ensureTechnique,
    listTechniques,
    firstActionId,
    techniquePerformState,
    performByName,
    performTechnique,
    canAffordTechnique,
    isTechniqueEffectivelyLearned,
    availableChakra,
    calculateChakraSpend,
    canPayChakra,
    payChakra,
    checkAndUpdateConditions,
    applyTechniqueBuff,
    findBuffByName,
    applyBuffToTarget,
    clearBuffLookupCache,
    listBuffs,
    clearAutomationBuffs,
    createBuffLookupFixture,
    createTargetActor,
    createToken,
    startCombatForActor,
    advanceCombatTurn,
    setTargetByActor,
    clearTargets,
    getSetting,
    setSetting,
    chatSince,
    now: () => Date.now(),
    forceNextRoll,
    withForcedRoll,
    spyNotifications,
    clearNotifications,
    expireActorEffects,
  };
  return mod.api;
}
