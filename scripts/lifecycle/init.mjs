import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../core/constants.mjs";
import { createTechniqueDataModel } from "../features/techniques/model.mjs";
import { createTechniqueItemSheet } from "../features/techniques/sheet.mjs";
import {
  MAINTENANCE_MIGRATION_SETTING,
} from "../data/maintenance-migration.mjs";

export function registerInitHook() {
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
}
