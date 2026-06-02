/**
 * Naruto D20 — Main Entry Point
 *
 * Hook lifecycle ordering:
 *  [1] Foundry "init"              → Register DataModel, item sheet, world settings
 *  [2] "pf1PostInit"               → Register buffTargets (CONFIG.PF1 is now set); register chakra conditions
 *  [3] "pf1PrepareBaseActorData"   → Init flag schema + reset computed fields
 *  [4] "pf1GetChangeFlat"          → Map buff targets to flag paths (changes engine)
 *  [5] "pf1PrepareDerivedActorData"→ Compute all Shinobi statistics
 *  [6] "pf1RegisterDamageTypes"    → Register elemental damage types
 *  [7] Foundry "setup"             → Push Chakra tab, register UI hooks
 *  [8] "preCreateActor"            → Seed default flags on new actors
 *  [9] Foundry "ready"             → One-time flag migration for existing actors (GM only)
 * [10] "pf1ActorRest"              → Restore chakra pool, clear temp, recover reserve
 */

import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "./constants.mjs";
import { BUFF_TARGETS, HERO_STAT_DEFAULTS, moduleFlagsPath } from "./flag-paths.mjs";
import { createTechniqueDataModel } from "./data/technique-model.mjs";
import { createTechniqueItemSheet } from "./ui/technique-sheet.mjs";
import { registerDamageTypes } from "./data/damage-types.mjs";
import { normalizeActionIds } from "./data/action-ids.mjs";
import { prepareBaseActorData, prepareDerivedActorData } from "./data/derived-data.mjs";
import { registerNarutoSkills, ensureActorSkillEntries } from "./data/skills.mjs";
import { installChakraTabPatch, installSynckitHeaderButton } from "./ui/render-patch.mjs";
import { installTechniqueSaveDCPatch } from "./data/technique-save-dc.mjs";
import { installTechniqueRollDataPatch } from "./data/technique-rolldata.mjs";
import { registerLearnCheckListeners } from "./ui/learn-checks.mjs";
import { registerLearnCardContextMenu } from "./learn-technique.mjs";
import { registerTechniqueListListeners } from "./ui/technique-list.mjs";
import { registerSummaryStats } from "./ui/summary-stats.mjs";
import { registerFeatListListeners } from "./ui/feat-list.mjs";
import { registerFeatGrantDeletion } from "./automation/feat-grants.mjs";
import { registerChargeDefensePenalty } from "./automation/charge-defense.mjs";
import { registerExpiredBuffCleanup } from "./automation/buff-expiry.mjs";
import { registerTapReservesListener } from "./ui/tap-reserves.mjs";
import { onActorRest } from "./data/rest-recovery.mjs";
import { registerChakraConditions } from "./data/chakra-conditions.mjs";

const FLAG_MIGRATION_VERSION = 5;

// ── [1] init ──────────────────────────────────────────────────────────────
Hooks.once("init", () => {
  const TechniqueDataModel = createTechniqueDataModel();
  const TechniqueItemSheet = createTechniqueItemSheet();

  CONFIG.Item.dataModels[TECHNIQUE_ITEM_TYPE] = TechniqueDataModel;

  // Route technique items through ItemPF (not the ItemBasePF fallback) so
  // they get item.actions, item.scriptCalls, _prepareActions(), etc.
  if (pf1?.documents?.item?.ItemPF) {
    CONFIG.Item.documentClasses ??= {};
    CONFIG.Item.documentClasses[TECHNIQUE_ITEM_TYPE] = pf1.documents.item.ItemPF;
  }

  Items.registerSheet(MODULE_ID, TechniqueItemSheet, {
    types: [TECHNIQUE_ITEM_TYPE],
    makeDefault: true,
    label: "Naruto D20 Technique Sheet",
  });

  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/actor/chakra-tab.hbs`,
    `modules/${MODULE_ID}/templates/actor/summary-stats.hbs`,
    `modules/${MODULE_ID}/templates/actor/tap-reserves-dialog.hbs`,
    `modules/${MODULE_ID}/templates/item/technique-sheet.hbs`,
    `modules/${MODULE_ID}/templates/actor/technique-synckit.hbs`,
    `modules/${MODULE_ID}/templates/apps/technique-browser.hbs`,
    `modules/${MODULE_ID}/templates/apps/feat-browser.hbs`,
    `modules/${MODULE_ID}/templates/chat/technique-perform.hbs`,
    `modules/${MODULE_ID}/templates/chat/learning-result.hbs`,
  ]);

  // Namespaced equality helper for this module's templates — avoids colliding
  // with a generic `eq` another module might register with different semantics.
  Handlebars.registerHelper("nd20-eq", (a, b) => a === b);
  Handlebars.registerHelper("nd20-chakra-nature-label", (value) =>
    game.i18n.localize(`NarutoD20.ChakraNature.${String(value ?? "").trim() || "None"}`),
  );

  game.settings.register(MODULE_ID, "flagMigrationVersion", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.register(MODULE_ID, "automaticBuffs", {
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    name: "NarutoD20.Settings.AutomaticBuffs.Name",
    hint: "NarutoD20.Settings.AutomaticBuffs.Hint",
  });

  game.settings.register(MODULE_ID, "buffTargetFiltering", {
    scope: "world",
    config: true,
    type: String,
    default: "respectTechnique",
    choices: {
      respectTechnique: "Respect technique setting",
      manualAlways: "Always prompt manually",
      off: "Off",
    },
    name: "NarutoD20.Settings.BuffTargetFiltering.Name",
  });

  game.settings.register(MODULE_ID, "customBuffCompendia", {
    scope: "world",
    config: true,
    type: String,
    default: "",
    name: "NarutoD20.Settings.CustomBuffCompendia.Name",
    hint: "NarutoD20.Settings.CustomBuffCompendia.Hint",
  });

  game.settings.register(MODULE_ID, "enforceLearning", {
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    name: "NarutoD20.Settings.EnforceLearning.Name",
    hint: "NarutoD20.Settings.EnforceLearning.Hint",
  });

  game.settings.register(MODULE_ID, "learningProgressionMode", {
    scope: "world",
    config: true,
    type: String,
    default: "standard",
    choices: {
      standard: "NarutoD20.Settings.LearningProgressionMode.Standard",
      fourHourBlocks: "NarutoD20.Settings.LearningProgressionMode.FourHourBlocks",
    },
    name: "NarutoD20.Settings.LearningProgressionMode.Name",
    hint: "NarutoD20.Settings.LearningProgressionMode.Hint",
  });

  game.settings.register(MODULE_ID, "learnMarginInclusive", {
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    name: "NarutoD20.Settings.LearnMarginInclusive.Name",
    hint: "NarutoD20.Settings.LearnMarginInclusive.Hint",
  });

  game.settings.register(MODULE_ID, "deductLearningChakra", {
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    name: "NarutoD20.Settings.DeductLearningChakra.Name",
    hint: "NarutoD20.Settings.DeductLearningChakra.Hint",
  });
});

// ── [2] pf1PostInit ───────────────────────────────────────────────────────
Hooks.once("pf1PostInit", () => {
  _registerBuffTargets();
  registerNarutoSkills();
  _registerScriptCallCategories();
  installTechniqueSaveDCPatch();
  installTechniqueRollDataPatch();
  registerChakraConditions();
});

// ── [3] pf1PrepareBaseActorData ───────────────────────────────────────────
Hooks.on("pf1PrepareBaseActorData", (actor) => {
  prepareBaseActorData(actor);
  ensureActorSkillEntries(actor);
});

// ── [4] pf1GetChangeFlat ──────────────────────────────────────────────────
Hooks.on("pf1GetChangeFlat", (result, target) => {
  const entry = BUFF_TARGETS[target];
  if (entry) result.push(entry.path);
});

// ── [5] pf1PrepareDerivedActorData ────────────────────────────────────────
Hooks.on("pf1PrepareDerivedActorData", (actor) => {
  prepareDerivedActorData(actor);
});

// ── [6] pf1RegisterDamageTypes ────────────────────────────────────────────
Hooks.once("pf1RegisterDamageTypes", registerDamageTypes);

// ── [7] setup ─────────────────────────────────────────────────────────────
Hooks.once("setup", () => {
  installChakraTabPatch(); // _renderInner wrap — must run before first render
  installSynckitHeaderButton(); // _getHeaderButtons wrap — "Sync Techniques" title-bar button
  registerLearnCheckListeners(); // .shinobi-roll + learn-check tooltips + chakra max tooltips
  registerLearnCardContextMenu(); // learn chat card → right-click "Add Action Point"
  registerTechniqueListListeners(); // chakra tab: filter, drop zone, CRUD
  registerSummaryStats(); // Hero Statistics block on the Summary tab
  registerFeatListListeners(); // Naruto Browse button on the Features tab
  registerFeatGrantDeletion(); // cascade-delete feat supplements on feat removal
  registerChargeDefensePenalty(); // PF1e charge attack AC penalty until next turn
  registerExpiredBuffCleanup(); // delete module automation buffs when their duration expires
  registerTapReservesListener(); // Chakra Reserve header → Tap Reserves dialog
});

// ── [8] preCreateActor ────────────────────────────────────────────────────
Hooks.on("preCreateActor", (doc, data) => {
  if (!["character", "npc"].includes(data.type)) return;
  const existing = data.flags?.[MODULE_ID] ?? {};
  const patch = {};
  for (const { key } of HERO_STAT_DEFAULTS) {
    if (existing[key] === undefined) patch[key] = 0;
  }
  if (!foundry.utils.isEmpty(patch)) {
    doc.updateSource({ [moduleFlagsPath]: patch });
  }
});

// ── [9] ready — one-time migration ───────────────────────────────────────
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, "flagMigrationVersion") >= FLAG_MIGRATION_VERSION) return;
  await _migrateActorFlags();
  await _migrateTechniqueActionIds();
  await _migrateExistingTechniquesLearned();
  await game.settings.set(MODULE_ID, "flagMigrationVersion", FLAG_MIGRATION_VERSION);
});

// ── [10] pf1ActorRest — chakra recovery on rest ──────────────────────────
Hooks.on("pf1ActorRest", (actor, options) => {
  onActorRest(actor, options);
});

// ─────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────

function _registerScriptCallCategories() {
  if (!pf1.registry?.scriptCalls) return;
  for (const catId of ["use", "postUse"]) {
    const cat = pf1.registry.scriptCalls.get(catId);
    if (cat && !cat.itemTypes.includes(TECHNIQUE_ITEM_TYPE)) {
      cat.itemTypes.push(TECHNIQUE_ITEM_TYPE);
    }
  }
}

function _registerBuffTargets() {
  if (!CONFIG.PF1) return;

  CONFIG.PF1.buffTargetCategories.chakra = { label: "Chakra" };
  CONFIG.PF1.buffTargetCategories.technique = {
    label: game.i18n.localize("NarutoD20.BuffTargets.Category"),
  };
  for (const [key, { label, sort, category = "chakra" }] of Object.entries(BUFF_TARGETS)) {
    CONFIG.PF1.buffTargets[key] = { label: game.i18n.localize(label), category, sort };
  }
}

async function _migrateActorFlags() {
  const migrate = async (actor) => {
    if (!["character", "npc"].includes(actor.type)) return;
    const updates = {};
    for (const { path } of HERO_STAT_DEFAULTS) {
      if (foundry.utils.getProperty(actor, path) === undefined) {
        updates[path] = 0;
      }
    }
    if (!foundry.utils.isEmpty(updates)) await actor.update(updates);
  };

  for (const actor of game.actors) await migrate(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actor && !token.actorLink) await migrate(token.actor);
    }
  }
}

async function _migrateTechniqueActionIds() {
  const migrateItem = async (item) => {
    if (item.type !== TECHNIQUE_ITEM_TYPE) return false;
    const { actions, changed } = normalizeActionIds(item.system?.actions);
    if (changed) await item.update({ "system.actions": actions });
    return changed;
  };

  const migrateActorItems = async (actor) => {
    const updates = [];
    for (const item of actor.items) {
      if (item.type !== TECHNIQUE_ITEM_TYPE) continue;
      const { actions, changed } = normalizeActionIds(item.system?.actions);
      if (changed) updates.push({ _id: item.id, "system.actions": actions });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  };

  for (const item of game.items) await migrateItem(item);
  for (const actor of game.actors) await migrateActorItems(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actor && !token.actorLink) await migrateActorItems(token.actor);
    }
  }
}

async function _migrateExistingTechniquesLearned() {
  const migrateActorItems = async (actor) => {
    if (!["character", "npc"].includes(actor.type)) return;
    const updates = [];
    for (const item of actor.items) {
      if (item.type !== TECHNIQUE_ITEM_TYPE) continue;
      updates.push({
        _id: item.id,
        "system.learning.learned": true,
        "system.learning.progress": Math.max(1, item.system?.derived?.successes ?? 1),
        "system.learning.attemptsUsed": item.system?.learning?.attemptsUsed ?? 0,
        "system.learning.failureInsight": 0,
        "system.learning.trainingBlocks": item.system?.learning?.trainingBlocks ?? 0,
        "system.learning.chakraSpent": item.system?.learning?.chakraSpent ?? 0,
        "system.learning.lastTrainingAt": item.system?.learning?.lastTrainingAt ?? 0,
      });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  };

  for (const actor of game.actors) await migrateActorItems(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actor && !token.actorLink) await migrateActorItems(token.actor);
    }
  }
}
