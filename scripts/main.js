/**
 * Naruto D20 — Main Entry Point
 *
 * Hook lifecycle ordering:
 *  [1] Foundry "init"     → Register CONFIG.Item.dataModels (before documents are parsed)
 *  [2] "pf1PostInit"      → Register skills, buffTargets, derived data, pipeline hooks
 *                           (CONFIG.PF1 is now set; fires BEFORE i18nInit so labels get localized)
 *  [3] Foundry "setup"    → Push Chakra tab into actor sheet TABS arrays
 *  [4] "pf1PostReady"     → Inject actor flags (game.actors is now populated)
 */

import { registerDerivedDataWrapper } from "./data/derived-data.mjs";
import { registerChakraTab } from "./ui/chakra-tab.mjs";
import { registerSummaryStats } from "./ui/summary-stats.mjs";

// ── [1] Foundry "init" ────────────────────────────────────────────────────
// Use ONLY for CONFIG.Item/Actor.dataModels registration.
Hooks.once("init", () => {
    console.log("Naruto D20 | init: Module loaded.");
});

// ── [2] pf1PostInit ───────────────────────────────────────────────────────
// CONFIG.PF1 is now populated. This fires BEFORE i18nInit, so our custom
// labels are included in PF1e's localization pass.
Hooks.once("pf1PostInit", () => {
    console.log("Naruto D20 | pf1PostInit: Registering buffTargets and hooks.");

    _registerBuffTargets();
    registerDerivedDataWrapper();
});


// ── pf1GetChangeFlat ──────────────────────────────────────────────────────
// Registered at top-level (safe anytime before the hook fires).
Hooks.on("pf1GetChangeFlat", (result, target) => {
    if (target === "chakraPool")   result.push("flags.naruto-d20.chakra.pool.maxBonus");
    if (target === "chakraReserve") result.push("flags.naruto-d20.chakra.reserve.maxBonus");
    if (target === "learnCkc") result.push("flags.naruto-d20.learn.ckc.buffBonus");
    if (target === "learnGnj") result.push("flags.naruto-d20.learn.gnj.buffBonus");
    if (target === "learnNin") result.push("flags.naruto-d20.learn.nin.buffBonus");
    if (target === "learnTai") result.push("flags.naruto-d20.learn.tai.buffBonus");
    if (target === "learnFui") result.push("flags.naruto-d20.learn.fui.buffBonus");
});

// ── pf1RegisterDamageTypes ────────────────────────────────────────────────
Hooks.once("pf1RegisterDamageTypes", (registry) => {
    console.log("Naruto D20 | Registering custom damage types.");
    const damageTypes = [
        { id: "earth", name: "Earth", category: "energy", resist: true, color: "brown",  icon: "pf-icon pf-stone-block" },
        { id: "water", name: "Water", category: "energy", resist: true, color: "blue",   icon: "pf-icon pf-water-drop" },
        { id: "wind",  name: "Wind",  category: "energy", resist: true, color: "gray",   icon: "pf-icon pf-wind-hole" },
        { id: "holy",  name: "Holy",  category: "energy", resist: true, color: "gold",   icon: "pf-icon pf-sunbeams" }
    ];
    for (const dt of damageTypes) {
        try {
            registry.register("naruto-d20", dt.id, {
                name: dt.name, category: dt.category,
                resist: dt.resist, color: dt.color, icon: dt.icon
            });
        } catch (err) {
            console.error(`Naruto D20 | Failed to register damage type "${dt.id}":`, err);
        }
    }
});

// ── [3] Foundry "setup" ───────────────────────────────────────────────────
// PF1e sheet classes are registered; safe to push Chakra tab into TABS.
Hooks.once("setup", () => {
    console.log("Naruto D20 | setup: Registering Chakra tab and UI components.");

    // Push Chakra tab into all standard actor sheet TABS arrays.
    try {
        const sheetClasses = [
            pf1.applications.actor.abstract?.BaseCharacterSheetPF,
            pf1.applications.actor.CharacterSheetPF,
            pf1.applications.actor.NPCSheetPF,
            pf1.applications.actor.NPCSheetLitePF
        ].filter(Boolean);

        for (const cls of sheetClasses) {
            if (cls.TABS?.primary?.tabs) {
                if (!cls.TABS.primary.tabs.find(t => t.id === "chakra")) {
                    cls.TABS.primary.tabs.push({ id: "chakra", label: "Chakra" });
                }
            }
        }
    } catch (err) {
        console.error("Naruto D20 | Error during Chakra tab registration:", err);
    }

    // Register renderActorSheetPF hook listeners for tab content and summary stats.
    registerChakraTab();
    registerSummaryStats();
});

// ── [4] pf1PostReady ──────────────────────────────────────────────────────
// game.actors is guaranteed to be populated at this point.
Hooks.once("pf1PostReady", async () => {
    console.log("Naruto D20 | pf1PostReady: Injecting actor flags.");
    await _injectAllActorFlags();
});

// ─────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────


/**
 * Register custom buff target categories and targets into CONFIG.PF1.
 * Must be called during pf1PostInit.
 */
function _registerBuffTargets() {
    if (!CONFIG.PF1) {
        console.error("Naruto D20 | CONFIG.PF1 is not available. Buff target registration skipped.");
        return;
    }

    CONFIG.PF1.buffTargetCategories.chakra = { label: "Chakra" };

    Object.assign(CONFIG.PF1.buffTargets, {
        chakraPool:    { label: "Chakra Pool Max",          category: "chakra", sort: 90000 },
        chakraReserve: { label: "Chakra Reserve Max",       category: "chakra", sort: 90001 },
        learnCkc:      { label: "Learn: Chakra Control",    category: "chakra", sort: 90002 },
        learnGnj:      { label: "Learn: Genjutsu",          category: "chakra", sort: 90003 },
        learnNin:      { label: "Learn: Ninjutsu",          category: "chakra", sort: 90004 },
        learnTai:      { label: "Learn: Taijutsu",          category: "chakra", sort: 90005 },
        learnFui:      { label: "Learn: Fuinjutsu",         category: "chakra", sort: 90006 }
    });
    console.log("Naruto D20 | Custom buff targets registered.");
}

/**
 * Inject default Naruto flags into all world actors that are missing them.
 * NOTE: Do NOT write to system.skills.* — PF1e auto-populates skill data
 * for any key in CONFIG.PF1.skills. Writing raw objects there causes
 * the skill name to display as "[object Object]".
 */
async function _injectAllActorFlags() {
    const injectFlags = async (actor) => {
        if (!actor || !["character", "npc"].includes(actor.type)) return;

        const updateData = {};

        // Ensure top-level Naruto summary flags
        for (const flag of ["actionPoints", "reputation", "wealth"]) {
            if (foundry.utils.getProperty(actor, `flags.naruto-d20.${flag}`) === undefined) {
                updateData[`flags.naruto-d20.${flag}`] = 0;
            }
        }

        if (!foundry.utils.isEmpty(updateData)) {
            console.log(`Naruto D20 | Injecting flags for actor: ${actor.name}`);
            await actor.update(updateData);
        }
    };

    for (const actor of game.actors) {
        await injectFlags(actor);
    }

    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.actor && !token.actorLink) {
                await injectFlags(token.actor);
            }
        }
    }
}
