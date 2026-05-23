import { MAIN_DISCIPLINES, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";
import { performTechnique } from "../use-technique.mjs";
import { resolveDroppedItem } from "../utils/drag-drop.mjs";
import { TechniqueCompendiumBrowser } from "./technique-browser.mjs";

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
                const srcItem = await resolveDroppedItem(ev.originalEvent, { type: TECHNIQUE_ITEM_TYPE });
                if (!srcItem) {
                    ui.notifications.warn("Only Technique items can be dropped here.");
                    return;
                }
                if (srcItem.parent === app.actor) return; // already owned
                await app.actor.createEmbeddedDocuments("Item", [srcItem.toObject()]);
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
            const id = ev.currentTarget.closest(".technique-row")?.dataset.itemId;
            const item = app.actor.items.get(id);
            if (!item) return;
            const firstAction = Array.from(item.actions ?? [])[0];
            if (!firstAction) {
                ui.notifications.warn(`${item.name}: no actions configured.`);
                return;
            }
            await performTechnique(item, firstAction.id);
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
    });
}
