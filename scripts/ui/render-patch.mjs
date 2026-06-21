import { MAIN_DISCIPLINES, MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../core/constants.mjs";
import { TechniqueSynckitApp } from "../features/techniques/sync-app.mjs";
import { renderTechniqueHeader } from "../features/techniques/header.mjs";
import { buildLearningView } from "../features/techniques/learn.mjs";
import { injectHeroStatistics } from "../features/actor-stats/summary-stats.mjs";

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
  standard: "Std",
  full: "Full",
  swift: "Swf",
  immediate: "Imm",
  free: "Free",
  ritual: "Ritual",
};

const COMP_MAP = [
  ["compHandSeals", "H"],
  ["compHalfSeals", "HS"],
  ["compConcentration", "C"],
  ["compMobility", "Mob"],
  ["compFocus", "F"],
  ["compEmpower", "E"],
  ["compMastery", "Mas"],
  ["compExpendable", "Exp"],
  ["compPhysical", "P"],
  ["compXpCost", "XP"],
];

const UNSUPPORTED_EXPANDED_TABS = new Set(["", "chakra", "null", "undefined"]);

function _prepareTechniques(actor) {
  const items = actor.items
    .filter((i) => i.type === TECHNIQUE_ITEM_TYPE)
    .sort((a, b) => a.system.rank - b.system.rank || a.name.localeCompare(b.name));
  const enforceLearning = game.settings.get(MODULE_ID, "enforceLearning");
  const learningMode = game.settings.get(MODULE_ID, "learningProgressionMode");

  const groupByRank = (list) => {
    const map = new Map();
    for (const item of list) {
      const rank = item.system.rank ?? 1;
      const learning = buildLearningView(item, actor, learningMode);
      if (!map.has(rank)) map.set(rank, []);
      map.get(rank).push({
        id: item.id,
        name: item.name,
        img: item.img,
        complexity: item.system.complexity,
        chakraCost: item.system.chakraCost,
        performDC: item.system.derived.performDC,
        hasActions: (item.actions?.size ?? 0) > 0,
        activation: ACTIVATION_ABBREV[item.system.activation] ?? item.system.activation ?? "",
        components: COMP_MAP.filter(([k]) => item.system[k])
          .map(([, a]) => a)
          .join(", "),
        discipline: item.system.discipline ?? "",
        learning,
        canUse: !enforceLearning || learning.effectivelyLearned,
      });
    }
    return [...map.entries()].sort(([a], [b]) => a - b).map(([rank, rows]) => ({ rank, rows }));
  };

  return {
    allGroups: groupByRank(items),
    tabs: [
      ...MAIN_DISCIPLINES.map((disc) => ({
        key: disc.toLowerCase().replace(/\s+/g, "-"),
        label: disc,
        groups: groupByRank(items.filter((t) => t.system.discipline === disc)),
      })),
      {
        key: "other",
        label: "Other",
        groups: groupByRank(items.filter((t) => !MAIN_DISCIPLINES.includes(t.system.discipline))),
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
    console.error(
      "Naruto D20 | pf1.applications.ActorSheetPF._renderInner not found — chakra tab cannot patch",
    );
    return;
  }
  installed = true;

  const originalDefaultOptions = Object.getOwnPropertyDescriptor(
    ActorSheetPF,
    "defaultOptions",
  )?.get;
  if (originalDefaultOptions) {
    Object.defineProperty(ActorSheetPF, "defaultOptions", {
      get() {
        const options = originalDefaultOptions.call(this);
        const scrollY = new Set(options.scrollY ?? []);
        scrollY.add(".techniques-body");
        return { ...options, scrollY: [...scrollY] };
      },
      configurable: true,
    });
  }

  const original = ActorSheetPF.prototype._renderInner;
  ActorSheetPF.prototype._renderInner = async function (...args) {
    // PF1 reopens expanded item summaries inside its own _renderInner, before
    // this wrapper can inject the Chakra tab. Drop entries from injected or
    // malformed tabs so PF1 never dereferences a missing `.tab[data-tab=...]`.
    // Capture the technique item ids so technique-list.mjs can re-expand them
    // after the tab is injected (rebuilt fresh each render to stay in sync with
    // user collapses, which leave _expandedItems directly without a re-render).
    const expandedTechniques = new Set();
    for (const expandedId of [...(this._expandedItems ?? [])]) {
      const parts = String(expandedId).split(".");
      if (UNSUPPORTED_EXPANDED_TABS.has(parts[0])) {
        this._expandedItems.delete(expandedId);
        const itemId = parts[parts.length - 1];
        if (this.actor.items.get(itemId)?.type === TECHNIQUE_ITEM_TYPE) {
          expandedTechniques.add(itemId);
        }
      }
    }
    this._narutoExpandedTechniques = expandedTechniques;

    const $html = await original.apply(this, args);
    if (!["character", "npc"].includes(this.actor.type)) return $html;

    // Hero Statistics (Action Points / Reputation / Wealth) — injected here,
    // pre-paint, rather than via a post-render hook. The old async hook inserted
    // it after the frame painted, which flickered (and flickered worse on sheets
    // that relocate the block). Independent of chakra, so it runs before the
    // hasChakra early-return below.
    await injectHeroStatistics(this, $html, args[0] ?? {});

    if ((this.actor.flags?.[MODULE_ID]?.hasChakra ?? true) === false) return $html;

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
        flags: this.actor.flags || {},
        techniques: _prepareTechniques(this.actor),
      };
      const tplHtml = await foundry.applications.handlebars.renderTemplate(
        `modules/${MODULE_ID}/templates/actor/chakra-tab.hbs`,
        tplData,
      );
      body.append(tplHtml);
    }

    return $html;
  };
}

let chatDataPatchInstalled = false;

/**
 * Wrap ItemPF.prototype.getChatData to inject a "Chakra Resistance" property
 * tag into the item summary for techniques that have system.chakraResistance.
 * This is how pf1's own SR "yes" pill appears for spells.
 */
export function installTechniqueGetChatDataPatch() {
  if (chatDataPatchInstalled) return;
  const ItemPF = pf1?.documents?.item?.ItemPF;
  if (!ItemPF?.prototype?.getChatData) {
    console.error("Naruto D20 | ItemPF.getChatData not found — chakra resistance pill skipped");
    return;
  }
  chatDataPatchInstalled = true;

  const original = ItemPF.prototype.getChatData;
  ItemPF.prototype.getChatData = async function (...args) {
    const data = await original.apply(this, args);
    if (this.type === TECHNIQUE_ITEM_TYPE && this.system?.chakraResistance) {
      data.properties ??= [];
      data.properties.push(game.i18n.localize("NarutoD20.Technique.ChakraResistance.Label"));
    }
    return data;
  };
}

let descriptionPatchInstalled = false;

/**
 * Wrap ItemPF.prototype.getDescription to prepend the technique stat-block header
 * for technique items. This is how PF1e's ItemSpellPF.getDescription prepends
 * spell-header.hbs — the base ItemPF returns the body only, so without this the
 * header (rendered on the sheet) never reaches the chat card / item summary.
 */
export function installTechniqueGetDescriptionPatch() {
  if (descriptionPatchInstalled) return;
  const ItemPF = pf1?.documents?.item?.ItemPF;
  if (!ItemPF?.prototype?.getDescription) {
    console.error("Naruto D20 | ItemPF.getDescription not found — technique chat header skipped");
    return;
  }
  descriptionPatchInstalled = true;

  const original = ItemPF.prototype.getDescription;
  ItemPF.prototype.getDescription = async function (options = {}) {
    const body = await original.call(this, options);
    if (this.type !== TECHNIQUE_ITEM_TYPE || options.header === false) return body;
    const header = await renderTechniqueHeader(this, { chatcard: options.chatcard === true });
    return header + body;
  };
}

let headerButtonInstalled = false;

/**
 * Add the "Sync Techniques" synckit button to the actor sheet's window title bar.
 *
 * pf1 v11.11 actor sheets are V1 Applications and don't override _getHeaderButtons,
 * so we wrap the base ActorSheetPF.prototype._getHeaderButtons once (mirroring the
 * installChakraTabPatch approach) — covering character / npc / lite in one place.
 * Idempotent; must run at "setup" before the first sheet render.
 */
export function installSynckitHeaderButton() {
  if (headerButtonInstalled) return;
  const ActorSheetPF = pf1?.applications?.actor?.ActorSheetPF;
  if (!ActorSheetPF?.prototype?._getHeaderButtons) {
    console.error(
      "Naruto D20 | ActorSheetPF._getHeaderButtons not found — synckit header button skipped",
    );
    return;
  }
  headerButtonInstalled = true;

  const original = ActorSheetPF.prototype._getHeaderButtons;
  ActorSheetPF.prototype._getHeaderButtons = function () {
    const buttons = original.call(this);
    if (["character", "npc"].includes(this.actor?.type)) {
      buttons.unshift({
        label: game.i18n.localize("NarutoD20.Synckit.HeaderButton"),
        class: "naruto-technique-synckit",
        icon: "fa-solid fa-kit-medical",
        onclick: () => new TechniqueSynckitApp({ actor: this.actor }).render(true),
      });
    }
    return buttons;
  };
}
