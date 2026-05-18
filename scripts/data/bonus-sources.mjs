import { MODULE_ID } from "../constants.mjs";
import { learnBuffPath } from "../flag-paths.mjs";

/**
 * Build the breakdown of a learn check for both the d20Roll parts array and
 * pf1's extended-tooltip sources list.
 *
 * Source-name discovery: pf1's changes engine populates
 * `actor.sourceInfo[flagPath].positive` with `{name, value}` entries — one per
 * change writing to that flag. We use those individual names when available
 * (so the chat card / tooltip shows "Iron Will Buff" instead of a generic
 * "Buff Bonus" line). Falls back to the lump-sum `data.buffBonus` if pf1's
 * sourceInfo is empty for the path.
 *
 * @param {Actor}  actor
 * @param {string} key   Learn discipline key (ckc | fui | gnj | nin | tai).
 * @returns {{parts: string[], sources: object[]}|null}
 */
export function buildLearnCheckBreakdown(actor, key) {
    const data = actor.flags?.[MODULE_ID]?.learn?.[key];
    if (!data) return null;

    const parts   = [];   // labeled formula parts for pf1.dice.d20Roll
    const sources = [];   // {name, value, builtIn} rows for extended-tooltip.hbs

    parts.push(`${data.base}[Character Level]`);
    sources.push({ name: "Character Level", value: data.base, builtIn: true });

    if (data.abilityMod) {
        parts.push(`${data.abilityMod}[${data.abilityLabel}]`);
        sources.push({ name: data.abilityLabel, value: data.abilityMod, builtIn: true });
    }

    const buffSources = actor.sourceInfo?.[learnBuffPath(key)]?.positive ?? [];
    if (buffSources.length > 0) {
        for (const src of buffSources) {
            parts.push(`${src.value}[${src.name}]`);
            sources.push({ name: src.name, value: src.value, builtIn: false });
        }
    } else if (data.buffBonus) {
        parts.push(`${data.buffBonus}[Buff Bonus]`);
        sources.push({ name: "Buff Bonus", value: data.buffBonus, builtIn: false });
    }

    if (data.synergyBonus) {
        parts.push(`${data.synergyBonus}[Skill Synergy]`);
        sources.push({ name: "Skill Synergy", value: data.synergyBonus, builtIn: true });
    }
    if (data.miscBonus) {
        parts.push(`${data.miscBonus}[Misc Bonus]`);
        sources.push({ name: "Misc Bonus", value: data.miscBonus, builtIn: false });
    }

    return { parts, sources };
}
