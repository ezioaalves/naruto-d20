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
export const masteryCurrentTechniqueIdPath = `${moduleFlagsPath}.mastery.currentTechniqueId`;

// ── Technique DC flag paths ──────────────────────────────────────────────
// k ∈ {"all","ckc","fui","gnj","nin","tai"}; "all" is the global bonus,
// the discipline keys are per-type bonuses (mirror of pf1's per-school spell DC).
export const techniqueDCBuffPath = (k) => `${moduleFlagsPath}.techniqueDC.${k}.buffBonus`;

// ── Chakra resource flag paths ───────────────────────────────────────────
export const chakraPoolMaxBonusPath = `${moduleFlagsPath}.chakra.pool.maxBonus`;
export const chakraReserveMaxBonusPath = `${moduleFlagsPath}.chakra.reserve.maxBonus`;
export const chakraTapReservesBuffPath = `${moduleFlagsPath}.chakra.tapReserves.buffBonus`;
export const chakraPoolTempBonusPath = `${moduleFlagsPath}.chakra.pool.tempBonus`;
export const chakraPoolValuePath = `${moduleFlagsPath}.chakra.pool.value`;
export const chakraPoolTempPath = `${moduleFlagsPath}.chakra.pool.temp`;
export const chakraReserveValuePath = `${moduleFlagsPath}.chakra.reserve.value`;

// ── Chakra condition tracking paths ──────────────────────────────────────
export const conditionAppliedFatiguedPath = `${moduleFlagsPath}.conditions.appliedFatigued`;
export const conditionAppliedExhaustedPath = `${moduleFlagsPath}.conditions.appliedExhausted`;
export const conditionDepletionActivePath = `${moduleFlagsPath}.conditions.depletionActive`;
export const conditionLowReserveFatiguePendingPath = `${moduleFlagsPath}.conditions.lowReserveFatiguePending`;

/**
 * Single source of truth for pf1's changes-engine integration.
 *  - pf1GetChangeFlat            → reads `path` so the engine knows where to write
 *  - CONFIG.PF1.buffTargets       → reads `label` + `sort` for the buff selector UI
 *  - prepareBaseActorData reset   → reads `path` to zero the field before the engine runs
 *
 * Adding a new buff target = adding one entry here.
 */
export const BUFF_TARGETS = {
  chakraPool: {
    label: "NarutoD20.BuffTargets.ChakraPool",
    path: chakraPoolMaxBonusPath,
    sort: 90000,
  },
  chakraReserve: {
    label: "NarutoD20.BuffTargets.ChakraReserve",
    path: chakraReserveMaxBonusPath,
    sort: 90001,
  },
  temporaryChakra: {
    label: "NarutoD20.BuffTargets.TemporaryChakra",
    path: chakraPoolTempBonusPath,
    sort: 90002,
  },
  tapReserves: {
    label: "NarutoD20.BuffTargets.TapReserves",
    path: chakraTapReservesBuffPath,
    sort: 90003,
  },
  learnCkc: {
    label: "NarutoD20.BuffTargets.Learn.ckc",
    path: learnBuffPath("ckc"),
    sort: 90010,
    category: "technique",
  },
  learnGnj: {
    label: "NarutoD20.BuffTargets.Learn.gnj",
    path: learnBuffPath("gnj"),
    sort: 90011,
    category: "technique",
  },
  learnNin: {
    label: "NarutoD20.BuffTargets.Learn.nin",
    path: learnBuffPath("nin"),
    sort: 90012,
    category: "technique",
  },
  learnTai: {
    label: "NarutoD20.BuffTargets.Learn.tai",
    path: learnBuffPath("tai"),
    sort: 90013,
    category: "technique",
  },
  learnFui: {
    label: "NarutoD20.BuffTargets.Learn.fui",
    path: learnBuffPath("fui"),
    sort: 90014,
    category: "technique",
  },

  techDcAll: {
    label: "NarutoD20.BuffTargets.TechDc.All",
    path: techniqueDCBuffPath("all"),
    sort: 90020,
    category: "technique",
  },
  techDcCkc: {
    label: "NarutoD20.BuffTargets.TechDc.ckc",
    path: techniqueDCBuffPath("ckc"),
    sort: 90021,
    category: "technique",
  },
  techDcFui: {
    label: "NarutoD20.BuffTargets.TechDc.fui",
    path: techniqueDCBuffPath("fui"),
    sort: 90022,
    category: "technique",
  },
  techDcGnj: {
    label: "NarutoD20.BuffTargets.TechDc.gnj",
    path: techniqueDCBuffPath("gnj"),
    sort: 90023,
    category: "technique",
  },
  techDcNin: {
    label: "NarutoD20.BuffTargets.TechDc.nin",
    path: techniqueDCBuffPath("nin"),
    sort: 90024,
    category: "technique",
  },
  techDcTai: {
    label: "NarutoD20.BuffTargets.TechDc.tai",
    path: techniqueDCBuffPath("tai"),
    sort: 90025,
    category: "technique",
  },
};
