import { MODULE_ID } from "../constants.mjs";

const CHARGE_PENALTY_SOURCE_ID = `${MODULE_ID}.chargeDefensePenalty`;

export function registerChargeDefensePenalty() {
    Hooks.on("pf1PostActionUse", async (actionUse) => {
        if (!_isChargeActionUse(actionUse)) return;

        try {
            await applyChargeDefensePenalty(actionUse.actor);
        } catch (err) {
            console.error("naruto-d20 | failed to apply charge defense penalty:", err);
            ui.notifications.warn("Charge defense penalty automation failed. See console.");
        }
    });
}

export async function applyChargeDefensePenalty(actor) {
    if (!actor?.isOwner) return;

    const existing = getChargeDefensePenaltyBuff(actor);
    const duration = {
        value: "1",
        units: "round",
        end: "turnStart",
        start: game.time.worldTime,
    };

    if (existing) {
        await existing.update({
            "system.active": true,
            "system.duration.value": duration.value,
            "system.duration.units": duration.units,
            "system.duration.end": duration.end,
            "system.duration.start": duration.start,
        });
        return;
    }

    await actor.createEmbeddedDocuments("Item", [_createChargePenaltyBuffData(duration)]);
}

export function getChargeDefensePenaltyBuff(actor) {
    return actor?.items?.find((item) => item.flags?.[MODULE_ID]?.sourceId === CHARGE_PENALTY_SOURCE_ID) ?? null;
}

export function isChargeDefensePenaltyBuff(item) {
    if (item?.type !== "buff") return false;

    const system = item.system ?? {};
    const duration = system.duration ?? {};
    if (duration.units !== "round") return false;
    if (String(duration.value ?? "").trim() !== "1") return false;
    if ((duration.end ?? "turnStart") !== "turnStart") return false;

    const changes = Array.from(system.changes ?? []);
    const meaningfulChanges = changes.filter((change) => change?.target || change?.formula);
    if (meaningfulChanges.length !== 1) return false;

    const [change] = meaningfulChanges;
    return change.target === "ac"
        && String(change.formula ?? "").trim() === "-2"
        && (change.operator ?? "add") === "add";
}

function _isChargeActionUse(actionUse) {
    return actionUse?.actor
        && actionUse.action?.hasAttack
        && actionUse.shared?.charge === true;
}

function _createChargePenaltyBuffData(duration) {
    return {
        name: game.i18n.localize("PF1.Charge"),
        type: "buff",
        img: "systems/pf1/icons/actions/gladius.svg",
        flags: {
            [MODULE_ID]: {
                sourceId: CHARGE_PENALTY_SOURCE_ID,
            },
        },
        system: {
            description: {
                value: "",
                instructions: "",
            },
            changes: [
                {
                    _id: foundry.utils.randomID(8),
                    type: "untyped",
                    operator: "add",
                    priority: 0,
                    target: "ac",
                    formula: "-2",
                    flavor: game.i18n.localize("PF1.Charge"),
                },
            ],
            subType: "temp",
            active: true,
            duration,
        },
    };
}
