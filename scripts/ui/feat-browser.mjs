import { MAIN_DISCIPLINES, MODULE_ID } from "../constants.mjs";
import {
  buildFilterGroup,
  clearFilterSets,
  registerBrowserSearch,
  registerCheckboxFilterListeners,
  registerClearFiltersListener,
  registerEntryOpenListeners,
  registerFilterCollapseListeners,
  registerReloadListener,
  registerUuidDragStartListeners,
  restoreSearchFocus,
} from "./browser-shared.mjs";

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
      id: "naruto-feat-browser",
      template: `modules/${MODULE_ID}/templates/apps/feat-browser.hbs`,
      classes: ["pf1", "app", "compendium-browser", "naruto-feat-browser"],
      width: 800,
      height: window.innerHeight - 60,
      top: 30,
      left: 40,
      resizable: true,
      title: game.i18n.localize("NarutoD20.App.BrowseFeats"),
    });
  }

  /** @type {string} */
  #query = "";
  /** @type {{ subType: Set, discipline: Set, abilityType: Set }} */
  #filters = {
    subType: new Set(),
    discipline: new Set(),
    abilityType: new Set(),
  };
  /** @type {Set<string>} filter group IDs that are currently collapsed */
  #collapsed = new Set();
  /** @type {Array|null} cached, mapped index entries */
  #entries = null;
  #loading = true;
  /** Restore search focus after re-render when true */
  #focusSearch = false;
  #searchSelection = null;

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
      ui.notifications.warn(game.i18n.localize("NarutoD20.Notifications.FeatsCompendiumNotFound"));
      this.#entries = [];
      this.#loading = false;
      return;
    }
    const index = await pack.getIndex({ fields: INDEX_FIELDS });
    this.#entries = index.map((e) => ({
      __uuid: e.uuid,
      __packLabel: pack.metadata.label,
      name: e.name,
      img: e.img,
      system: e.system ?? {},
      flags: e.flags ?? {},
      // Flattened for Handlebars — flags["naruto-d20"] can't be accessed via dot notation.
      narutoFlags: e.flags?.[MODULE_ID] ?? {},
    }));
    this.#loading = false;
  }

  /** True if `entry` passes the current search + every active filter group. */
  #matches(entry) {
    const s = entry.system;
    const nf = entry.flags?.[MODULE_ID] ?? {};
    const query = this.#query.toLowerCase().trim();
    if (query && !entry.name.toLowerCase().includes(query)) return false;

    const { subType, discipline, abilityType } = this.#filters;
    if (subType.size && !subType.has(s.subType)) return false;
    // discipline is OR: entry must have the selected discipline set in its flag
    if (discipline.size && !discipline.has(nf.discipline)) return false;
    if (abilityType.size && !abilityType.has(s.abilityType)) return false;
    return true;
  }

  async getData() {
    await this.#loadEntries();
    const all = this.#entries ?? [];
    const filtered = all.filter((e) => this.#matches(e));

    // Build choices from pf1.config when available; fall back to hardcoded labels.
    const featTypeConfig = pf1?.config?.featTypes ?? {};
    const subTypeChoices = Object.keys(featTypeConfig).length
      ? Object.fromEntries(
          Object.entries(featTypeConfig).map(([k, v]) => [k, game.i18n.localize(v)]),
        )
      : {
          feat: "Feat",
          classFeat: "Class Feature",
          trait: "Trait",
          racial: "Racial",
          misc: "Misc",
          template: "Template",
        };

    const disciplineChoices = Object.fromEntries(MAIN_DISCIPLINES.map((d) => [d, d]));

    const abilityTypeConfig = pf1?.config?.abilityTypes ?? {};
    const abilityChoices = Object.keys(abilityTypeConfig).length
      ? Object.fromEntries(
          Object.entries(abilityTypeConfig)
            .filter(([k]) => k !== "na")
            .map(([k, v]) => [k, game.i18n.localize(v.short)]),
        )
      : { ex: "Ex", su: "Su", sp: "Sp" };

    const filters = [
      buildFilterGroup("subType", "Type", subTypeChoices, this.#filters.subType, this.#collapsed),
      buildFilterGroup(
        "discipline",
        "Discipline",
        disciplineChoices,
        this.#filters.discipline,
        this.#collapsed,
      ),
      buildFilterGroup(
        "abilityType",
        "Ability Type",
        abilityChoices,
        this.#filters.abilityType,
        this.#collapsed,
      ),
    ];

    return {
      filters,
      entries: filtered,
      query: this.#query,
      itemCount: all.length,
      filteredItemCount: filtered.length,
      loading: this.#loading,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];

    if (this.#focusSearch) {
      restoreSearchFocus(root, this.#searchSelection);
      this.#focusSearch = false;
      this.#searchSelection = null;
    }

    registerBrowserSearch(root, ({ value, selection }) => {
      this.#query = value;
      this.#searchSelection = selection;
      this.#focusSearch = true;
      this.render();
    });
    registerCheckboxFilterListeners(root, this.#filters, () => this.render());
    registerFilterCollapseListeners(root, this.#collapsed);
    registerEntryOpenListeners(root);
    registerUuidDragStartListeners(root);

    registerReloadListener(root, async () => {
      await this.#loadEntries({ force: true });
      this.render();
    });

    registerClearFiltersListener(root, () => {
      this.#query = "";
      this.#searchSelection = null;
      clearFilterSets(this.#filters);
      this.render();
    });
  }
}
