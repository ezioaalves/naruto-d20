import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";

const MODULE_ID = "naruto-d20";

export function canAffordTechnique(actor, item) {
    if (!actor) return false;
    const chakra    = actor.flags?.[MODULE_ID]?.chakra ?? {};
    const available = (chakra.pool?.value ?? 0) + (chakra.reserve?.value ?? 0);
    return available >= (item.system.chakraCost ?? 0);
}

export async function performTechnique(item, actionId) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("Equip this technique on an actor to use it.");
        return;
    }
    const action = item.actions?.get(actionId);
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found.`);
        return;
    }

    const sys  = item.system;
    const cost = sys.chakraCost ?? 0;

    if (!canAffordTechnique(actor, item)) {
        ui.notifications.warn(`${actor.name}: not enough chakra to perform ${item.name}.`);
        return;
    }

    const skillKey   = DISCIPLINE_SKILL_MAP[sys.discipline];
    const skillRanks = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
    const threshold  = sys.derived.skillThreshold;
    const performDC  = sys.derived.performDC;

    let succeeded;
    let bypassNote = null;

    if (!skillKey || skillRanks >= threshold) {
        succeeded  = true;
        bypassNote = skillKey
            ? `Ranks ${skillRanks} ≥ threshold ${threshold} — auto-perform.`
            : `No perform check required.`;
    } else {
        const roll = await pf1.dice.d20Roll({
            flavor:   `${sys.discipline} Perform Check`,
            parts:    _buildPerformParts(actor, skillKey, sys),
            rollData: actor.getRollData?.() ?? {},
            speaker:  ChatMessage.implementation?.getSpeaker({ actor }) ?? ChatMessage.getSpeaker({ actor }),
        });
        if (!roll) return;  // user cancelled dialog
        succeeded = roll.rolls[0].total >= performDC;
    }

    if (!succeeded) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card failed">
                        <header><h3>${item.name}</h3></header>
                        <p>Perform check failed (DC ${performDC}). No chakra spent.</p>
                      </div>`,
        });
        return;
    }

    // Deduct chakra: pool first, reserve as overflow
    const chakra       = actor.flags[MODULE_ID]?.chakra ?? {};
    const poolValue    = chakra.pool?.value    ?? 0;
    const reserveValue = chakra.reserve?.value ?? 0;
    const fromPool     = Math.min(cost, poolValue);
    const fromReserve  = cost - fromPool;
    await actor.update({
        [`flags.${MODULE_ID}.chakra.pool.value`]:    poolValue    - fromPool,
        [`flags.${MODULE_ID}.chakra.reserve.value`]: reserveValue - fromReserve,
    });

    // Post outcome card when there was an auto-bypass (roll card covers the roll path)
    if (bypassNote) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <p class="naruto-perform-bypass">${bypassNote}</p>
                        <footer>Spent ${cost} chakra (${fromPool} pool, ${fromReserve} reserve).</footer>
                      </div>`,
        });
    } else {
        // Roll path: just note the chakra deduction (roll card already in chat above)
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <footer>Spent ${cost} chakra (${fromPool} pool, ${fromReserve} reserve).</footer>
                      </div>`,
        });
    }

    await action.use();
}

const ABILITY_LABELS = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };

function _buildPerformParts(actor, skillKey, sys) {
    const parts = [];
    const skill = actor.system.skills?.[skillKey] ?? {};
    const rank = skill.rank ?? 0;
    const abilityKey = skill.ability ?? "str";
    const abilityMod = actor.system.abilities?.[abilityKey]?.mod ?? 0;
    const abilityLabel = ABILITY_LABELS[abilityKey] ?? abilityKey;

    if (rank)                 parts.push(`${rank}[Ranks]`);
    if (abilityMod)           parts.push(`${abilityMod}[${abilityLabel}]`);
    if (skill.cs && rank > 0) parts.push(`3[Class Skill]`);

    const changeBonus = skill.changeBonus ?? 0;
    if (changeBonus) {
        const buffSources = actor.sourceInfo?.[`system.skills.${skillKey}.changeBonus`]?.positive ?? [];
        if (buffSources.length > 0) {
            for (const src of buffSources) parts.push(`${src.value}[${src.name}]`);
        } else {
            parts.push(`${changeBonus}[Skill Bonus]`);
        }
    }

    if (sys.performMiscBonus) parts.push(`${sys.performMiscBonus}[Perform Misc]`);
    return parts;
}
