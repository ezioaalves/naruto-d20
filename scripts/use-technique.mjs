import { MODULE_ID } from "./constants.mjs";
import { chakraPoolValuePath, chakraPoolTempPath, chakraReserveValuePath } from "./flag-paths.mjs";
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs";
import { checkAndUpdateConditions } from "./data/chakra-conditions.mjs";
import { getTechniqueWeaponAttackConfig, rollSelectedWeaponAttackWithTechnique } from "./ui/technique-weapon-attack.mjs";
import { isTechniqueEffectivelyLearned } from "./learn-technique.mjs";

export function canAffordTechnique(actor, item) {
    if (!actor) return false;
    const chakra    = actor.flags?.[MODULE_ID]?.chakra ?? {};
    const available = (chakra.pool?.temp ?? 0) + (chakra.pool?.value ?? 0) + (chakra.reserve?.value ?? 0);
    return available >= (item.system.chakraCost ?? 0);
}

export async function performTechnique(item, actionId, event = null) {
    const context = validateTechniqueUse(item, actionId);
    if (!context) return;

    const { actor, actionIndex, cost } = context;

    const perform = await resolvePerformCheck(item, actor);
    if (!perform) return;
    if (!perform.succeeded) {
        await postPerformFailureCard(actor, item, perform);
        return;
    }

    const current = resolveCurrentTechniqueAction(actor, item, actionId, actionIndex, "after perform check");
    if (!current) return;

    const useResult = await useTechniqueAction(current.item, current.action, actor, event);
    if (!useResult || useResult.err) return;

    if (!canAffordTechnique(actor, current.item)) {
        ui.notifications.warn(`${actor.name}: not enough chakra to perform ${current.item.name}.`);
        return;
    }

    const spend = calculateChakraSpend(actor, cost);
    await applyChakraSpend(actor, spend);
    await postTechniqueSuccessCard(actor, item, cost, spend.summary, perform.bypassNote);

    const updated = resolveCurrentTechniqueAction(actor, current.item, current.action.id, actionIndex, "after chakra update");
    if (!updated) return;

    await applyPostUseAutomation(updated.item, actor, updated.action);
}

function validateTechniqueUse(item, actionId) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("Equip this technique on an actor to use it.");
        return null;
    }

    if (game.settings.get(MODULE_ID, "enforceLearning") && !isTechniqueEffectivelyLearned(item)) {
        ui.notifications.warn(`${item.name}: not learned yet.`);
        return null;
    }

    const action = item.actions?.get(actionId);
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found.`);
        return null;
    }

    if (!canAffordTechnique(actor, item)) {
        ui.notifications.warn(`${actor.name}: not enough chakra to perform ${item.name}.`);
        return null;
    }

    return {
        actor,
        action,
        actionIndex: Array.from(item.actions ?? []).findIndex((a) => a.id === action.id),
        cost: item.system.chakraCost ?? 0,
    };
}

async function resolvePerformCheck(item, actor) {
    const sys = item.system;
    const skillKey       = DISCIPLINE_SKILL_MAP[sys.discipline];
    const skillRanks     = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
    const threshold      = sys.derived.skillThreshold;
    const performDC      = sys.derived.performDC;
    const masteryPerform = sys.derived.masteryPerform ?? 0;
    const masteryNote    = masteryPerform > 0 ? ` (+${masteryPerform} mastery)` : "";

    if (!skillKey || (skillRanks + masteryPerform) >= threshold) {
        return {
            succeeded: true,
            performDC,
            masteryNote,
            bypassNote: skillKey
                ? `Ranks ${skillRanks}${masteryNote} ≥ threshold ${threshold} — auto-perform.`
                : "No perform check required.",
        };
    }

    const result = await actor.rollSkill(skillKey);
    if (!result) return null;

    const lastMsg = game.messages.contents.at(-1);
    return {
        succeeded: ((lastMsg?.rolls?.[0]?.total ?? 0) + masteryPerform) >= performDC,
        performDC,
        masteryNote,
        bypassNote: null,
    };
}

function resolveCurrentTechniqueAction(actor, item, actionId, actionIndex, phase) {
    const currentItem = actor.items.get(item.id) ?? item;
    const action = currentItem.actions?.get(actionId) ?? Array.from(currentItem.actions ?? [])[actionIndex];
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found ${phase}.`);
        return null;
    }
    return { item: currentItem, action };
}

async function useTechniqueAction(item, action, actor, event) {
    const weaponAttackConfig = getTechniqueWeaponAttackConfig(item);
    if (weaponAttackConfig) {
        return rollSelectedWeaponAttackWithTechnique({
            technique: item,
            actor,
            config: weaponAttackConfig,
            event,
        });
    }

    const useResult = await item.use({
        actionId: action.id,
        skipDialog: !(action.hasAttack || action.hasDamage),
        ev: event,
    });

    // Charge defense penalty is applied by the global pf1PostActionUse hook
    // (registerChargeDefensePenalty), which fires for the weapon attack this
    // technique triggers internally. Applying it again here would duplicate the
    // buff due to the dedup race (the hook runs un-awaited, concurrently).
    return useResult;
}

function calculateChakraSpend(actor, cost) {
    // Deduct chakra: temp first, then pool, then reserve as overflow.
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

    // Build a readable spend summary (omit zero-value sources).
    // If the Emergency Transfer fired, the actual reserve spent is the full original reserve.
    const actualFromReserve = reserveValue - newReserve;
    const spendParts = [];
    if (fromTemp          > 0) spendParts.push(`${fromTemp} temp`);
    if (fromPool          > 0) spendParts.push(`${fromPool} pool`);
    if (actualFromReserve > 0) spendParts.push(`${actualFromReserve} reserve`);

    return {
        temp: tempValue - fromTemp,
        pool: newPool,
        reserve: newReserve,
        summary: spendParts.join(", ") || "0",
    };
}

async function applyChakraSpend(actor, spend) {
    await actor.update({
        [chakraPoolTempPath]:     spend.temp,
        [chakraPoolValuePath]:    spend.pool,
        [chakraReserveValuePath]: spend.reserve,
    });

    await checkAndUpdateConditions(actor);
}

async function postPerformFailureCard(actor, item, { performDC, masteryNote }) {
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="naruto-technique-card failed">
                    <header><h3>${item.name}</h3></header>
                    <p>Perform check failed (DC ${performDC}${masteryNote}). No chakra spent.</p>
                  </div>`,
    });
}

async function postTechniqueSuccessCard(actor, item, cost, spendSummary, bypassNote) {
    // Post outcome card when there was an auto-bypass (roll card covers the roll path).
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
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <footer>Spent ${cost} chakra (${spendSummary}).</footer>
                      </div>`,
        });
    }
}

async function applyPostUseAutomation(item, actor, action) {
    if (!game.settings.get(MODULE_ID, "automaticBuffs") || !item.system.automation?.enabled) return;

    const { applyTechniqueBuff } = await import("./automation/buff-application.mjs");
    try {
        await applyTechniqueBuff(item, actor, action);
    } catch (err) {
        console.error(`naruto-d20 | buff automation failed for "${item.name}":`, err);
        ui.notifications.warn(`Buff automation failed for ${item.name}. See console.`);
    }
}
