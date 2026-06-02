import { MODULE_ID } from "./constants.mjs";

export const moduleFlagsPath = `flags.${MODULE_ID}`;

// ── Hero statistics flag paths ──────────────────────────────────────────
export const heroStatPath = (key) => `${moduleFlagsPath}.${key}`;
export const actionPointsPath = heroStatPath("actionPoints");
export const reputationPath = heroStatPath("reputation");
export const wealthPath = heroStatPath("wealth");
export const epsPath = heroStatPath("eps");
export const HERO_STAT_DEFAULTS = [
  { key: "actionPoints", path: actionPointsPath },
  { key: "reputation", path: reputationPath },
  { key: "wealth", path: wealthPath },
  { key: "eps", path: epsPath },
];

// ── Learn check flag paths ───────────────────────────────────────────────
export const learnBuffPath = (k) => `${moduleFlagsPath}.learn.${k}.buffBonus`;
export const learnMiscPath = (k) => `${moduleFlagsPath}.learn.${k}.miscBonus`;
export const learningCurrentTechniqueIdPath = `${moduleFlagsPath}.learning.currentTechniqueId`;

// ── Technique DC flag paths ──────────────────────────────────────────────
// k ∈ {"all","ckc","fui","gnj","nin","tai"}; "all" is the global bonus,
// the discipline keys are per-type bonuses (mirror of pf1's per-school spell DC).
export const techniqueDCBuffPath = (k) => `${moduleFlagsPath}.techniqueDC.${k}.buffBonus`;

// ── Chakra resource flag paths ───────────────────────────────────────────
export const chakraPoolMaxBonusPath = `${moduleFlagsPath}.chakra.pool.maxBonus`;
export const chakraReserveMaxBonusPath = `${moduleFlagsPath}.chakra.reserve.maxBonus`;
export const chakraPoolValuePath = `${moduleFlagsPath}.chakra.pool.value`;
export const chakraPoolTempPath = `${moduleFlagsPath}.chakra.pool.temp`;
export const chakraReserveValuePath = `${moduleFlagsPath}.chakra.reserve.value`;

// ── Chakra condition tracking paths ──────────────────────────────────────
export const conditionAppliedFatiguedPath = `${moduleFlagsPath}.conditions.appliedFatigued`;
export const conditionAppliedExhaustedPath = `${moduleFlagsPath}.conditions.appliedExhausted`;

/**
 * Single source of truth for pf1's changes-engine integration.
 *  - pf1GetChangeFlat            → reads `path` so the engine knows where to write
 *  - CONFIG.PF1.buffTargets       → reads `label` + `sort` for the buff selector UI
 *  - prepareBaseActorData reset   → reads `path` to zero the field before the engine runs
 *
 * Adding a new buff target = adding one entry here.
 */
export const BUFF_TARGETS = {
  chakraPool: { label: "Chakra Pool Max", path: chakraPoolMaxBonusPath, sort: 90000 },
  chakraReserve: { label: "Chakra Reserve Max", path: chakraReserveMaxBonusPath, sort: 90001 },
  learnCkc: { label: "Learn: Chakra Control", path: learnBuffPath("ckc"), sort: 90002 },
  learnGnj: { label: "Learn: Genjutsu", path: learnBuffPath("gnj"), sort: 90003 },
  learnNin: { label: "Learn: Ninjutsu", path: learnBuffPath("nin"), sort: 90004 },
  learnTai: { label: "Learn: Taijutsu", path: learnBuffPath("tai"), sort: 90005 },
  learnFui: { label: "Learn: Fuinjutsu", path: learnBuffPath("fui"), sort: 90006 },

  techDcAll: {
    label: "NarutoD20.BuffTargets.TechDc.All",
    path: techniqueDCBuffPath("all"),
    sort: 90010,
    category: "technique",
  },
  techDcCkc: {
    label: "NarutoD20.BuffTargets.TechDc.ckc",
    path: techniqueDCBuffPath("ckc"),
    sort: 90011,
    category: "technique",
  },
  techDcFui: {
    label: "NarutoD20.BuffTargets.TechDc.fui",
    path: techniqueDCBuffPath("fui"),
    sort: 90012,
    category: "technique",
  },
  techDcGnj: {
    label: "NarutoD20.BuffTargets.TechDc.gnj",
    path: techniqueDCBuffPath("gnj"),
    sort: 90013,
    category: "technique",
  },
  techDcNin: {
    label: "NarutoD20.BuffTargets.TechDc.nin",
    path: techniqueDCBuffPath("nin"),
    sort: 90014,
    category: "technique",
  },
  techDcTai: {
    label: "NarutoD20.BuffTargets.TechDc.tai",
    path: techniqueDCBuffPath("tai"),
    sort: 90015,
    category: "technique",
  },
};
