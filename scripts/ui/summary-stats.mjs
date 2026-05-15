export function registerSummaryStats() {
    Hooks.on("renderActorSheetPF", async (app, html, data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;

        const $html = html instanceof HTMLElement ? $(html) : html;
        
        // Target the Summary tab
        const summary = $html.find('.tab.summary');
        if (summary.length > 0 && summary.find('#naruto-hero-statistics').length === 0) {
            // Find the Quick Actions header by text to be certain of its location
            const qaHeader = summary.find('h3').filter((i, el) => {
                return $(el).text().toLowerCase().includes("quick actions");
            }).first();

            if (qaHeader.length > 0) {
                // Target the container if it exists, otherwise the header
                const container = qaHeader.closest('.quick-actions');
                const target = container.length ? container : qaHeader;
                
                // Look for a preceding separator to insert before it
                const hr = target.prev('hr');
                const finalTarget = hr.length ? hr : target;
                
                // Ensure data flags are available
                data.flags = app.actor.flags || {};
                const templatePath = "modules/naruto-d20/templates/actor/summary-stats.hbs";
                const templateHtml = await foundry.applications.handlebars.renderTemplate(templatePath, data);
                
                // Insert BEFORE the final target
                $(templateHtml).insertBefore(finalTarget);
            }
        }
    });
}
