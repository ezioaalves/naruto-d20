import { MAIN_DISCIPLINES, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";
import { normalizeActionIds } from "../data/action-ids.mjs";
import { attemptLearnTechnique } from "../learn-technique.mjs";
import { performTechnique } from "../use-technique.mjs";
import { resolveDroppedItem } from "../utils/drag-drop.mjs";
import { TechniqueCompendiumBrowser } from "./technique-browser.mjs";
import { TechniqueMedkitApp } from "./technique-medkit-app.mjs";

/**
 * Wire the technique list inside the Chakra tab: discipline filter chips,
 * drop zone (accept techniques from sidebar/compendium), and the per-row
 * open/use/delete buttons. All scoped to `.tab.chakra` so we don't collide
 * with pf1's own listeners on other tabs.
 */
export function registerTechniqueListListeners() {
  Hooks.on("renderActorSheetPF", (app, html, _data) => {
    if (!["character", "npc"].includes(app.actor.type)) return;
    const $html = html instanceof HTMLElement ? $(html) : html;
    const chakraTab = $html.find(".tab.chakra");
    if (!chakraTab.length) return;

    registerMedkitListeners(chakraTab, app.actor);
    registerFilterListeners(chakraTab);
    registerDropListeners(chakraTab, app.actor);
    registerCreateDuplicateDeleteListeners(chakraTab, app.actor);
    registerUseLearnOpenListeners(chakraTab, app.actor);
    registerBrowserListeners(chakraTab);
  });
}

function registerMedkitListeners(chakraTab, actor) {
  const techHeader = chakraTab.find(".techniques-header")[0];
  if (techHeader && !techHeader.querySelector(".naruto-technique-medkit-btn")) {
    techHeader.insertAdjacentHTML(
      "beforeend",
      `
            <a class="naruto-technique-medkit-btn item-control"
               data-tooltip="${game.i18n.localize("NarutoD20.Medkit.HeaderButton")}">
              <i class="fa-solid fa-kit-medical" inert></i>
            </a>
        `,
    );
  }

  chakraTab
    .find(".naruto-technique-medkit-btn")
    .off("click")
    .on("click", (ev) => {
      ev.preventDefault();
      new TechniqueMedkitApp({ actor }).render(true);
    });
}

function registerFilterListeners(chakraTab) {
  const groups = chakraTab.find(".technique-disc-group");
  groups.not('[data-disc="all"]').hide();

  chakraTab
    .find(".technique-filter")
    .off("click")
    .on("click", function () {
      const disc = this.dataset.disc;
      chakraTab.find(".technique-filter").removeClass("active");
      $(this).addClass("active");
      groups.hide();
      groups.filter(`[data-disc="${disc === "all" ? "all" : disc}"]`).show();
    });
}

function registerDropListeners(chakraTab, actor) {
  chakraTab
    .find(".techniques-body")
    .off("dragover drop")
    .on("dragover", (ev) => ev.preventDefault())
    .on("drop", async (ev) => {
      ev.preventDefault();
      // Stop the event reaching pf1's native sheet drop handler (bound on the
      // sheet root with dropSelector:null), which would add a second copy.
      ev.stopPropagation();
      const srcItem = await resolveDroppedItem(ev.originalEvent, { type: TECHNIQUE_ITEM_TYPE });
      if (!srcItem) {
        ui.notifications.warn(game.i18n.localize("NarutoD20.Notifications.OnlyTechniqueDrop"));
        return;
      }
      if (srcItem.parent === actor) return; // already owned
      const itemData = srcItem.toObject();
      normalizeTechniqueActionData(itemData);
      await actor.createEmbeddedDocuments("Item", [itemData]);
    });
}

function registerCreateDuplicateDeleteListeners(chakraTab, actor) {
  chakraTab
    .find(".technique-create")
    .off("click")
    .on("click", async (ev) => {
      ev.preventDefault();
      const [item] = await actor.createEmbeddedDocuments("Item", [
        buildNewTechniqueData(ev.currentTarget.dataset),
      ]);
      item?.sheet?.render(true);
    });

  chakraTab
    .find(".shinobi-technique-delete")
    .off("click")
    .on("click", async (ev) => {
      ev.preventDefault();
      const item = getTechniqueRowItem(actor, ev.currentTarget);
      if (!item) return;
      const ok = await Dialog.confirm({
        title: game.i18n.localize("NarutoD20.App.RemoveTechnique"),
        content: `<p>${game.i18n.format("NarutoD20.App.RemoveTechniqueConfirm", { name: item.name })}</p>`,
      });
      if (ok) await item.delete();
    });

  chakraTab
    .find(".shinobi-technique-duplicate")
    .off("click")
    .on("click", async (ev) => {
      ev.preventDefault();
      const item = getTechniqueRowItem(actor, ev.currentTarget);
      if (!item) return;
      const itemData = item.toObject();
      itemData.name = `${itemData.name} (Copy)`;
      normalizeTechniqueActionData(itemData);
      await actor.createEmbeddedDocuments("Item", [itemData]);
    });
}

function registerUseLearnOpenListeners(chakraTab, actor) {
  chakraTab
    .find(".shinobi-technique-open")
    .off("click")
    .on("click", (ev) => {
      ev.preventDefault();
      getTechniqueRowItem(actor, ev.currentTarget)?.sheet?.render(true);
    });

  chakraTab
    .find(".shinobi-technique-use")
    .off("click")
    .on("click", async (ev) => {
      ev.preventDefault();
      if (ev.currentTarget.classList.contains("disabled")) return;
      const item = getTechniqueRowItem(actor, ev.currentTarget);
      if (!item) return;
      const firstAction = Array.from(item.actions ?? [])[0];
      if (!firstAction) {
        ui.notifications.warn(
          game.i18n.format("NarutoD20.Notifications.NoActionsConfigured", { name: item.name }),
        );
        return;
      }
      await performTechnique(item, firstAction.id, ev);
    });

  chakraTab
    .find(".shinobi-technique-learn")
    .off("click")
    .on("click", async (ev) => {
      ev.preventDefault();
      const item = getTechniqueRowItem(actor, ev.currentTarget);
      if (item) await attemptLearnTechnique(item);
    });
}

function registerBrowserListeners(chakraTab) {
  chakraTab
    .find(".technique-browse")
    .off("click")
    .on("click", (ev) => {
      ev.preventDefault();
      const rank = ev.currentTarget.dataset.rank;
      new TechniqueCompendiumBrowser({ rank }).render(true);
    });
}

function getTechniqueRowItem(actor, element) {
  const id = element.closest(".technique-row")?.dataset.itemId;
  return actor.items.get(id);
}

function buildNewTechniqueData(dataset) {
  const rank = Number(dataset.rank) || 1;
  const system = { rank };
  if (dataset.disc && MAIN_DISCIPLINES.includes(dataset.disc)) system.discipline = dataset.disc;
  return {
    type: TECHNIQUE_ITEM_TYPE,
    name: "New Technique",
    system,
  };
}

function normalizeTechniqueActionData(itemData) {
  const { actions, changed } = normalizeActionIds(itemData.system?.actions);
  if (changed) itemData.system.actions = actions;
}
