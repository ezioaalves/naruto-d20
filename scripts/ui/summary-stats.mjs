export function registerSummaryStats() {
    Hooks.on("renderActorSheetPF", async (app, html, data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;

        const $html = html instanceof HTMLElement ? $(html) : html;
        const summary = $html.find(".tab.summary");
        if (!summary.length || summary.find("#naruto-hero-statistics").length) return;

        data.flags = app.actor.flags || {};
        const templateHtml = await foundry.applications.handlebars.renderTemplate(
            "modules/naruto-d20/templates/actor/summary-stats.hbs",
            data
        );

        // Try stable PF1e class selectors before falling back to prepend
        const anchor = summary.find(".quick-actions, .quick-actions-header, [data-tab-section='quick-actions']").first();
        if (anchor.length) {
            const hr = anchor.prev("hr");
            $(templateHtml).insertBefore(hr.length ? hr : anchor);
        } else {
            summary.prepend(templateHtml);
        }
    });
}
