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

import { createTechniqueDataModel } from "./data/technique-model.mjs";
import { createTechniqueItemSheet } from "./ui/technique-sheet.mjs";
import { prepareBaseActorData, prepareDerivedActorData } from "./data/derived-data.mjs";
import { registerNarutoSkills, ensureActorSkillEntries } from "./data/skills.mjs";
import { registerChakraTab } from "./ui/chakra-tab.mjs";
import { registerSummaryStats } from "./ui/summary-stats.mjs";

const MODULE_ID = "naruto-d20";
const FLAG_MIGRATION_VERSION = 2;

// ── [1] init ──────────────────────────────────────────────────────────────
Hooks.once("init", () => {
    const TechniqueDataModel  = createTechniqueDataModel();
    const TechniqueItemSheet  = createTechniqueItemSheet();

    CONFIG.Item.dataModels["naruto-d20.technique"] = TechniqueDataModel;

    // Route technique items through ItemPF (not the ItemBasePF fallback) so
    // they get item.actions, item.scriptCalls, _prepareActions(), etc.
    if (pf1?.documents?.item?.ItemPF) {
        CONFIG.Item.documentClasses ??= {};
        CONFIG.Item.documentClasses["naruto-d20.technique"] = pf1.documents.item.ItemPF;
    }

    Items.registerSheet(MODULE_ID, TechniqueItemSheet, {
        types: ["naruto-d20.technique"],
        makeDefault: true,
        label: "Naruto D20 Technique Sheet",
    });

    foundry.applications.handlebars.loadTemplates([
        "modules/naruto-d20/templates/item/technique-sheet.hbs",
    ]);

    // Generic equality helper for the technique sheet templates.
    if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);

    game.settings.register(MODULE_ID, "flagMigrationVersion", {
        scope: "world",
        config: false,
        type: Number,
        default: 0
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
    if (target === "chakraPool")    result.push("flags.naruto-d20.chakra.pool.maxBonus");
    if (target === "chakraReserve") result.push("flags.naruto-d20.chakra.reserve.maxBonus");
    if (target === "learnCkc")      result.push("flags.naruto-d20.learn.ckc.buffBonus");
    if (target === "learnGnj")      result.push("flags.naruto-d20.learn.gnj.buffBonus");
    if (target === "learnNin")      result.push("flags.naruto-d20.learn.nin.buffBonus");
    if (target === "learnTai")      result.push("flags.naruto-d20.learn.tai.buffBonus");
    if (target === "learnFui")      result.push("flags.naruto-d20.learn.fui.buffBonus");
});

// ── [5] pf1PrepareDerivedActorData ────────────────────────────────────────
Hooks.on("pf1PrepareDerivedActorData", (actor) => {
    prepareDerivedActorData(actor);
});

// ── [6] pf1RegisterDamageTypes ────────────────────────────────────────────
Hooks.once("pf1RegisterDamageTypes", (registry) => {
    const damageTypes = [
        { id: "earth", name: "Earth", category: "energy", resist: true, color: "#8B5A2B", img: "modules/naruto-d20/icons/earth.svg" },
        { id: "water", name: "Water", category: "energy", resist: true, color: "#1E90FF", img: "modules/naruto-d20/icons/water.svg" },
        { id: "wind",  name: "Wind",  category: "energy", resist: true, color: "#87CEEB", img: "modules/naruto-d20/icons/wind.svg"  },
        { id: "holy",  name: "Holy",  category: "energy", resist: true, color: "#FFD700", img: "modules/naruto-d20/icons/holy.svg"  }
    ];
    for (const dt of damageTypes) {
        try {
            registry.register("naruto-d20", dt.id, {
                name: dt.name, category: dt.category,
                resist: dt.resist, color: dt.color, img: dt.img
            });
        } catch (err) {
            console.error(`Naruto D20 | Failed to register damage type "${dt.id}":`, err);
        }
    }
});

// ── [7] setup ─────────────────────────────────────────────────────────────
Hooks.once("setup", () => {
    registerChakraTab();
    registerSummaryStats();
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
        if (cat && !cat.itemTypes.includes("naruto-d20.technique")) {
            cat.itemTypes.push("naruto-d20.technique");
        }
    }
}

function _registerBuffTargets() {
    if (!CONFIG.PF1) return;

    CONFIG.PF1.buffTargetCategories.chakra = { label: "Chakra" };
    Object.assign(CONFIG.PF1.buffTargets, {
        chakraPool:    { label: "Chakra Pool Max",       category: "chakra", sort: 90000 },
        chakraReserve: { label: "Chakra Reserve Max",    category: "chakra", sort: 90001 },
        learnCkc:      { label: "Learn: Chakra Control", category: "chakra", sort: 90002 },
        learnGnj:      { label: "Learn: Genjutsu",       category: "chakra", sort: 90003 },
        learnNin:      { label: "Learn: Ninjutsu",       category: "chakra", sort: 90004 },
        learnTai:      { label: "Learn: Taijutsu",       category: "chakra", sort: 90005 },
        learnFui:      { label: "Learn: Fuinjutsu",      category: "chakra", sort: 90006 }
    });
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

