export const DISCIPLINE_SKILL_MAP = Object.freeze({
  "Chakra Control": "ckc",
  Fuinjutsu: "fui",
  Genjutsu: "gnj",
  Ninjutsu: "nin",
  Taijutsu: "tai",
  "Hachimon Tonkou": undefined,
  Training: undefined,
  "": undefined,
});

export const DISCIPLINE_LABEL_KEYS = Object.freeze({
  "Chakra Control": "NarutoD20.Technique.Discipline.ChakraControl",
  Fuinjutsu: "NarutoD20.Technique.Discipline.Fuinjutsu",
  Genjutsu: "NarutoD20.Technique.Discipline.Genjutsu",
  "Hachimon Tonkou": "NarutoD20.Technique.Discipline.HachimonTonkou",
  Ninjutsu: "NarutoD20.Technique.Discipline.Ninjutsu",
  Taijutsu: "NarutoD20.Technique.Discipline.Taijutsu",
  Training: "NarutoD20.Technique.Discipline.Training",
});

export const LEARN_DISCIPLINES = Object.freeze(
  Object.entries(DISCIPLINE_SKILL_MAP)
    .filter(([, skillKey]) => !!skillKey)
    .map(([discipline]) => discipline),
);

const CANONICAL_DISCIPLINE_LOOKUP = new Map(
  Object.keys(DISCIPLINE_LABEL_KEYS).map((discipline) => [normalizeDisciplineName(discipline), discipline]),
);

export const NARUTO_SKILLS = Object.freeze({
  ckc: { label: "NarutoD20.Skills.ckc", ability: "wis", discipline: "Chakra Control" },
  fui: { label: "NarutoD20.Skills.fui", ability: "int", discipline: "Fuinjutsu" },
  gnj: { label: "NarutoD20.Skills.gnj", ability: "cha", discipline: "Genjutsu" },
  tai: { label: "NarutoD20.Skills.tai", ability: "str", discipline: "Taijutsu" },
  nin: { label: "NarutoD20.Skills.nin", ability: "int", discipline: "Ninjutsu" },
});

/** Stable order matches NARUTO_SKILLS insertion order. Used by all reset/iter loops. */
export const LEARN_KEYS = Object.freeze(Object.keys(NARUTO_SKILLS));

export function normalizeDisciplineName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function canonicalizeDisciplineName(value) {
  return CANONICAL_DISCIPLINE_LOOKUP.get(normalizeDisciplineName(value)) ?? null;
}

/**
 * Resolve the governing ability for a discipline skill: prefer the actor's
 * Skills-tab selector, fall back to the canonical NARUTO_SKILLS mapping, then int.
 */
export function resolveSkillAbility(actor, skillKey) {
  return actor?.system?.skills?.[skillKey]?.ability || NARUTO_SKILLS[skillKey]?.ability || "int";
}

/**
 * Register the 5 Naruto disciplines as PF1e-native skills.
 * Call during pf1PostInit — pf1.config and game.i18n are both ready.
 */
export function registerNarutoSkills() {
  for (const [key, data] of Object.entries(NARUTO_SKILLS)) {
    // Deployed PF1e stores skills as plain localized strings.
    // The governing ability comes from actor.system.skills[key].ability (seeded below).
    pf1.config.skills[key] = game.i18n.localize(data.label);
  }
}

/**
 * Seed skill entries on actor.system.skills so PF1e renders them in the Skills tab.
 * Uses ??= so existing ranks are never overwritten.
 * Call during pf1PrepareBaseActorData.
 */
export function ensureActorSkillEntries(actor) {
  if (!["character", "npc"].includes(actor.type)) return;
  for (const [key, data] of Object.entries(NARUTO_SKILLS)) {
    if (key in actor.system.skills) {
      actor.system.skills[key].ability ??= data.ability;
    } else {
      actor.system.skills[key] = { ability: data.ability, rank: 0 };
    }
  }
}
