import { MAIN_DISCIPLINES, MODULE_ID } from "../../core/constants.mjs";
import { COMPLEXITY_TABLE, computeTechniqueDerived } from "./model.mjs";
import { learnTechniqueViaEmpathy } from "./learn.mjs";
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
} from "../../ui/browser-shared.mjs";

const PACK_ID = `${MODULE_ID}.techniques`;

// system.* fields the index must carry so we can filter without loading full docs.
const INDEX_FIELDS = [
  "system.discipline",
  "system.rank",
  "system.complexity",
  "system.isHijutsu",
  "system.isKinjutsu",
  "system.isCombination",
  "system.compHandSeals",
  "system.compHalfSeals",
  "system.compConcentration",
  "system.compMobility",
  "system.compFocus",
  "system.compEmpower",
  "system.compMastery",
  "system.compExpendable",
  "system.compPhysical",
  "system.compXpCost",
];

const SPECIAL_FLAGS = {
  isHijutsu: "Hijutsu",
  isKinjutsu: "Kinjutsu",
  isCombination: "Combination",
};

const COMPONENT_FLAGS = {
  compHandSeals: "Hand Seals",
  compHalfSeals: "Half Seals",
  compConcentration: "Concentration",
  compMobility: "Mobility",
  compFocus: "Focus",
  compEmpower: "Empower",
  compMastery: "Mastery",
  compExpendable: "Expendable",
  compPhysical: "Physical",
  compXpCost: "XP Cost",
};

const RANKS = Array.from({ length: 15 }, (_, i) => String(i + 1));

/**
 * Custom compendium browser for technique items. Extends Application (V1) to
 * match PF1e's own CompendiumBrowser architecture — same window chrome, checkbox
 * styles, and button appearance as the native Spell Browser.
 *
 * Rows are draggable with `{ type: "Item", uuid }` drag data, which the Chakra
 * tab drop zone (technique-list.mjs → resolveDroppedItem) already accepts.
 */
export class TechniqueCompendiumBrowser extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "naruto-technique-browser",
      template: `modules/${MODULE_ID}/templates/apps/technique-browser.hbs`,
      classes: ["pf1", "app", "compendium-browser", "naruto-technique-browser"],
      width: 800,
      height: window.innerHeight - 60,
      top: 30,
      left: 40,
      resizable: true,
      title: game.i18n.localize("NarutoD20.App.BrowseTechniques"),
    });
  }

  /** @type {string} */
  #query = "";
  /** @type {{discipline:Set, rank:Set, complexity:Set, special:Set, components:Set}} */
  #filters = {
    discipline: new Set(),
    rank: new Set(),
    complexity: new Set(),
    special: new Set(),
    components: new Set(),
  };
  /** @type {Set<string>} filter group IDs that are currently collapsed */
  #collapsed = new Set();
  /** @type {Array|null} cached, mapped index entries */
  #entries = null;
  #loading = true;
  /** Restore search focus after re-render when true */
  #focusSearch = false;
  #searchSelection = null;
  /** Empathy-learn mode: pick a technique to learn by spending Empathy Points. */
  empathyMode = false;
  /** @type {Actor|null} target actor for Empathy-learn picks */
  actor = null;

  constructor(options = {}) {
    super(options);
    // All groups start collapsed except Rank, which shows immediately.
    this.#collapsed = new Set(["discipline", "complexity", "special", "components"]);
    if (options.rank) this.#filters.rank.add(String(options.rank));
    this.empathyMode = !!options.empathyMode;
    this.actor = options.actor ?? null;
    if (this.empathyMode) {
      this.options.title = game.i18n.localize("NarutoD20.App.LearnWithEmpathy");
    }
  }

  /** Load the pack index (once) and map it to display entries. */
  async #loadEntries({ force = false } = {}) {
    if (this.#entries && !force) return;
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      ui.notifications.warn(
        game.i18n.localize("NarutoD20.Notifications.TechniqueCompendiumNotFound"),
      );
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
    }));
    this.#loading = false;
  }

  /** True if `entry` passes the current search + every active filter group. */
  #matches(entry) {
    const s = entry.system;
    const query = this.#query.toLowerCase().trim();
    if (query && !entry.name.toLowerCase().includes(query)) return false;

    const { discipline, rank, complexity, special, components } = this.#filters;
    if (discipline.size && !discipline.has(s.discipline)) return false;
    if (rank.size && !rank.has(String(s.rank))) return false;
    if (complexity.size && !complexity.has(s.complexity)) return false;
    // special / components: OR within group — entry must have at least one selected flag true.
    if (special.size && ![...special].some((k) => s[k])) return false;
    if (components.size && ![...components].some((k) => s[k])) return false;
    return true;
  }

  async getData() {
    await this.#loadEntries();
    const all = this.#entries ?? [];
    let filtered = all.filter((e) => this.#matches(e));
    if (this.empathyMode) {
      filtered = filtered.map((e) => ({
        ...e,
        threshold: computeTechniqueDerived(e.system).skillThreshold,
      }));
    }

    const disciplineChoices = Object.fromEntries(MAIN_DISCIPLINES.map((d) => [d, d]));
    const rankChoices = Object.fromEntries(RANKS.map((r) => [r, `Rank ${r}`]));
    const complexityChoices = Object.fromEntries(Object.keys(COMPLEXITY_TABLE).map((c) => [c, c]));

    const filters = [
      buildFilterGroup(
        "discipline",
        "Discipline",
        disciplineChoices,
        this.#filters.discipline,
        this.#collapsed,
      ),
      buildFilterGroup("rank", "Rank", rankChoices, this.#filters.rank, this.#collapsed),
      buildFilterGroup(
        "complexity",
        "Complexity",
        complexityChoices,
        this.#filters.complexity,
        this.#collapsed,
      ),
      buildFilterGroup("special", "Special", SPECIAL_FLAGS, this.#filters.special, this.#collapsed),
      buildFilterGroup(
        "components",
        "Components",
        COMPONENT_FLAGS,
        this.#filters.components,
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
      empathyMode: this.empathyMode,
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

    if (this.empathyMode && this.actor) {
      root.querySelectorAll(".empathy-learn").forEach((btn) => {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const uuid = ev.currentTarget.closest("[data-uuid]")?.dataset.uuid;
          const src = uuid ? await fromUuid(uuid) : null;
          if (src) await learnTechniqueViaEmpathy(this.actor, src);
        });
      });
    }

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
