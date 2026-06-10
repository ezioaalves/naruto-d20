/**
 * Naruto D20 — Test API (the "test switch")
 *
 * This module is loaded ONLY when the hidden world setting `testMode` is on
 * (see main.mjs, `ready` hook). It publishes the module's internal rule
 * functions plus fixture/reset/determinism helpers on
 *   game.modules.get("naruto-d20").api
 * so the Playwright E2E suite (tests/e2e/) can drive the real rules headlessly
 * and assert on the resulting actor flags / conditions / chat — instead of
 * clicking fragile DOM.
 *
 * IMPORTANT: this file contains NO rule logic of its own. It only re-exports
 * the existing functions and adds thin orchestration (reset state, force a
 * roll, read snapshots). The single source of truth stays in the feature
 * modules.
 */

import {
  MODULE_ID,
  LOW_RESERVES_CONDITION_ID,
  CHAKRA_DEPLETION_CONDITION_ID,
  TECHNIQUE_ITEM_TYPE,
} from "../constants.mjs";
import {
  chakraPoolValuePath,
  chakraPoolTempPath,
  chakraReserveValuePath,
  conditionAppliedFatiguedPath,
  conditionAppliedExhaustedPath,
} from "../flag-paths.mjs";
import { performTechnique, canAffordTechnique } from "../use-technique.mjs";
import {
  availableChakra,
  calculateChakraSpend,
  canPayChakra,
  payChakra,
} from "../data/chakra-spend.mjs";
import { checkAndUpdateConditions } from "../data/chakra-conditions.mjs";
import {
  applyTechniqueBuff,
  findBuffByName,
  applyBuffToTarget,
  clearBuffLookupCache,
} from "../automation/buff-application.mjs";
import { isTechniqueEffectivelyLearned } from "../learn-technique.mjs";
import { TapReservesDialog } from "../ui/tap-reserves.mjs";

// ── Determinism ────────────────────────────────────────────────────────────

/**
 * Foundry maps a uniform sample to a die face as `ceil((1 - randomUniform()) * faces)`
 * — i.e. a LOW sample yields a HIGH face (verified empirically: 0.025 → 20,
 * 0.975 → 1). To pin a d20 to `face`, sample the midpoint of its inverted band.
 */
function d20FaceToUniform(face) {
  return 1 - (face - 0.5) / 20;
}

/**
 * Run `fn` with the RNG pinned so every d20 rolled inside resolves to
 * `d20Face` (20 → guaranteed success, 1 → guaranteed failure for the QA's
 * "force success/failure" steps). When `actor` is given, its `rollSkill` is
 * temporarily forced to skipDialog so the perform check never opens the PF1e
 * skill-roll dialog. State is always restored in `finally`.
 */
export async function withForcedRoll(d20Face, fn, { actor = null } = {}) {
  const origRandom = CONFIG.Dice.randomUniform;
  CONFIG.Dice.randomUniform = () => d20FaceToUniform(d20Face);

  let restoreSkill = null;
  if (actor && typeof actor.rollSkill === "function") {
    const orig = actor.rollSkill.bind(actor);
    actor.rollSkill = (id, opts = {}) => orig(id, { ...opts, skipDialog: true });
    restoreSkill = () => {
      delete actor.rollSkill;
    };
  }

  try {
    return await fn();
  } finally {
    CONFIG.Dice.randomUniform = origRandom;
    if (restoreSkill) restoreSkill();
  }
}

// ── Notification spy ─────────────────────────────────────────────────────────

/**
 * Capture ui.notifications.{warn,error,info} calls during a test. Returns a
 * handle with the captured messages and a restore(). Used to assert the QA's
 * "aparece warning e nenhum valor muda" expectations without scraping the UI.
 */
export function spyNotifications() {
  const captured = { warn: [], error: [], info: [], all: [] };
  const methods = ["warn", "error", "info"];
  const originals = {};

  for (const m of methods) {
    originals[m] = ui.notifications[m].bind(ui.notifications);
    ui.notifications[m] = (msg, ...rest) => {
      captured[m].push(msg);
      captured.all.push({ type: m, msg });
      return originals[m](msg, ...rest);
    };
  }

  return {
    captured,
    warnings: captured.warn,
    restore() {
      for (const m of methods) ui.notifications[m] = originals[m];
    },
  };
}

// ── Actor / fixture helpers ──────────────────────────────────────────────────

function getActor(name = "Ikazuchi") {
  // Exact match first, then a tolerant substring match so a short alias like
  // "Ikazuchi" resolves "Dattoumaru Ikazuchi".
  const actor =
    game.actors.getName(name) ??
    game.actors.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
  if (!actor) throw new Error(`naruto-d20 test-api: actor "${name}" not found`);
  return actor;
}

function getChakra(actor) {
  const c = actor.flags?.[MODULE_ID]?.chakra ?? {};
  return {
    pool: {
      value: c.pool?.value ?? 0,
      temp: c.pool?.temp ?? 0,
      max: c.pool?.max ?? 0,
      maxBonus: c.pool?.maxBonus ?? 0,
    },
    reserve: {
      value: c.reserve?.value ?? 0,
      max: c.reserve?.max ?? 0,
      maxBonus: c.reserve?.maxBonus ?? 0,
    },
    nature: c.nature ?? { primary: "", secondary: [] },
    available: availableChakra(actor),
  };
}

function getLearn(actor) {
  const learn = actor.flags?.[MODULE_ID]?.learn ?? {};
  const out = {};
  for (const [k, v] of Object.entries(learn)) {
    out[k] = { total: v?.total ?? 0, base: v?.base ?? 0, buffBonus: v?.buffBonus ?? 0 };
  }
  return out;
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

/**
 * Put an actor in a known chakra state and clear any condition the module may
 * have left behind, so each test starts isolated regardless of run order.
 *
 * state: { pool, temp, reserve } — omitted fields default to the derived max
 * (pool/reserve) or 0 (temp).
 */
async function resetActor(actor, state = {}) {
  const chakra = actor.flags?.[MODULE_ID]?.chakra ?? {};
  await actor.update({
    [chakraPoolValuePath]: state.pool ?? chakra.pool?.max ?? 0,
    [chakraPoolTempPath]: state.temp ?? 0,
    [chakraReserveValuePath]: state.reserve ?? chakra.reserve?.max ?? 0,
    [conditionAppliedFatiguedPath]: false,
    [conditionAppliedExhaustedPath]: false,
  });

  // Force-clear both module conditions and their implied PF1e conditions so a
  // leftover from a previous test never poisons the next one.
  await actor.setConditions({
    [LOW_RESERVES_CONDITION_ID]: false,
    [CHAKRA_DEPLETION_CONDITION_ID]: false,
    fatigued: false,
    exhausted: false,
  });

  // Re-derive conditions from the freshly written reserve value.
  await checkAndUpdateConditions(actor);
  return getChakra(actor);
}

/** Directly set a condition's tracking + presence (for the "we didn't apply it" QA case). */
async function setCondition(actor, id, active) {
  await actor.setConditions({ [id]: active });
}

async function setAbility(actor, key, value) {
  await actor.update({ [`system.abilities.${key}.value`]: value });
  return { mod: actor.system.abilities?.[key]?.mod ?? 0 };
}

// ── Technique helpers ────────────────────────────────────────────────────────

function getTechnique(actor, name) {
  return actor.items.find((i) => i.type === TECHNIQUE_ITEM_TYPE && i.name === name) ?? null;
}

function listTechniques(actor) {
  return actor.items
    .filter((i) => i.type === TECHNIQUE_ITEM_TYPE)
    .map((i) => ({
      id: i.id,
      name: i.name,
      learned: isTechniqueEffectivelyLearned(i),
      chakraCost: i.system?.chakraCost ?? 0,
      automation: i.system?.automation ?? null,
      firstActionId: firstActionId(i),
    }));
}

function firstActionId(item) {
  const actions = item?.actions;
  if (!actions) return null;
  const first = actions.contents?.[0] ?? Array.from(actions)[0];
  return first?.id ?? null;
}

/**
 * Perform a technique by actor + technique name. Forces the perform-check
 * d20 to `forceRoll` (default 20 = success) and skips the skill dialog. The
 * action itself is used with PF1e's own skipDialog path, so this is safe only
 * for techniques without an attack/damage dialog (the core QA set).
 */
async function performByName(actor, techniqueName, { forceRoll = 20, actionId } = {}) {
  const item = getTechnique(actor, techniqueName);
  if (!item) throw new Error(`Technique "${techniqueName}" not on ${actor.name}`);
  const aId = actionId ?? firstActionId(item);
  const spy = spyNotifications();
  try {
    await withForcedRoll(forceRoll, () => performTechnique(item, aId), { actor });
  } finally {
    spy.restore();
  }
  return { chakra: getChakra(actor), conditions: getConditions(actor), warnings: spy.warnings };
}

// ── Tap Reserves ─────────────────────────────────────────────────────────────

/**
 * Drive the real TapReservesDialog headlessly: render it, fill the amount +
 * seal into its live DOM, pin the d20, then click its Roll button. This keeps
 * the dialog's own validation + rule logic as the single source of truth.
 */
async function tapReserves(actor, { amount, seal = "none", forceRoll = 20 } = {}) {
  const spy = spyNotifications();
  const dialog = new TapReservesDialog(actor);
  await dialog._render(true);
  const html = dialog.element;

  try {
    html.find(".tap-amount").val(String(amount)).trigger("change");
    if (seal !== "none") {
      html.find(`[name='seal-type'][value='${seal}']`).prop("checked", true).trigger("change");
    }
    await withForcedRoll(forceRoll, async () => {
      await dialog._onRoll(html);
    });
  } finally {
    spy.restore();
    if (!dialog._state || dialog.rendered) await dialog.close({ force: true }).catch(() => {});
  }

  return { chakra: getChakra(actor), conditions: getConditions(actor), warnings: spy.warnings };
}

// ── Buffs ────────────────────────────────────────────────────────────────────

function listBuffs(actor) {
  return actor.items
    .filter((i) => i.type === "buff")
    .map((i) => ({
      id: i.id,
      name: i.name,
      active: i.system?.active ?? false,
      sourceId: i.flags?.[MODULE_ID]?.sourceId ?? null,
      duration: i.system?.duration ?? null,
    }));
}

/** Remove every buff this module's automation created on the actor (test cleanup). */
async function clearAutomationBuffs(actor) {
  const ids = actor.items
    .filter((i) => i.type === "buff" && i.flags?.[MODULE_ID]?.sourceId)
    .map((i) => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  return ids.length;
}

/** Target a token by the actor it represents (best-effort; needs a token on the canvas). */
function setTargetByActor(actor) {
  const token = actor.getActiveTokens?.()[0];
  if (!token) return false;
  token.setTarget(true, { releaseOthers: true });
  return true;
}

function clearTargets() {
  for (const t of [...(game.user?.targets ?? [])]) t.setTarget(false, { releaseOthers: false });
}

// ── Settings / chat ──────────────────────────────────────────────────────────

const getSetting = (key) => game.settings.get(MODULE_ID, key);
const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);

function chatSince(timestamp) {
  return game.messages.contents
    .filter((m) => m.timestamp >= timestamp)
    .map((m) => ({ content: m.content, flavor: m.flavor, speaker: m.speaker }));
}

const now = () => Date.now();

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Install the test API onto the module record. Idempotent. Called from the
 * `ready` hook in main.mjs only when `testMode` is enabled.
 */
export function installTestApi() {
  const mod = game.modules.get(MODULE_ID);
  if (!mod) return;

  mod.api = {
    // marker so the harness can wait for readiness
    ready: true,
    MODULE_ID,

    // fixtures / state
    getActor,
    resetActor,
    getChakra,
    getLearn,
    getConditions,
    setCondition,
    setAbility,

    // techniques
    getTechnique,
    listTechniques,
    firstActionId,
    performByName,
    performTechnique,
    canAffordTechnique,
    isTechniqueEffectivelyLearned,

    // chakra rules (pure)
    availableChakra,
    calculateChakraSpend,
    canPayChakra,
    payChakra,
    checkAndUpdateConditions,

    // tap reserves
    tapReserves,

    // buffs
    applyTechniqueBuff,
    findBuffByName,
    applyBuffToTarget,
    clearBuffLookupCache,
    listBuffs,
    clearAutomationBuffs,
    setTargetByActor,
    clearTargets,

    // settings / chat / determinism
    getSetting,
    setSetting,
    chatSince,
    now,
    withForcedRoll,
    spyNotifications,
  };

  console.log("naruto-d20 | Test API installed on game.modules.get('naruto-d20').api");
}
