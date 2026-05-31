import { MODULE_ID } from "./constants.mjs";
import { learningCurrentTechniqueIdPath } from "./flag-paths.mjs";
import { buildLearnCheckBreakdown } from "./data/bonus-sources.mjs";
import { DISCIPLINE_SKILL_MAP, resolveSkillAbility } from "./data/skills.mjs";

export const LEARNING_MODES = Object.freeze({
    STANDARD: "standard",
    FOUR_HOUR_BLOCKS: "fourHourBlocks",
});

function characterLevel(actor) {
    return Number(actor.system.details?.level?.value ?? actor.system.details?.cr?.total ?? 0) || 0;
}

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
}

function getLearningMode() {
    return game.settings.get(MODULE_ID, "learningProgressionMode") || LEARNING_MODES.STANDARD;
}

export function getLearningTargetProgress(item, mode = getLearningMode()) {
    const successes = Math.max(1, Number(item.system.derived?.successes ?? 1) || 1);
    if (mode === LEARNING_MODES.FOUR_HOUR_BLOCKS) {
        const rank = Math.max(1, Number(item.system.rank ?? 1) || 1);
        return rank * successes * 2;
    }
    return successes;
}

export function getLearningMaxAttempts(actor, skillKey) {
    if (!actor || !skillKey) return null;
    const ability = resolveSkillAbility(actor, skillKey);
    const abilityMod = Number(actor.system.abilities?.[ability]?.mod ?? 0) || 0;
    const ranks = Number(actor.system.skills?.[skillKey]?.rank ?? 0) || 0;
    return Math.max(1, 1 + abilityMod + Math.floor(ranks / 2));
}

export function isTechniqueEffectivelyLearned(item) {
    const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
    return item.system.learning?.learned === true || !skillKey;
}

export function buildLearningView(item, actor, mode = getLearningMode()) {
    const learning = item.system.learning ?? {};
    const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
    const targetProgress = getLearningTargetProgress(item, mode);
    const progress = Math.min(Number(learning.progress ?? 0) || 0, targetProgress);
    const attemptsUsed = Number(learning.attemptsUsed ?? 0) || 0;
    const failureInsight = Number(learning.failureInsight ?? 0) || 0;

    return {
        learned: learning.learned === true,
        effectivelyLearned: learning.learned === true || !skillKey,
        progress,
        attemptsUsed,
        failureInsight,
        targetProgress,
        maxAttempts: getLearningMaxAttempts(actor, skillKey),
        mode,
        isFourHourBlocks: mode === LEARNING_MODES.FOUR_HOUR_BLOCKS,
        hasSkill: !!skillKey,
    };
}

function marginAward(margin, mode) {
    if (mode === LEARNING_MODES.STANDARD) return 1;
    if (margin >= 15) return 4;
    const inclusive = game.settings.get(MODULE_ID, "learnMarginInclusive");
    return inclusive ? (margin >= 5 ? 2 : 1) : (margin > 5 ? 2 : 1);
}

function rollTotal(result) {
    return result?.rolls?.[0]?.total ?? result?.roll?.total ?? result?.total ?? null;
}

async function postLearningCard(actor, item, { title, body, cssClass = "" }) {
    await ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<div class="naruto-technique-card learning ${cssClass}">
                    <header><h3>${escapeHTML(title)}</h3></header>
                    ${body}
                  </div>`,
    });
}

async function resetFailureInsightForDifferentTechnique(actor, item, learning) {
    const currentId = foundry.utils.getProperty(actor, learningCurrentTechniqueIdPath);
    if (currentId === item.id) return { ...learning };

    if (currentId) {
        const previous = actor.items.get(currentId);
        if (previous?.system?.learning?.failureInsight) {
            await previous.update({ "system.learning.failureInsight": 0 });
        }
        if (item.system.learning?.failureInsight) {
            await item.update({ "system.learning.failureInsight": 0 });
        }
    }

    await actor.update({ [learningCurrentTechniqueIdPath]: item.id });
    return { ...learning, failureInsight: 0 };
}

export async function attemptLearnTechnique(item) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("Equip this technique on an actor to learn it.");
        return;
    }
    if (!actor.isOwner) {
        ui.notifications.warn(`${actor.name}: you do not have permission to update this actor.`);
        return;
    }

    const learning = item.system.learning ?? {};
    if (learning.learned) {
        ui.notifications.info(`${item.name}: already learned.`);
        return;
    }

    const rank = Number(item.system.rank ?? 1) || 1;
    const level = characterLevel(actor);
    if (rank > level) {
        ui.notifications.warn(`${item.name}: rank ${rank} is higher than ${actor.name}'s level ${level}.`);
        return;
    }

    const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
    if (!skillKey) {
        await item.update({
            "system.learning.learned": true,
            "system.learning.progress": getLearningTargetProgress(item),
            "system.learning.attemptsUsed": learning.attemptsUsed ?? 0,
            "system.learning.failureInsight": 0,
        });
        await actor.update({ [learningCurrentTechniqueIdPath]: null });
        await postLearningCard(actor, item, {
            title: `${item.name} learned`,
            cssClass: "success",
            body: `<p>${escapeHTML(item.system.discipline || "Unmapped discipline")} has no mapped learn skill yet, so this technique is treated as learned for phase 1.</p>`,
        });
        return;
    }

    const ranks = Number(actor.system.skills?.[skillKey]?.rank ?? 0) || 0;
    if (ranks < 1) {
        ui.notifications.warn(`${actor.name}: at least 1 rank in ${pf1.config.skills?.[skillKey] ?? skillKey} is required to learn ${item.name}.`);
        return;
    }

    const activeLearning = await resetFailureInsightForDifferentTechnique(actor, item, learning);
    const failureInsight = Math.min(5, Math.max(0, Number(activeLearning.failureInsight ?? 0) || 0));

    const breakdown = buildLearnCheckBreakdown(actor, skillKey);
    if (!breakdown) {
        ui.notifications.warn(`${actor.name}: learn check data for ${skillKey} is not ready.`);
        return;
    }

    const parts = [...breakdown.parts];
    if (failureInsight > 0) parts.push(`${failureInsight}[Failure Insight]`);

    const learnDC = Number(item.system.derived?.learnDC ?? 10) || 10;
    // PF1e v11.11's d20Roll dialog exposes Take 10/20 together and does not
    // pass through a button override. Rules disallow Take 20; GMs must enforce
    // that table rule until we replace this with a custom dialog.
    const result = await pf1.dice.d20Roll({
        flavor: `Learn: ${item.name}`,
        parts,
        rollData: actor.getRollData?.() ?? {},
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        dc: learnDC,
    });
    if (!result) return;

    const total = rollTotal(result);
    if (!Number.isFinite(total)) {
        ui.notifications.warn(`${item.name}: could not read learn roll total.`);
        return;
    }

    const mode = getLearningMode();
    const targetProgress = getLearningTargetProgress(item, mode);
    const maxAttempts = getLearningMaxAttempts(actor, skillKey);
    const oldProgress = Number(activeLearning.progress ?? 0) || 0;
    const oldAttempts = Number(activeLearning.attemptsUsed ?? 0) || 0;
    const attemptsUsed = oldAttempts + 1;
    const success = total >= learnDC;

    let progress = oldProgress;
    let nextFailureInsight = failureInsight;
    let learned = false;
    let resetRun = false;
    let award = 0;

    if (success) {
        award = marginAward(total - learnDC, mode);
        progress = Math.min(targetProgress, oldProgress + award);
        learned = progress >= targetProgress;
        nextFailureInsight = learned ? 0 : failureInsight;
    } else {
        nextFailureInsight = Math.min(5, failureInsight + 1);
    }

    if (!learned && mode === LEARNING_MODES.STANDARD && attemptsUsed >= maxAttempts) {
        resetRun = true;
        progress = 0;
        nextFailureInsight = 0;
    }

    await item.update({
        "system.learning.learned": learned,
        "system.learning.progress": progress,
        "system.learning.attemptsUsed": resetRun ? 0 : attemptsUsed,
        "system.learning.failureInsight": nextFailureInsight,
    });

    if (learned) {
        await actor.update({ [learningCurrentTechniqueIdPath]: null });
        await postLearningCard(actor, item, {
            title: `${item.name} learned`,
            cssClass: "success",
            body: `<p>Learn check ${total} vs DC ${learnDC}. Progress ${progress}/${targetProgress}.</p>`,
        });
        return;
    }

    if (resetRun) {
        await postLearningCard(actor, item, {
            title: `${item.name} learning failed`,
            cssClass: "failed",
            body: `<p>Learn check ${total} vs DC ${learnDC}. Attempts ${attemptsUsed}/${maxAttempts}; progress is lost and the run starts over.</p>`,
        });
        return;
    }

    const attemptText = mode === LEARNING_MODES.FOUR_HOUR_BLOCKS
        ? `${attemptsUsed} block${attemptsUsed === 1 ? "" : "s"}`
        : `${attemptsUsed}/${maxAttempts} attempts`;
    const resultText = success
        ? `Success, +${award} progress.`
        : `Failure, Failure Insight is now +${nextFailureInsight}.`;

    await postLearningCard(actor, item, {
        title: `Learning ${item.name}`,
        cssClass: success ? "success" : "failed",
        body: `<p>Learn check ${total} vs DC ${learnDC}. ${resultText}</p>
               <footer>Progress ${progress}/${targetProgress}; ${attemptText}.</footer>`,
    });
}
