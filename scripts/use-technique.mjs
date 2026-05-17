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
        const result = await actor.rollSkill(skillKey);
        if (!result) return;                               // user cancelled dialog
        const lastMsg = game.messages.contents.at(-1);
        succeeded = (lastMsg?.rolls?.[0]?.total ?? 0) >= performDC;
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

    await action.use({ skipDialog: true });
}
