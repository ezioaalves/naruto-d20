export const DISCIPLINE_SKILL_MAP = Object.freeze({
    "Chakra Control":  "ckc",
    "Fuinjutsu":       "fui",
    "Genjutsu":        "gnj",
    "Ninjutsu":        "nin",
    "Taijutsu":        "tai",
    "Hachimon Tonkou": undefined,
    "Training":        undefined,
    "":                undefined,
});

const NARUTO_SKILLS = {
    ckc: { label: "NarutoD20.Skills.ckc", ability: "wis" },
    fui: { label: "NarutoD20.Skills.fui", ability: "int" },
    gnj: { label: "NarutoD20.Skills.gnj", ability: "cha" },
    tai: { label: "NarutoD20.Skills.tai", ability: "str" },
    nin: { label: "NarutoD20.Skills.nin", ability: "int" },
};

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
