const CONFIG_PREFIX = "weaponAttack";

export function getTechniqueWeaponAttackConfig(item) {
    const dict = item.system?.flags?.dictionary ?? {};
    const nested = dict[CONFIG_PREFIX] && typeof dict[CONFIG_PREFIX] === "object" ? dict[CONFIG_PREFIX] : {};
    const read = (key) => nested[key] ?? dict[`${CONFIG_PREFIX}.${key}`];

    const mode = String(read("mode") ?? "").trim();
    if (mode !== "selected") return null;

    return {
        mode,
        filter:      String(read("filter") ?? "meleeWeapon").trim(),
        attackBonus: String(read("attackBonus") ?? "").trim(),
        damageBonus: String(read("damageBonus") ?? "").trim(),
        held:        String(read("held") ?? "").trim(),
    };
}

export async function rollSelectedWeaponAttackWithTechnique({ technique, actor, config, event }) {
    const selection = await selectTechniqueWeaponAttack(actor, technique, config);
    if (!selection) return null;

    const hook = (actionUse) => {
        if (actionUse.actor?.id !== actor.id) return;
        if (actionUse.item?.id !== selection.item.id) return;
        if (actionUse.action?.id !== selection.action.id) return;

        if (config.attackBonus) actionUse.shared.attackBonus.push(config.attackBonus);
        if (config.damageBonus) actionUse.shared.damageBonus.push(config.damageBonus);
    };

    Hooks.on("pf1CreateActionUse", hook);
    try {
        const options = {};
        if (config.held) options.held = config.held;

        return await selection.item.use({
            actionId: selection.action.id,
            skipDialog: false,
            ev: event,
            options,
        });
    } finally {
        Hooks.off("pf1CreateActionUse", hook);
    }
}

async function selectTechniqueWeaponAttack(actor, technique, config) {
    const choices = collectTechniqueWeaponAttackChoices(actor, config.filter);
    if (!choices.length) {
        ui.notifications.warn(`${actor.name}: no valid weapon or attack found for ${technique.name}.`);
        return null;
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const content = renderWeaponAttackSelectorContent(choices);
        const dialog = new Dialog({
            title: `Choose Attack - ${technique.name}`,
            content,
            buttons: {
                roll: {
                    label: game.i18n.localize("PF1.Roll"),
                    callback: (html) => {
                        const index = Number(html.find("input[name='weapon-attack-choice']:checked").val());
                        finish(Number.isInteger(index) ? choices[index] : null);
                    },
                },
                cancel: {
                    label: game.i18n.localize("Cancel"),
                    callback: () => finish(null),
                },
            },
            default: "roll",
            close: () => finish(null),
        });
        dialog.render(true);
    });
}

function collectTechniqueWeaponAttackChoices(actor, filter) {
    const choices = [];
    const includeUnarmed = filter === "meleeOrUnarmed";

    const weaponItems = actor.itemTypes?.weapon ?? actor.items.filter((i) => i.type === "weapon");
    for (const item of weaponItems) {
        if (item.system?.equipped !== true) continue;
        addItemAttackChoices(choices, item, "weapon");
    }

    if (includeUnarmed) {
        const attackItems = actor.itemTypes?.attack ?? actor.items.filter((i) => i.type === "attack");
        for (const item of attackItems) {
            addItemAttackChoices(choices, item, "attack");
        }
    }

    return choices;
}

function addItemAttackChoices(choices, item, kind) {
    for (const action of item.actions ?? []) {
        if (!action.hasAttack || action.isRanged) continue;
        choices.push({ item, action, kind });
    }
}

function renderWeaponAttackSelectorContent(choices) {
    const rows = choices.map(({ item, action, kind }, index) => {
        const checked = index === 0 ? "checked" : "";
        const actionName = action.name && action.name !== item.name ? ` - ${escapeHTML(action.name)}` : "";
        const kindLabel = kind === "weapon" ? "Weapon" : "Attack";
        return `
            <label class="flexrow" style="align-items:center; gap:8px; margin:4px 0;">
                <input type="radio" name="weapon-attack-choice" value="${index}" ${checked}>
                <img src="${escapeHTML(item.img)}" width="32" height="32" style="border:0;">
                <span>
                    <strong>${escapeHTML(item.name)}${actionName}</strong>
                    <small style="display:block;">${kindLabel}</small>
                </span>
            </label>
        `;
    }).join("");

    return `<form><div class="form-group stacked">${rows}</div></form>`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
    })[char]);
}
