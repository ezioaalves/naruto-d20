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

        chakraTab[0].addEventListener("click", (ev) => {
            if (!(ev.target instanceof Element)) return;
            if (!ev.target.closest(".technique-row .item-name")) return;
            ev.stopPropagation();
        }, { capture: true });

        // Medkit button in the Techniques header (mirror of the window-title button)
        const techHeader = chakraTab.find(".techniques-header")[0];
        if (techHeader && !techHeader.querySelector(".naruto-technique-medkit-btn")) {
            techHeader.insertAdjacentHTML("beforeend", `
                <a class="naruto-technique-medkit-btn item-control"
                   data-tooltip="${game.i18n.localize("NarutoD20.Medkit.HeaderButton")}">
                  <i class="fa-solid fa-kit-medical" inert></i>
                </a>
            `);
        }
        chakraTab.find(".naruto-technique-medkit-btn").off("click").on("click", (ev) => {
            ev.preventDefault();
            new TechniqueMedkitApp({ actor: app.actor }).render(true);
        });

        // Discipline filter chips
        const groups = chakraTab.find(".technique-disc-group");
        groups.not('[data-disc="all"]').hide();

        chakraTab.find(".technique-filter").off("click").on("click", function () {
            const disc = this.dataset.disc;
            chakraTab.find(".technique-filter").removeClass("active");
            $(this).addClass("active");
            if (disc === "all") {
                groups.hide();
                groups.filter('[data-disc="all"]').show();
            } else {
                groups.hide();
                groups.filter(`[data-disc="${disc}"]`).show();
            }
        });

        // Drop zone — accept technique items dragged from sidebar / compendium
        chakraTab.find(".techniques-body")
            .off("dragover drop")
            .on("dragover", (ev) => ev.preventDefault())
            .on("drop", async (ev) => {
                ev.preventDefault();
                // Stop the event reaching pf1's native sheet drop handler (bound on the
                // sheet root with dropSelector:null), which would add a second copy.
                ev.stopPropagation();
                const srcItem = await resolveDroppedItem(ev.originalEvent, { type: TECHNIQUE_ITEM_TYPE });
                if (!srcItem) {
                    ui.notifications.warn("Only Technique items can be dropped here.");
                    return;
                }
                if (srcItem.parent === app.actor) return; // already owned
                const itemData = srcItem.toObject();
                const { actions, changed } = normalizeActionIds(itemData.system?.actions);
                if (changed) itemData.system.actions = actions;
                await app.actor.createEmbeddedDocuments("Item", [itemData]);
            });

        // Create a technique directly on the actor and open its sheet
        chakraTab.find(".technique-create").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const ds = ev.currentTarget.dataset;
            const rank = Number(ds.rank) || 1;
            const system = { rank };
            if (ds.disc && MAIN_DISCIPLINES.includes(ds.disc)) system.discipline = ds.disc;
            const [item] = await app.actor.createEmbeddedDocuments("Item", [{
                type: TECHNIQUE_ITEM_TYPE,
                name: "New Technique",
                system,
            }]);
            item?.sheet?.render(true);
        });

        // Open the custom technique compendium browser
        chakraTab.find(".technique-browse").off("click").on("click", (ev) => {
            ev.preventDefault();
            const rank = ev.currentTarget.dataset.rank;
            new TechniqueCompendiumBrowser({ rank }).render(true);
        });

        // Open technique sheet
        chakraTab.find(".shinobi-technique-open").off("click").on("click", (ev) => {
            ev.preventDefault();
            const id = ev.currentTarget.closest(".technique-row")?.dataset.itemId;
            app.actor.items.get(id)?.sheet?.render(true);
        });

        // Use technique (fires first action)
        chakraTab.find(".shinobi-technique-use").off("click").on("click", async (ev) => {
            ev.preventDefault();
            if (ev.currentTarget.classList.contains("disabled")) return;
            const id = ev.currentTarget.closest(".technique-row")?.dataset.itemId;
            const item = app.actor.items.get(id);
            if (!item) return;
            const firstAction = Array.from(item.actions ?? [])[0];
            if (!firstAction) {
                ui.notifications.warn(`${item.name}: no actions configured.`);
                return;
            }
            await performTechnique(item, firstAction.id, ev);
        });

        // Learn technique
        chakraTab.find(".shinobi-technique-learn").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const id = ev.currentTarget.closest(".technique-row")?.dataset.itemId;
            const item = app.actor.items.get(id);
            if (item) await attemptLearnTechnique(item);
        });

        // Delete technique from actor
        chakraTab.find(".shinobi-technique-delete").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const id = ev.currentTarget.closest(".technique-row")?.dataset.itemId;
            const item = app.actor.items.get(id);
            if (!item) return;
            const ok = await Dialog.confirm({
                title:   "Remove Technique",
                content: `<p>Remove <strong>${item.name}</strong> from this actor?</p>`,
            });
            if (ok) await item.delete();
        });

        // Duplicate technique on the actor
        chakraTab.find(".shinobi-technique-duplicate").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const id = ev.currentTarget.closest(".technique-row")?.dataset.itemId;
            const item = app.actor.items.get(id);
            if (!item) return;
            const itemData = item.toObject();
            itemData.name = `${itemData.name} (Copy)`;
            const { actions, changed } = normalizeActionIds(itemData.system?.actions);
            if (changed) itemData.system.actions = actions;
            await app.actor.createEmbeddedDocuments("Item", [itemData]);
        });
    });
}
