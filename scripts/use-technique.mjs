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
        // pf1.dice.d20Roll posts its own chat card; just read the total.
        // `skill:` tells PF1e to apply the standard skill formula (ranks +
        // ability + class-skill bonus). `parts` adds only technique-specific
        // extras on top.
        const roll = await pf1.dice.d20Roll({
            flavor:   `${item.name} — Perform Check (DC ${performDC})`,
            skill:    skillKey,
            parts:    _buildPerformParts(sys),
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

// Only technique-specific extras — PF1e's d20Roll handles the base skill formula.
function _buildPerformParts(sys) {
    const parts = [];
    if (sys.performMiscBonus) parts.push(`${sys.performMiscBonus}[Perform Misc]`);
    return parts;
}
