import { MODULE_ID } from "./constants.mjs";

// ── Hero statistics flag paths ──────────────────────────────────────────
export const actionPointsPath = `flags.${MODULE_ID}.actionPoints`;

// ── Learn check flag paths ───────────────────────────────────────────────
export const learnBuffPath = (k) => `flags.${MODULE_ID}.learn.${k}.buffBonus`;
export const learnMiscPath = (k) => `flags.${MODULE_ID}.learn.${k}.miscBonus`;

// ── Technique DC flag paths ──────────────────────────────────────────────
// k ∈ {"all","ckc","fui","gnj","nin","tai"}; "all" is the global bonus,
// the discipline keys are per-type bonuses (mirror of pf1's per-school spell DC).
export const techniqueDCBuffPath = (k) => `flags.${MODULE_ID}.techniqueDC.${k}.buffBonus`;

// ── Chakra resource flag paths ───────────────────────────────────────────
export const chakraPoolMaxBonusPath    = `flags.${MODULE_ID}.chakra.pool.maxBonus`;
export const chakraReserveMaxBonusPath = `flags.${MODULE_ID}.chakra.reserve.maxBonus`;
export const chakraPoolValuePath       = `flags.${MODULE_ID}.chakra.pool.value`;
export const chakraPoolTempPath        = `flags.${MODULE_ID}.chakra.pool.temp`;
export const chakraReserveValuePath    = `flags.${MODULE_ID}.chakra.reserve.value`;

/**
 * Single source of truth for pf1's changes-engine integration.
 *  - pf1GetChangeFlat            → reads `path` so the engine knows where to write
 *  - CONFIG.PF1.buffTargets       → reads `label` + `sort` for the buff selector UI
 *  - prepareBaseActorData reset   → reads `path` to zero the field before the engine runs
 *
 * Adding a new buff target = adding one entry here.
 */
export const BUFF_TARGETS = {
    chakraPool:    { label: "Chakra Pool Max",       path: chakraPoolMaxBonusPath,    sort: 90000 },
    chakraReserve: { label: "Chakra Reserve Max",    path: chakraReserveMaxBonusPath, sort: 90001 },
    learnCkc:      { label: "Learn: Chakra Control", path: learnBuffPath("ckc"),      sort: 90002 },
    learnGnj:      { label: "Learn: Genjutsu",       path: learnBuffPath("gnj"),      sort: 90003 },
    learnNin:      { label: "Learn: Ninjutsu",       path: learnBuffPath("nin"),      sort: 90004 },
    learnTai:      { label: "Learn: Taijutsu",       path: learnBuffPath("tai"),      sort: 90005 },
    learnFui:      { label: "Learn: Fuinjutsu",      path: learnBuffPath("fui"),      sort: 90006 },

    techDcAll:     { label: "NarutoD20.BuffTargets.TechDc.All", path: techniqueDCBuffPath("all"), sort: 90010, category: "technique" },
    techDcCkc:     { label: "NarutoD20.BuffTargets.TechDc.ckc", path: techniqueDCBuffPath("ckc"), sort: 90011, category: "technique" },
    techDcFui:     { label: "NarutoD20.BuffTargets.TechDc.fui", path: techniqueDCBuffPath("fui"), sort: 90012, category: "technique" },
    techDcGnj:     { label: "NarutoD20.BuffTargets.TechDc.gnj", path: techniqueDCBuffPath("gnj"), sort: 90013, category: "technique" },
    techDcNin:     { label: "NarutoD20.BuffTargets.TechDc.nin", path: techniqueDCBuffPath("nin"), sort: 90014, category: "technique" },
    techDcTai:     { label: "NarutoD20.BuffTargets.TechDc.tai", path: techniqueDCBuffPath("tai"), sort: 90015, category: "technique" },
};
