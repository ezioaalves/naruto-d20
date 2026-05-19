import { MODULE_ID } from "../constants.mjs";

const SOURCE_FLAG = MODULE_ID;

/**
 * Entry point: orchestrate buff lookup → target resolution → application.
 * Called from performTechnique after a successful perform check.
 */
export async function applyTechniqueBuff(item, actor) {
    const auto = item.system.automation;
    if (!auto?.enabled) return;

    const targetFilterSetting = game.settings.get(MODULE_ID, "buffTargetFiltering");
    if (targetFilterSetting === "off") return;

    const buffName = auto.buffName?.trim() || item.name;
    const { exact, variants } = await findBuffByName(buffName);

    if (!exact.length && !variants.length) {
        console.warn(`naruto-d20 | No buff found named "${buffName}" in technique-buffs compendia.`);
        return;
    }

    let selectedEntry;
    if (exact.length) {
        selectedEntry = exact[0];
    } else if (auto.promptVariant && variants.length > 1) {
        selectedEntry = await promptVariantSelection(variants);
        if (!selectedEntry) return;
    } else {
        selectedEntry = variants[0];
    }

    const pack = game.packs.get(selectedEntry.packId);
    if (!pack) return;
    const buffDoc = await pack.getDocument(selectedEntry._id);
    if (!buffDoc) return;

    const effectiveMode = targetFilterSetting === "manualAlways"
        ? "manual"
        : (auto.targetMode ?? "self");

    const targets = await gatherTargets(actor, effectiveMode);
    if (!targets.length) {
        ui.notifications.warn(game.i18n.localize("NarutoD20.Automation.NoTargets"));
        return;
    }

    const casterToken = actor.getActiveTokens()[0] ?? null;
    const duration = resolveDuration(item, casterToken);

    for (const targetActor of targets) {
        await applyBuffToTarget(buffDoc, targetActor, duration);
    }
}

/**
 * Search naruto-d20.technique-buffs (and custom compendia) for a buff by name.
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

    return { exact, variants };
}

/**
 * Dialog for choosing among variant buffs (e.g. "Katon (Fire)", "Katon (Water)").
 */
export async function promptVariantSelection(variants) {
    return new Promise((resolve) => {
        const buttons = {};
        for (const v of variants) {
            const match = v.name.match(/\(([^)]+)\)$/);
            const label = match ? match[1] : v.name;
            buttons[v._id] = { label, callback: () => resolve(v) };
        }
        buttons._cancel = {
            label: game.i18n.localize("Cancel"),
            callback: () => resolve(null),
        };
        new Dialog({
            title: game.i18n.localize("NarutoD20.Automation.VariantDialog.Title"),
            content: `<p>${game.i18n.localize("NarutoD20.Automation.VariantDialog.Hint")}</p>`,
            buttons,
            default: "_cancel",
        }).render(true);
    });
}

/**
 * Resolve which actors to apply the buff to based on targetMode.
 */
export async function gatherTargets(actor, mode) {
    if (mode === "self") return [actor];

    if (mode === "selected") {
        return [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
    }

    if (mode === "allies" || mode === "enemies") {
        if (!canvas?.tokens?.placeables) return [actor];
        const casterToken = actor.getActiveTokens()[0];
        if (!casterToken) return [actor];
        const casterDisp = casterToken.document.disposition;
        return canvas.tokens.placeables
            .filter(t => {
                if (!t.actor) return false;
                const d = t.document.disposition;
                return mode === "allies" ? d === casterDisp : d !== casterDisp;
            })
            .map(t => t.actor);
    }

    if (mode === "manual") return _promptManualTargets();

    return [actor];
}

async function _promptManualTargets() {
    if (!canvas?.tokens?.placeables) return [];
    const tokens = canvas.tokens.placeables.filter(t => t.actor);
    if (!tokens.length) return [];

    return new Promise((resolve) => {
        const rows = tokens.map(t =>
            `<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer">
               <input type="checkbox" value="${t.id}" checked>
               <img src="${t.actor.img}" width="24" height="24" style="border:none;object-fit:cover">
               <span>${t.name}</span>
             </label>`
        ).join("");
        new Dialog({
            title: game.i18n.localize("NarutoD20.Automation.ManualTargetDialog.Title"),
            content: `<form style="padding:8px;max-height:320px;overflow-y:auto">${rows}</form>`,
            buttons: {
                ok: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("Confirm"),
                    callback: (html) => {
                        const ids = [...html.find("input:checked")].map(el => el.value);
                        resolve(tokens.filter(t => ids.includes(t.id)).map(t => t.actor).filter(Boolean));
                    },
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("Cancel"),
                    callback: () => resolve([]),
                },
            },
            default: "ok",
        }).render(true);
    });
}

/**
 * Compute duration override. Returns null to keep the buff item's own duration.
 */
export function resolveDuration(item, _casterToken) {
    const da = item.system.durationAutomation;
    if (!da?.units) return null;
    let value = da.value || "1";
    if (da.perRank) {
        const rank = item.system.rank ?? 1;
        value = `(${value}) * ${rank}`;
    }
    return { units: da.units, value };
}

/**
 * Apply buff to a single target actor: refresh existing or create from compendium.
 * Tracks origin via flags["naruto-d20"].sourceId so update-vs-create logic works.
 */
export async function applyBuffToTarget(buffDoc, targetActor, duration) {
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
