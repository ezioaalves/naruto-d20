import { MAIN_DISCIPLINES, MODULE_ID } from "../constants.mjs";

const PACK_ID = `${MODULE_ID}.feats`;

// system.* and flags.* fields included in the pack index for filter/display.
const INDEX_FIELDS = [
    "system.subType",
    "system.abilityType",
    "system.associations.classes",
    "system.description.summary",
    `flags.${MODULE_ID}.discipline`,
    `flags.${MODULE_ID}.source`,
    `flags.${MODULE_ID}.tags`,
];

/**
 * Custom compendium browser for Naruto feat items. Extends Application (V1) to
 * match PF1e's own CompendiumBrowser architecture — same window chrome, checkbox
 * styles, and button colours as the native Feat Browser.
 *
 * Rows are draggable with `{ type: "Item", uuid }` drag data. The PF1e character
 * sheet's Features tab already handles drops for native feat items; no additional
 * drop-zone code is needed.
 */
export class NarutoFeatBrowser extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id:        "naruto-feat-browser",
            template:  `modules/${MODULE_ID}/templates/apps/feat-browser.hbs`,
            classes:   ["pf1", "app", "compendium-browser", "naruto-feat-browser"],
            width:     800,
            height:    window.innerHeight - 60,
            top:       30,
            left:      40,
            resizable: true,
            title:     "Browse Naruto Feats",
        });
    }

    /** @type {string} */
    #query = "";
    /** @type {{ subType: Set, discipline: Set, abilityType: Set }} */
    #filters = {
        subType:     new Set(),
        discipline:  new Set(),
        abilityType: new Set(),
    };
    /** @type {Set<string>} filter group IDs that are currently collapsed */
    #collapsed = new Set();
    /** @type {Array|null} cached, mapped index entries */
    #entries = null;
    #loading = true;
    /** Restore search focus after re-render when true */
    #focusSearch = false;

    constructor(options = {}) {
        super(options);
        // subType group starts expanded; the other two start collapsed.
        this.#collapsed = new Set(["discipline", "abilityType"]);
        if (options.subType) this.#filters.subType.add(options.subType);
    }

    /** Load the pack index (once) and map entries to display objects. */
    async #loadEntries({ force = false } = {}) {
        if (this.#entries && !force) return;
        const pack = game.packs.get(PACK_ID);
        if (!pack) {
            ui.notifications.warn("Naruto feats compendium not found.");
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
            flags:       e.flags ?? {},
            // Flattened for Handlebars — flags["naruto-d20"] can't be accessed via dot notation.
            narutoFlags: e.flags?.[MODULE_ID] ?? {},
        }));
        this.#loading = false;
    }

    /** True if `entry` passes the current search + every active filter group. */
    #matches(entry) {
        const s = entry.system;
        const nf = entry.flags?.[MODULE_ID] ?? {};
        if (this.#query && !entry.name.toLowerCase().includes(this.#query)) return false;

        const { subType, discipline, abilityType } = this.#filters;
        if (subType.size && !subType.has(s.subType)) return false;
        // discipline is OR: entry must have the selected discipline set in its flag
        if (discipline.size && !discipline.has(nf.discipline)) return false;
        if (abilityType.size && !abilityType.has(s.abilityType)) return false;
        return true;
    }

    #buildFilterGroup(id, label, choiceMap, activeSet) {
        const choices = Object.entries(choiceMap).map(([key, choiceLabel]) => ({
            key,
            label:  choiceLabel,
            active: activeSet.has(key),
        }));
        return {
            id,
            label,
            choices,
            active:      activeSet.size > 0,
            activeCount: activeSet.size,
            collapsed:   this.#collapsed.has(id) ? "collapsed" : "",
        };
    }

    async getData() {
        await this.#loadEntries();
        const all = this.#entries ?? [];
        const filtered = all.filter((e) => this.#matches(e));

        // Build choices from pf1.config when available; fall back to hardcoded labels.
        const featTypeConfig = pf1?.config?.featTypes ?? {};
        const subTypeChoices = Object.keys(featTypeConfig).length
            ? Object.fromEntries(
                Object.entries(featTypeConfig).map(([k, v]) => [k, game.i18n.localize(v)])
              )
            : {
                feat:      "Feat",
                classFeat: "Class Feature",
                trait:     "Trait",
                racial:    "Racial",
                misc:      "Misc",
                template:  "Template",
              };

        const disciplineChoices = Object.fromEntries(MAIN_DISCIPLINES.map((d) => [d, d]));

        const abilityTypeConfig = pf1?.config?.abilityTypes ?? {};
        const abilityChoices = Object.keys(abilityTypeConfig).length
            ? Object.fromEntries(
                Object.entries(abilityTypeConfig)
                    .filter(([k]) => k !== "na")
                    .map(([k, v]) => [k, game.i18n.localize(v.short)])
              )
            : { ex: "Ex", su: "Su", sp: "Sp" };

        const filters = [
            this.#buildFilterGroup("subType",     "Type",         subTypeChoices,    this.#filters.subType),
            this.#buildFilterGroup("discipline",  "Discipline",   disciplineChoices, this.#filters.discipline),
            this.#buildFilterGroup("abilityType", "Ability Type", abilityChoices,    this.#filters.abilityType),
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

    activateListeners(html) {
        super.activateListeners(html);
        const root = html[0];

        if (this.#focusSearch) {
            const inp = root.querySelector('input[name="filter"]');
            if (inp) {
                inp.focus();
                const len = inp.value.length;
                inp.setSelectionRange(len, len);
            }
            this.#focusSearch = false;
        }

        // Search — 200 ms debounce, restores focus after re-render
        const search = root.querySelector('input[name="filter"]');
        if (search) {
            let timer;
            search.addEventListener("input", (ev) => {
                clearTimeout(timer);
                const value = ev.target.value.toLowerCase().trim();
                timer = setTimeout(() => {
                    this.#query = value;
                    this.#focusSearch = true;
                    this.render();
                }, 200);
            });
        }

        // Checkbox filters — name="filter.<groupId>.choice.<key>"
        root.querySelectorAll('input[type="checkbox"][name^="filter."]').forEach((cb) => {
            cb.addEventListener("change", (ev) => {
                const [, groupId, , key] = ev.target.name.split(".");
                const set = this.#filters[groupId];
                if (!set) return;
                if (ev.target.checked) set.add(key);
                else set.delete(key);
                this.render();
            });
        });

        // Collapsible filter headers — toggle class directly, no full re-render
        root.querySelectorAll(".filter h3").forEach((h3) => {
            h3.style.cursor = "pointer";
            h3.addEventListener("click", (ev) => {
                if (ev.target.closest(".filter-count")) return;
                const filterEl = h3.closest("[data-filter-id]");
                const id = filterEl?.dataset.filterId;
                if (!id) return;
                if (this.#collapsed.has(id)) this.#collapsed.delete(id);
                else this.#collapsed.add(id);
                filterEl.querySelector(".filter-content")
                    ?.classList.toggle("collapsed", this.#collapsed.has(id));
            });
        });

        // Name click → open compendium sheet (read-only)
        root.querySelectorAll(".entry-name a").forEach((a) => {
            a.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const uuid = ev.currentTarget.closest("[data-uuid]")?.dataset.uuid;
                const doc = uuid ? await fromUuid(uuid) : null;
                doc?.sheet?.render(true);
            });
        });

        // Drag-and-drop — PF1 features tab accepts { type: "Item", uuid } natively
        root.querySelectorAll("[data-uuid]").forEach((li) => {
            li.addEventListener("dragstart", (ev) => {
                const uuid = li.dataset.uuid;
                if (!uuid) return;
                ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
            });
        });

        root.querySelector(".reload")?.addEventListener("click", async () => {
            await this.#loadEntries({ force: true });
            this.render();
        });

        root.querySelector(".clear-filters")?.addEventListener("click", () => {
            this.#query = "";
            for (const set of Object.values(this.#filters)) set.clear();
            this.render();
        });
    }
}
