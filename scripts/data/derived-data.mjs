/**
 * Naruto D20 — Derived Data Calculations
 *
 * Two functions registered as PF1e hooks in main.mjs:
 *   prepareBaseActorData   → pf1PrepareBaseActorData  (resets computed fields so the
 *                            changes engine writes buff bonuses onto a clean slate)
 *   prepareDerivedActorData → pf1PrepareDerivedActorData (reads buff values after the
 *                            changes engine ran and computes all totals)
 *
 * Hook sequence guaranteed by PF1e:
 *   [1] pf1PrepareBaseActorData  — our schema init, buff values reset to 0
 *   [2] PF1e changes engine      — writes buffBonus values via pf1GetChangeFlat paths
 *   [3] pf1PrepareDerivedActorData — our calculations read the committed buff values
 */

/**
 * Ensure the naruto-d20 flag schema exists and reset all computed fields.
 * Called during pf1PrepareBaseActorData — before the changes engine runs.
 * @param {Actor} actor
 */
export function prepareBaseActorData(actor) {
    if (!["character", "npc"].includes(actor.type)) return;

    actor.flags["naruto-d20"] ??= {};
    const nData = actor.flags["naruto-d20"];

    // Chakra resources — keep stored values, reset computed bonus (changes engine will write it)
    nData.chakra ??= {};
    nData.chakra.pool ??= {};
    nData.chakra.reserve ??= {};
    nData.chakra.nature ??= { primary: "", secondary: [] };
    nData.chakra.pool.value ??= 0;
    nData.chakra.reserve.value ??= 0;
    nData.chakra.pool.maxBonus = 0;
    nData.chakra.reserve.maxBonus = 0;

    // Learn skills
    nData.learn ??= {};
    for (const key of ["ckc", "gnj", "nin", "tai", "fui"]) {
        nData.learn[key] ??= {};
        const s = nData.learn[key];
        s.miscBonus ??= 0;  // user-entered, preserve
        // Reset computed fields — will be filled in prepareDerivedActorData
        s.base = 0;
        s.abilityMod = 0;
        s.buffBonus = 0;    // changes engine overwrites this in step [2]
        s.total = 0;
        s.conditional = 0;
    }
}

/**
 * Compute all derived Shinobi statistics after the PF1e changes engine has run.
 * Called during pf1PrepareDerivedActorData — buff bonuses are already committed.
 * @param {Actor} actor
 */
export function prepareDerivedActorData(actor) {
    if (!["character", "npc"].includes(actor.type)) return;

    const nData = actor.flags["naruto-d20"];
    if (!nData) return;

    const charLevel = actor.system.details?.level?.value || actor.system.details?.cr?.total || 0;
    const conMod = actor.system.abilities?.con?.mod || 0;

    // Taijutsu governing ability comes from the skill-tab selector (actor.system.skills.tai.ability)
    const taiAbility = actor.system.skills.tai?.ability || "str";
    nData.learn.tai.ability = taiAbility;  // mirror for template label

    const abilityMap = {
        ckc: "wis",
        gnj: "cha",
        nin: "int",
        tai: taiAbility,
        fui: "int"
    };

    for (const [key, abilityKey] of Object.entries(abilityMap)) {
        const s = nData.learn[key];
        if (!s) continue;
        s.base = charLevel;
        s.abilityMod = actor.system.abilities?.[abilityKey]?.mod || 0;
        // buffBonus was written by the changes engine between the two hooks
        s.total = s.base + s.abilityMod + (Number(s.miscBonus) || 0) + (Number(s.buffBonus) || 0);
    }

    // Chakra maximums — conMod allowed to go negative (reduces pool)
    nData.chakra.pool.max = 2 + ((2 + conMod) * charLevel) + (Number(nData.chakra.pool.maxBonus) || 0);
    nData.chakra.reserve.max = (2 * charLevel) + (Number(nData.chakra.reserve.maxBonus) || 0);

    // Elemental affinity: +1 Ninjutsu conditional per 5 levels starting at 1st
    nData.learn.nin.conditional = charLevel >= 1 ? 1 + Math.floor((charLevel - 1) / 5) : 0;

    // Energy resistance from primary elemental affinity (5 at 10th, 10 at 15th, 15 at 20th)
    _applyElementalResistance(actor, nData, charLevel);
}

// ── Private helpers ───────────────────────────────────────────────────────

const ELEMENTAL_STRONG_AGAINST = {
    fire:      "wind",
    wind:      "lightning",
    lightning: "earth",
    earth:     "water",
    water:     "fire"
};

function _applyElementalResistance(actor, nData, charLevel) {
    const primary = nData.chakra.nature?.primary?.toLowerCase();
    if (!primary) return;

    let resValue = 0;
    if (charLevel >= 20)      resValue = 15;
    else if (charLevel >= 15) resValue = 10;
    else if (charLevel >= 10) resValue = 5;
    if (!resValue) return;

    const resElement = ELEMENTAL_STRONG_AGAINST[primary];
    if (!resElement) return;

    actor.system.traits ??= {};
    const eres = actor.system.traits.eres;

    if (Array.isArray(eres)) {
        if (!eres.find(e => e.types?.includes(resElement))) {
            eres.push({ amount: resValue, types: [resElement], operator: true });
        }
    } else if (typeof eres === "string") {
        if (!eres.toLowerCase().includes(resElement)) {
            actor.system.traits.eres = eres ? `${eres}; ${resElement} ${resValue}` : `${resElement} ${resValue}`;
        }
    } else {
        actor.system.traits.eres = [{ amount: resValue, types: [resElement], operator: true }];
    }
}
