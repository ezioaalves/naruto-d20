import { MODULE_ID } from "../constants.mjs";

export function registerSummaryStats() {
    Hooks.on("renderActorSheetPF", async (app, html, data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;

        const $html = html instanceof HTMLElement ? $(html) : html;
        const summary = $html.find(".tab.summary");
        if (!summary.length || summary.find("#naruto-hero-statistics").length) return;

        data.flags = app.actor.flags || {};
        const templateHtml = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE_ID}/templates/actor/summary-stats.hbs`,
            data
        );

        // Insert before the Quick Actions h3, which precedes ol.quick-actions
        const quickActionsOl = summary.find("ol.quick-actions").first();
        if (quickActionsOl.length) {
            const h3 = quickActionsOl.prev("h3");
            $(templateHtml).insertBefore(h3.length ? h3 : quickActionsOl);
        } else {
            summary.prepend(templateHtml);
        }
    });
}
