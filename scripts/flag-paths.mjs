import { MODULE_ID } from "./constants.mjs";

// ── Learn check flag paths ───────────────────────────────────────────────
export const learnBuffPath = (k) => `flags.${MODULE_ID}.learn.${k}.buffBonus`;
export const learnMiscPath = (k) => `flags.${MODULE_ID}.learn.${k}.miscBonus`;

// ── Chakra resource flag paths ───────────────────────────────────────────
export const chakraPoolMaxBonusPath    = `flags.${MODULE_ID}.chakra.pool.maxBonus`;
export const chakraReserveMaxBonusPath = `flags.${MODULE_ID}.chakra.reserve.maxBonus`;
export const chakraPoolValuePath       = `flags.${MODULE_ID}.chakra.pool.value`;
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
};
