/**
 * Naruto D20 — Main Entry Point
 *
 * Hook lifecycle ordering:
 *  [1] Foundry "init"              → Register DataModel, item sheet, world settings
 *  [2] "pf1PostInit"               → Register buffTargets (CONFIG.PF1 is now set)
 *  [3] "pf1PrepareBaseActorData"   → Init flag schema + reset computed fields
 *  [4] "pf1GetChangeFlat"          → Map buff targets to flag paths (changes engine)
 *  [5] "pf1PrepareDerivedActorData"→ Compute all Shinobi statistics
 *  [6] "pf1RegisterDamageTypes"    → Register elemental damage types
 *  [7] Foundry "setup"             → Push Chakra tab, register UI hooks
 *  [8] "preCreateActor"            → Seed default flags on new actors
 *  [9] Foundry "ready"             → One-time flag migration for existing actors (GM only)
 */

import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "./constants.mjs";
import { BUFF_TARGETS } from "./flag-paths.mjs";
import { createTechniqueDataModel } from "./data/technique-model.mjs";
import { createTechniqueItemSheet } from "./ui/technique-sheet.mjs";
import { registerDamageTypes } from "./data/damage-types.mjs";
import { prepareBaseActorData, prepareDerivedActorData } from "./data/derived-data.mjs";
import { registerNarutoSkills, ensureActorSkillEntries } from "./data/skills.mjs";
import { installChakraTabPatch } from "./ui/render-patch.mjs";
import { registerLearnCheckListeners } from "./ui/learn-checks.mjs";
import { registerTechniqueListListeners } from "./ui/technique-list.mjs";
import { registerSummaryStats } from "./ui/summary-stats.mjs";

const FLAG_MIGRATION_VERSION = 2;

// ── [1] init ──────────────────────────────────────────────────────────────
Hooks.once("init", () => {
    const TechniqueDataModel  = createTechniqueDataModel();
    const TechniqueItemSheet  = createTechniqueItemSheet();

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
        `modules/${MODULE_ID}/templates/item/technique-sheet.hbs`,
    ]);

    // Namespaced equality helper for this module's templates — avoids colliding
    // with a generic `eq` another module might register with different semantics.
    Handlebars.registerHelper("nd20-eq", (a, b) => a === b);

    game.settings.register(MODULE_ID, "flagMigrationVersion", {
        scope: "world",
        config: false,
        type: Number,
        default: 0
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
            manualAlways:     "Always prompt manually",
            off:              "Off",
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
});

// ── [2] pf1PostInit ───────────────────────────────────────────────────────
Hooks.once("pf1PostInit", () => {
    _registerBuffTargets();
    registerNarutoSkills();
    _registerScriptCallCategories();
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
    installChakraTabPatch();           // _renderInner wrap — must run before first render
    registerLearnCheckListeners();     // .shinobi-roll + learn-check tooltips
    registerTechniqueListListeners();  // chakra tab: filter, drop zone, CRUD
    registerSummaryStats();            // Hero Statistics block on the Summary tab
});

// ── [8] preCreateActor ────────────────────────────────────────────────────
Hooks.on("preCreateActor", (doc, data) => {
    if (!["character", "npc"].includes(data.type)) return;
    const existing = data.flags?.[MODULE_ID] ?? {};
    const patch = {};
    for (const key of ["actionPoints", "reputation", "wealth"]) {
        if (existing[key] === undefined) patch[key] = 0;
    }
    if (!foundry.utils.isEmpty(patch)) {
        doc.updateSource({ [`flags.${MODULE_ID}`]: patch });
    }
});

// ── [9] ready — one-time migration ───────────────────────────────────────
Hooks.once("ready", async () => {
    if (!game.user.isGM) return;
    if (game.settings.get(MODULE_ID, "flagMigrationVersion") >= FLAG_MIGRATION_VERSION) return;
    await _migrateActorFlags();
    await game.settings.set(MODULE_ID, "flagMigrationVersion", FLAG_MIGRATION_VERSION);
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
    for (const [key, { label, sort }] of Object.entries(BUFF_TARGETS)) {
        CONFIG.PF1.buffTargets[key] = { label, category: "chakra", sort };
    }
}

async function _migrateActorFlags() {
    const migrate = async (actor) => {
        if (!["character", "npc"].includes(actor.type)) return;
        const updates = {};
        for (const key of ["actionPoints", "reputation", "wealth"]) {
            if (foundry.utils.getProperty(actor, `flags.${MODULE_ID}.${key}`) === undefined) {
                updates[`flags.${MODULE_ID}.${key}`] = 0;
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

