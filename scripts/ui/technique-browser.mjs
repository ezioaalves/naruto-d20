import { MAIN_DISCIPLINES, MODULE_ID } from "../constants.mjs";
import { COMPLEXITY_TABLE } from "../data/technique-model.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PACK_ID = `${MODULE_ID}.techniques`;

// system.* fields the index must carry so we can filter without loading full docs.
const INDEX_FIELDS = [
    "system.discipline", "system.rank", "system.complexity",
    "system.isHijutsu", "system.isKinjutsu", "system.isCombination",
    "system.compHandSeals", "system.compHalfSeals", "system.compConcentration",
    "system.compMobility", "system.compFocus", "system.compEmpower",
    "system.compMastery", "system.compExpendable", "system.compPhysical", "system.compXpCost",
];

const SPECIAL_FLAGS = {
    isHijutsu:     "Hijutsu",
    isKinjutsu:    "Kinjutsu",
    isCombination: "Combination",
};

const COMPONENT_FLAGS = {
    compHandSeals:     "Hand Seals",
    compHalfSeals:     "Half Seals",
    compConcentration: "Concentration",
    compMobility:      "Mobility",
    compFocus:         "Focus",
    compEmpower:       "Empower",
    compMastery:       "Mastery",
    compExpendable:    "Expendable",
    compPhysical:      "Physical",
    compXpCost:        "XP Cost",
};

const RANKS = Array.from({ length: 15 }, (_, i) => String(i + 1));

/**
 * Custom compendium browser for technique items. The pf1 compendium browser
 * can't list `naruto-d20.technique` items (handledTypes don't include it), so
 * this mirrors its layout (sidebar filters + entry list) over our own pack.
 *
 * Rows are draggable with `{ type: "Item", uuid }` drag data, which the Chakra
 * tab drop zone (technique-list.mjs → resolveDroppedItem) already accepts.
 */
export class TechniqueCompendiumBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "naruto-technique-browser",
        classes: ["pf1", "app", "compendium-browser", "naruto-technique-browser"],
        position: { width: 800, height: 600 },
        window: { resizable: true, title: "Browse Techniques" },
        actions: {
            clearFilters: TechniqueCompendiumBrowser._onClearFilters,
            reload:       TechniqueCompendiumBrowser._onReload,
        },
    };

    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/apps/technique-browser.hbs` },
    };

    /** @type {string} */
    #query = "";
    /** @type {{discipline:Set, rank:Set, complexity:Set, special:Set, components:Set}} */
    #filters = {
        discipline: new Set(),
        rank:       new Set(),
        complexity: new Set(),
        special:    new Set(),
        components: new Set(),
    };
    /** @type {Array|null} cached, mapped index entries */
    #entries = null;
    #loading = true;

    /** Load the pack index (once) and map it to display entries. */
    async #loadEntries({ force = false } = {}) {
        if (this.#entries && !force) return;
        const pack = game.packs.get(PACK_ID);
        if (!pack) {
            ui.notifications.warn("Technique compendium not found.");
            this.#entries = [];
            this.#loading = false;
            return;
        }
        const index = await pack.getIndex({ fields: INDEX_FIELDS });
        this.#entries = index.map((e) => ({
            __uuid:      e.uuid,
            __packLabel: pack.metadata.label,
            name:        e.name,
            img:         e.img,
            system:      e.system ?? {},
        }));
        this.#loading = false;
    }

    /** True if `entry` passes the current search + every active filter group. */
    #matches(entry) {
        const s = entry.system;
        if (this.#query && !entry.name.toLowerCase().includes(this.#query)) return false;

        const { discipline, rank, complexity, special, components } = this.#filters;
        if (discipline.size && !discipline.has(s.discipline)) return false;
        if (rank.size && !rank.has(String(s.rank))) return false;
        if (complexity.size && !complexity.has(s.complexity)) return false;
        // special / components: OR within group — entry must have at least one selected flag true.
        if (special.size && ![...special].some((k) => s[k])) return false;
        if (components.size && ![...components].some((k) => s[k])) return false;
        return true;
    }

    #buildFilterGroup(id, label, choiceMap, activeSet) {
        const choices = Object.entries(choiceMap).map(([key, choiceLabel]) => ({
            key,
            label: choiceLabel,
            active: activeSet.has(key),
        }));
        return { id, label, choices, active: activeSet.size > 0, activeCount: activeSet.size };
    }

    async _prepareContext() {
        await this.#loadEntries();
        const all = this.#entries ?? [];
        const filtered = all.filter((e) => this.#matches(e));

        const disciplineChoices = Object.fromEntries(MAIN_DISCIPLINES.map((d) => [d, d]));
        const rankChoices = Object.fromEntries(RANKS.map((r) => [r, `Rank ${r}`]));
        const complexityChoices = Object.fromEntries(Object.keys(COMPLEXITY_TABLE).map((c) => [c, c]));

        const filters = [
            this.#buildFilterGroup("discipline", "Discipline", disciplineChoices, this.#filters.discipline),
            this.#buildFilterGroup("rank", "Rank", rankChoices, this.#filters.rank),
            this.#buildFilterGroup("complexity", "Complexity", complexityChoices, this.#filters.complexity),
            this.#buildFilterGroup("special", "Special", SPECIAL_FLAGS, this.#filters.special),
            this.#buildFilterGroup("components", "Components", COMPONENT_FLAGS, this.#filters.components),
        ];

        return {
            filters,
            entries:           filtered,
            query:             this.#query,
            itemCount:         all.length,
            filteredItemCount: filtered.length,
            loading:           this.#loading,
        };
    }

    _onRender(_context, _options) {
        const root = this.element;

        const search = root.querySelector('input[name="filter"]');
        if (search) {
            let timer;
            search.addEventListener("input", (ev) => {
                clearTimeout(timer);
                const value = ev.target.value.toLowerCase().trim();
                timer = setTimeout(() => {
                    this.#query = value;
                    this.render();
                }, 200);
            });
        }

        root.querySelectorAll('input[type="checkbox"][name^="filter."]').forEach((cb) => {
            cb.addEventListener("change", (ev) => {
                // name = "filter.<groupId>.choice.<key>"
                const [, groupId, , key] = ev.target.name.split(".");
                const set = this.#filters[groupId];
                if (!set) return;
                if (ev.target.checked) set.add(key);
                else set.delete(key);
                this.render();
            });
        });

        root.querySelectorAll(".entry-name a").forEach((a) => {
            a.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const uuid = ev.currentTarget.closest("[data-uuid]")?.dataset.uuid;
                const doc = uuid ? await fromUuid(uuid) : null;
                doc?.sheet?.render(true);
            });
        });

        root.querySelectorAll("[data-uuid]").forEach((li) => {
            li.addEventListener("dragstart", (ev) => {
                const uuid = li.dataset.uuid;
                if (!uuid) return;
                ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
            });
        });
    }

    static _onClearFilters() {
        this.#query = "";
        for (const set of Object.values(this.#filters)) set.clear();
        this.render();
    }

    static async _onReload() {
        await this.#loadEntries({ force: true });
        this.render();
    }
}
