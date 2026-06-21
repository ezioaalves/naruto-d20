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
 *  [9] Foundry "ready"             → GM-only one-time migrations
 * [10] "pf1ActorRest"              → Restore chakra pool, clear temp, recover reserve
 */

import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "./constants.mjs";
import { buildPublicApi } from "./public-api.mjs";
import { BUFF_TARGETS, HERO_STAT_DEFAULTS, moduleFlagsPath } from "./flag-paths.mjs";
import { createTechniqueDataModel } from "./data/technique-model.mjs";
import { createTechniqueItemSheet } from "./ui/technique-sheet.mjs";
import { registerDamageTypes } from "./data/damage-types.mjs";
import { prepareBaseActorData, prepareDerivedActorData } from "./data/derived-data.mjs";
import { registerNarutoSkills, ensureActorSkillEntries } from "./data/skills.mjs";
import {
  installChakraTabPatch,
  installSynckitHeaderButton,
  installTechniqueGetChatDataPatch,
  installTechniqueGetDescriptionPatch,
} from "./ui/render-patch.mjs";
import { installTechniqueSaveDCPatch } from "./data/technique-save-dc.mjs";
import { installTechniqueRollDataPatch } from "./data/technique-rolldata.mjs";
import { registerLearnCheckListeners } from "./ui/learn-checks.mjs";
import { registerLearnCardContextMenu } from "./learn-technique.mjs";
import { registerMasterCardContextMenu } from "./master-technique.mjs";
import { registerNarutoRollContextMenu } from "./chat-rerolls.mjs";
import { registerTechniqueListListeners } from "./ui/technique-list.mjs";
import { registerSummaryStats, registerActorSettings } from "./ui/summary-stats.mjs";
import { registerFeatListListeners } from "./ui/feat-list.mjs";
import { registerFeatGrantDeletion } from "./automation/feat-grants.mjs";
import {
  registerOccupationAutoApply,
  registerOccupationAutoRevert,
} from "./automation/occupation-grants.mjs";
import { registerChargeDefensePenalty } from "./automation/charge-defense.mjs";
import { registerTurnMaintenance } from "./automation/turn-maintenance.mjs";
import { registerElementDamage } from "./automation/maintenance-element-damage.mjs";
import { registerRankRollData } from "./automation/rank-rolldata.mjs";
import { registerStrengthRankCombat } from "./automation/strength-rank-combat.mjs";
import { registerSpeedRankAttack } from "./automation/speed-rank-attack.mjs";
import { registerAttackNoManeuver } from "./automation/attack-no-maneuver.mjs";
import { registerTrainingWeightCarryPatch } from "./automation/training-weight-carry.mjs";
import { registerRankGrantConfig } from "./ui/rank-grant-config.mjs";
import { registerTapReservesListener } from "./ui/tap-reserves.mjs";
import { onActorRest } from "./data/rest-recovery.mjs";
import {
  registerChakraConditionCombatHooks,
  registerChakraConditions,
} from "./data/chakra-conditions.mjs";
import {
  MAINTENANCE_MIGRATION_SETTING,
  runMaintenanceMigrations,
} from "./data/maintenance-migration.mjs";

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
    `modules/${MODULE_ID}/templates/item/technique-header.hbs`,
    `modules/${MODULE_ID}/templates/item/rank-grant-config.hbs`,
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

  game.settings.register(MODULE_ID, MAINTENANCE_MIGRATION_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });
});

// ── [2] pf1PostInit ───────────────────────────────────────────────────────
Hooks.once("pf1PostInit", () => {
  _registerBuffTargets();
  CONFIG.PF1.weaponGroups.ninWeapons = { label: "Nin Weapons" };
  CONFIG.PF1.weaponProficiencies.ninWeapons = "NarutoD20.WeaponProficiency.ninWeapons";
  CONFIG.PF1.weaponTypes.ninWeapons = {
    _label: "NarutoD20.WeaponType.ninWeapons",
    light: "PF1.WeaponSubtypeLight",
    "1h": "PF1.WeaponSubtypeOneHanded",
    "2h": "PF1.WeaponSubtypeTwoHanded",
    ranged: "PF1.WeaponSubtypeRanged",
  };
  CONFIG.PF1.weaponProficiencies.archaicWeapons = "NarutoD20.WeaponProficiency.archaicWeapons";
  CONFIG.PF1.weaponTypes.archaicWeapons = {
    _label: "NarutoD20.WeaponType.archaicWeapons",
    light: "PF1.WeaponSubtypeLight",
    "1h": "PF1.WeaponSubtypeOneHanded",
    "2h": "PF1.WeaponSubtypeTwoHanded",
    ranged: "PF1.WeaponSubtypeRanged",
  };
  CONFIG.PF1.weaponProficiencies.exoticWeapons = "NarutoD20.WeaponProficiency.exoticWeapons";
  CONFIG.PF1.weaponTypes.exoticWeapons = {
    _label: "NarutoD20.WeaponType.exoticWeapons",
    light: "PF1.WeaponSubtypeLight",
    "1h": "PF1.WeaponSubtypeOneHanded",
    "2h": "PF1.WeaponSubtypeTwoHanded",
    ranged: "PF1.WeaponSubtypeRanged",
  };
  registerNarutoSkills();
  _registerScriptCallCategories();
  installTechniqueSaveDCPatch();
  installTechniqueRollDataPatch();
  registerStrengthRankCombat();
  registerSpeedRankAttack();
  registerAttackNoManeuver();
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
  registerChakraConditionCombatHooks(); // combat end -> apply delayed Low Reserve fatigue
  installChakraTabPatch(); // _renderInner wrap — must run before first render
  installSynckitHeaderButton(); // _getHeaderButtons wrap — "Sync Techniques" title-bar button
  installTechniqueGetChatDataPatch(); // inject "Chakra Resistance" into item summary properties
  installTechniqueGetDescriptionPatch(); // prepend technique stat-block header into chat card / item summary
  registerLearnCheckListeners(); // .shinobi-roll + learn-check tooltips + chakra max tooltips
  registerLearnCardContextMenu(); // learn chat card → right-click "Add Action Point"
  registerMasterCardContextMenu(); // mastery chat card → right-click "Add Action Point"
  registerNarutoRollContextMenu(); // Naruto d20 cards → AP / reroll context menu
  registerTechniqueListListeners(); // chakra tab: filter, drop zone, CRUD
  registerSummaryStats(); // Hero Statistics block on the Summary tab
  registerActorSettings(); // Has Chakra toggle in the Settings tab
  registerFeatListListeners(); // Naruto Browse button on the Features tab
  registerFeatGrantDeletion(); // cascade-delete feat supplements on feat removal
  registerOccupationAutoApply(); // occupation drop → prompt + apply grants
  registerOccupationAutoRevert(); // occupation delete → reverse wealth/reputation
  registerChargeDefensePenalty(); // PF1e charge attack AC penalty until next turn
  registerTurnMaintenance(); // start-of-turn maintenance + spent-buff cleanup
  registerElementDamage(); // type configured maintenance-element attack damage at roll time
  registerRankRollData(); // KOUSOKU/JOURYOKU effective rank (paid/temp/bonus + armor/condition penalties)
  registerTrainingWeightCarryPatch(); // subtract ignored Training Weight mass from encumbrance
  registerRankGrantConfig(); // "Naruto Rank" grant section on PF1e buff sheets
  registerTapReservesListener(); // Chakra Reserve header → Tap Reserves dialog
});

// Publish stable public API for downstream modules after all internal hooks are wired.
Hooks.once("setup", () => {
  game.modules.get(MODULE_ID).api = buildPublicApi();
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

// ── [9] ready ────────────────────────────────────────────────────────────
Hooks.once("ready", async () => {
  await runMaintenanceMigrations();
});

// ── [10] pf1ActorRest ────────────────────────────────────────────────────
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
