import { MODULE_ID } from "./constants.mjs";
import { chakraPoolValuePath, chakraPoolTempPath, chakraReserveValuePath } from "./flag-paths.mjs";
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";
import { checkAndUpdateConditions } from "./data/chakra-conditions.mjs";
import { getTechniqueWeaponAttackConfig, rollSelectedWeaponAttackWithTechnique } from "./ui/technique-weapon-attack.mjs";

export function canAffordTechnique(actor, item) {
    if (!actor) return false;
    const chakra    = actor.flags?.[MODULE_ID]?.chakra ?? {};
    const available = (chakra.pool?.temp ?? 0) + (chakra.pool?.value ?? 0) + (chakra.reserve?.value ?? 0);
    return available >= (item.system.chakraCost ?? 0);
}

export async function performTechnique(item, actionId, event = null) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("Equip this technique on an actor to use it.");
        return;
    }
    let action = item.actions?.get(actionId);
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found.`);
        return;
    }
    const actionIndex = Array.from(item.actions ?? []).findIndex((a) => a.id === action.id);

    const sys  = item.system;
    const cost = sys.chakraCost ?? 0;

    if (!canAffordTechnique(actor, item)) {
        ui.notifications.warn(`${actor.name}: not enough chakra to perform ${item.name}.`);
        return;
    }

    const skillKey       = DISCIPLINE_SKILL_MAP[sys.discipline];
    const skillRanks     = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
    const threshold      = sys.derived.skillThreshold;
    const performDC      = sys.derived.performDC;
    const masteryPerform = sys.derived.masteryPerform ?? 0;
    const masteryNote    = masteryPerform > 0 ? ` (+${masteryPerform} mastery)` : "";

    let succeeded;
    let bypassNote = null;

    if (!skillKey || (skillRanks + masteryPerform) >= threshold) {
        succeeded  = true;
        bypassNote = skillKey
            ? `Ranks ${skillRanks}${masteryNote} ≥ threshold ${threshold} — auto-perform.`
            : `No perform check required.`;
    } else {
        const result = await actor.rollSkill(skillKey);
        if (!result) return;                               // user cancelled dialog
        const lastMsg = game.messages.contents.at(-1);
        succeeded = ((lastMsg?.rolls?.[0]?.total ?? 0) + masteryPerform) >= performDC;
    }

    if (!succeeded) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card failed">
                        <header><h3>${item.name}</h3></header>
                        <p>Perform check failed (DC ${performDC}${masteryNote}). No chakra spent.</p>
                      </div>`,
        });
        return;
    }

    const currentItem = actor.items.get(item.id) ?? item;
    action = currentItem.actions?.get(actionId) ?? Array.from(currentItem.actions ?? [])[actionIndex];
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found after perform check.`);
        return;
    }

    const weaponAttackConfig = getTechniqueWeaponAttackConfig(currentItem);
    const useResult = weaponAttackConfig
        ? await rollSelectedWeaponAttackWithTechnique({
            technique: currentItem,
            actor,
            config: weaponAttackConfig,
            event,
        })
        : await currentItem.use({
            actionId: action.id,
            skipDialog: !(action.hasAttack || action.hasDamage),
            ev: event,
        });
    if (!useResult || useResult.err) return;

    if (!canAffordTechnique(actor, currentItem)) {
        ui.notifications.warn(`${actor.name}: not enough chakra to perform ${currentItem.name}.`);
        return;
    }

    // Deduct chakra: temp first, then pool, then reserve as overflow
    const chakra       = actor.flags[MODULE_ID]?.chakra ?? {};
    const tempValue    = chakra.pool?.temp     ?? 0;
    const poolValue    = chakra.pool?.value    ?? 0;
    const reserveValue = chakra.reserve?.value ?? 0;
    const fromTemp     = Math.min(cost, tempValue);
    const remaining    = cost - fromTemp;
    const fromPool     = Math.min(remaining, poolValue);
    const fromReserve  = remaining - fromPool;

    let newPool    = poolValue    - fromPool;
    let newReserve = reserveValue - fromReserve;

    // Emergency Transfer: if pool hits 0 but reserve still has chakra, the body
    // automatically burns the entire reserve to return 1 chakra to the pool.
    // This guarantees pool == 0 only when reserve == 0 (which triggers Chakra Depletion).
    if (newPool <= 0 && newReserve > 0) {
        newPool    = 1;
        newReserve = 0;
    }

    await actor.update({
        [chakraPoolTempPath]:     tempValue - fromTemp,
        [chakraPoolValuePath]:    newPool,
        [chakraReserveValuePath]: newReserve,
    });

    await checkAndUpdateConditions(actor);

    // Build a readable spend summary (omit zero-value sources).
    // If the Emergency Transfer fired, the actual reserve spent is the full original reserve.
    const actualFromReserve = reserveValue - newReserve;
    const spendParts = [];
    if (fromTemp          > 0) spendParts.push(`${fromTemp} temp`);
    if (fromPool          > 0) spendParts.push(`${fromPool} pool`);
    if (actualFromReserve > 0) spendParts.push(`${actualFromReserve} reserve`);
    const spendSummary = spendParts.join(", ") || "0";

    // Post outcome card when there was an auto-bypass (roll card covers the roll path)
    if (bypassNote) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <p class="naruto-perform-bypass">${bypassNote}</p>
                        <footer>Spent ${cost} chakra (${spendSummary}).</footer>
                      </div>`,
        });
    } else {
        // Roll path: just note the chakra deduction (roll card already in chat above)
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <footer>Spent ${cost} chakra (${spendSummary}).</footer>
                      </div>`,
        });
    }

    const updatedItem = actor.items.get(currentItem.id) ?? currentItem;
    action = updatedItem.actions?.get(action.id) ?? Array.from(updatedItem.actions ?? [])[actionIndex];
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found after chakra update.`);
        return;
    }

    if (game.settings.get(MODULE_ID, "automaticBuffs") && updatedItem.system.automation?.enabled) {
        const { applyTechniqueBuff } = await import("./automation/buff-application.mjs");
        try {
            await applyTechniqueBuff(updatedItem, actor, action);
        } catch (err) {
            console.error(`naruto-d20 | buff automation failed for "${updatedItem.name}":`, err);
            ui.notifications.warn(`Buff automation failed for ${updatedItem.name}. See console.`);
        }
    }
}
