import { MODULE_ID } from "../constants.mjs";

const SOURCE_FLAG = MODULE_ID;

/**
 * Entry point: orchestrate buff lookup → target resolution → application.
 * Called from performTechnique after a successful perform check.
 * `action` is the ItemAction that was used — its duration is copied onto the buff.
 */
export async function applyTechniqueBuff(item, actor, action) {
    const auto = item.system.automation;
    if (!auto?.enabled) return;

    if (game.settings.get(MODULE_ID, "buffTargetFiltering") === "off") return;

    const { exact, variants } = await findBuffByName(item.name);

    if (!exact.length && !variants.length) {
        console.warn(`naruto-d20 | No buff found named "${item.name}" in technique-buffs compendia.`);
        return;
    }

    const selectedEntry = exact[0] ?? variants[0];

    let buffDoc;
    if (selectedEntry.packId === null) {
        buffDoc = selectedEntry.worldItem ?? game.items.get(selectedEntry._id);
    } else {
        const pack = game.packs.get(selectedEntry.packId);
        if (!pack) return;
        buffDoc = await pack.getDocument(selectedEntry._id);
    }
    if (!buffDoc) return;

    const applyTargets = _resolveBuffTargets(item, actor);
    if (!applyTargets.length) return;

    const duration = _durationFromAction(action);

    for (const targetActor of applyTargets) {
        await applyBuffToTarget(buffDoc, targetActor, duration);
    }
}

/**
 * Personal techniques always affect their performer. Other technique buffs
 * require an explicit canvas target so debuffs are not accidentally self-applied.
 */
function _resolveBuffTargets(item, actor) {
    const targetMode = item.system?.automation?.targetMode ?? "auto";
    if (targetMode === "self") return [actor];
    if (targetMode === "selected") return _selectedTargetActors();

    if (_isSelfTargetingTechnique(item)) return [actor];

    return _selectedTargetActors();
}

function _selectedTargetActors() {
    const targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    if (targets.length) return targets;

    ui.notifications.warn(game.i18n.localize("NarutoD20.Automation.NoTargets"));
    return [];
}

function _isSelfTargetingTechnique(item) {
    const system = item.system ?? {};
    const range = String(system.range ?? "").trim().toLowerCase();
    const target = String(system.target ?? "").trim().toLowerCase();
    const subtype = String(system.subtype ?? "").trim().toLowerCase();

    if (range.startsWith("personal")) return true;
    if (target === "you" || target.startsWith("you ")) return true;

    return subtype.split(/\s*,\s*/).includes("stance") && target === "";
}

/**
 * Extract duration from the ItemAction that triggered this buff.
 * Returns null to leave the buff's own duration untouched (inst / perm / seeText / missing).
 */
function _durationFromAction(action) {
    // ItemAction exposes duration as a direct property; raw data is the fallback
    const dur = action?.duration ?? action?.data?.duration;
    if (!dur?.units || dur.units === "inst" || dur.units === "perm" || dur.units === "seeText") {
        return null;
    }

    const raw = dur.value;
    let value = "";
    if (raw != null && String(raw).trim() !== "") {
        const actor = action?.item?.actor;
        const rollData = action?.getRollData?.() ?? actor?.getRollData?.() ?? {};
        // Techniques have no caster level — make "cl" resolve to character level.
        if (!Number.isFinite(rollData.cl)) {
            rollData.cl = actor?.system?.details?.level?.value
                ?? actor?.system?.attributes?.hd?.total
                ?? 0;
        }
        const total = RollPF.safeRollSync(String(raw), rollData)?.total;
        value = Number.isFinite(total) ? total : 0;
    }

    return {
        units: String(dur.units),
        value: String(value),
    };
}

/**
 * Search naruto-d20.technique-buffs (and custom compendia) for a buff by name.
 * Also searches world items (game.items) of type "buff" — compendia take priority.
 * Returns { exact: [...], variants: [...] } where variants match "Name (X)" pattern.
 */
export async function findBuffByName(name) {
    const packIds = ["naruto-d20.technique-buffs"];
    const custom = game.settings.get(MODULE_ID, "customBuffCompendia");
    if (custom) {
        for (const id of custom.split(",").map(s => s.trim()).filter(Boolean)) {
            packIds.push(id);
        }
    }

    const exact = [];
    const variants = [];
    const variantPrefix = `${name} (`;

    for (const packId of packIds) {
        const pack = game.packs.get(packId);
        if (!pack) continue;
        const index = await pack.getIndex();
        for (const entry of index) {
            if (entry.name === name) {
                exact.push({ ...entry, packId });
            } else if (entry.name.startsWith(variantPrefix)) {
                variants.push({ ...entry, packId });
            }
        }
    }

    // Search world items after compendia (lower priority)
    for (const item of game.items.filter(i => i.type === "buff")) {
        if (item.name === name) {
            exact.push({ name: item.name, _id: item.id, packId: null, worldItem: item });
        } else if (item.name.startsWith(variantPrefix)) {
            variants.push({ name: item.name, _id: item.id, packId: null, worldItem: item });
        }
    }

    return { exact, variants };
}

/**
 * Apply buff to a single target actor: refresh existing or create from compendium.
 * Tracks origin via flags["naruto-d20"].sourceId so update-vs-create works correctly.
 * If duration is provided it overrides whatever the compendium buff had stored.
 */
export async function applyBuffToTarget(buffDoc, targetActor, duration = null) {
    if (!targetActor.isOwner) {
        ui.notifications.warn(
            game.i18n.format("NarutoD20.Automation.NoPermission", { name: targetActor.name })
        );
        return;
    }

    const sourceId = buffDoc.uuid;
    const existing = targetActor.items.find(
        i => i.flags?.[SOURCE_FLAG]?.sourceId === sourceId
    );

    if (existing) {
        const updates = { "system.active": true };
        if (duration) {
            updates["system.duration.units"] = duration.units;
            updates["system.duration.value"] = duration.value;
        }
        await existing.update(updates);
    } else {
        const itemData = buffDoc.toObject();
        delete itemData._id;

        itemData.flags ??= {};
        itemData.flags[SOURCE_FLAG] ??= {};
        itemData.flags[SOURCE_FLAG].sourceId = sourceId;

        itemData.system ??= {};
        if (duration) {
            itemData.system.duration ??= {};
            itemData.system.duration.units = duration.units;
            itemData.system.duration.value = duration.value;
        }
        itemData.system.active = true;

        await targetActor.createEmbeddedDocuments("Item", [itemData]);
    }
}
