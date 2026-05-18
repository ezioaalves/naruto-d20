import { MAIN_DISCIPLINES, MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";

// pf1 11.11 uses V1 ApplicationV1. Its render flow is (foundry.mjs:37369–37406):
//   1. _renderInner(data) → returns the full new inner HTML
//   2. _replaceHTML → swaps it into the DOM
//   3. _activateCoreListeners → calls _tabs[0].bind(content), which re-runs
//      Tabs.activate(this.active). If our chakra <a> is NOT in the nav yet,
//      Tabs.activate (foundry.mjs:36898–36900) falls back to items[0] = "summary"
//      and corrupts _tabs[0].active. THEN renderActorSheetPF hooks fire.
//
// The classic renderActorSheetPF hook injects too late and the user snaps
// to Summary. We fix it by wrapping _renderInner to add the chakra nav + content
// BEFORE the framework binds tabs.

const ACTIVATION_ABBREV = {
    "standard":  "Std",
    "full":      "Full",
    "swift":     "Swf",
    "immediate": "Imm",
    "free":      "Free",
    "ritual":    "Ritual",
};

const COMP_MAP = [
    ["compHandSeals",     "H"],
    ["compHalfSeals",     "HS"],
    ["compConcentration", "C"],
    ["compMobility",      "Mob"],
    ["compFocus",         "F"],
    ["compEmpower",       "E"],
    ["compMastery",       "Mas"],
    ["compExpendable",    "Exp"],
    ["compPhysical",      "P"],
    ["compXpCost",        "XP"],
];

function _prepareTechniques(actor) {
    const items = actor.items
        .filter(i => i.type === TECHNIQUE_ITEM_TYPE)
        .sort((a, b) => (a.system.rank - b.system.rank) || a.name.localeCompare(b.name));

    const groupByRank = (list) => {
        const map = new Map();
        for (const item of list) {
            const rank = item.system.rank ?? 1;
            if (!map.has(rank)) map.set(rank, []);
            map.get(rank).push({
                id:         item.id,
                name:       item.name,
                img:        item.img,
                complexity: item.system.complexity,
                chakraCost: item.system.chakraCost,
                performDC:  item.system.derived.performDC,
                hasActions: (item.actions?.size ?? 0) > 0,
                activation: ACTIVATION_ABBREV[item.system.activation] ?? item.system.activation ?? "",
                components: COMP_MAP.filter(([k]) => item.system[k]).map(([, a]) => a).join(", "),
                discipline: item.system.discipline ?? "",
            });
        }
        return [...map.entries()]
            .sort(([a], [b]) => a - b)
            .map(([rank, rows]) => ({ rank, rows }));
    };

    return {
        allGroups: groupByRank(items),
        tabs: [
            ...MAIN_DISCIPLINES.map(disc => ({
                key:    disc.toLowerCase().replace(/\s+/g, "-"),
                label:  disc,
                groups: groupByRank(items.filter(t => t.system.discipline === disc)),
            })),
            {
                key:    "other",
                label:  "Other",
                groups: groupByRank(items.filter(t => !MAIN_DISCIPLINES.includes(t.system.discipline))),
            },
        ],
        count: items.length,
    };
}

let installed = false;

/**
 * Install the _renderInner wrapper on ActorSheetPF.prototype. Idempotent.
 * Must run at "setup" (before the first sheet renders).
 */
export function installChakraTabPatch() {
    if (installed) return;
    const ActorSheetPF = pf1?.applications?.actor?.ActorSheetPF;
    if (!ActorSheetPF?.prototype?._renderInner) {
        console.error("Naruto D20 | pf1.applications.ActorSheetPF._renderInner not found — chakra tab cannot patch");
        return;
    }
    installed = true;

    const original = ActorSheetPF.prototype._renderInner;
    ActorSheetPF.prototype._renderInner = async function (...args) {
        const $html = await original.apply(this, args);
        if (!["character", "npc"].includes(this.actor.type)) return $html;

        // Nav <a> — must be present before _activateCoreListeners binds tabs,
        // otherwise Tabs.activate("chakra") falls back to "summary".
        const nav = $html.find("nav.sheet-navigation.tabs[data-group='primary']");
        if (nav.length && !nav.find('[data-tab="chakra"]').length) {
            nav.append('<a class="item" data-tab="chakra" data-group="primary">Chakra</a>');
        }

        // Content <div>. Tab visibility (.active toggling) is handled by
        // Foundry's V1 Tabs system via the data-tab/data-group attributes.
        const body = $html.find("section.primary-body");
        if (body.length && !body.find('[data-tab="chakra"]').length) {
            const data = args[0] ?? {};
            const tplData = {
                ...data,
                flags:      this.actor.flags || {},
                techniques: _prepareTechniques(this.actor),
            };
            const tplHtml = await foundry.applications.handlebars.renderTemplate(
                `modules/${MODULE_ID}/templates/actor/chakra-tab.hbs`,
                tplData
            );
            body.append(tplHtml);
        }

        return $html;
    };
}
