export function registerChakraTab() {
    Hooks.on("renderActorSheetPF", async (app, html, data) => {
        // Only apply to characters and NPCs
        if (!["character", "npc"].includes(app.actor.type)) return;

        const $html = html instanceof HTMLElement ? $(html) : html;

        // 1. Tab Navigation and Persistence
        const nav = $html.find('nav.sheet-navigation.tabs[data-group="primary"]');
        if (nav.length > 0) {
            let activeTab = app.tabState?.primary?.active || app._tabs?.[0]?.active || app._activeTab;
            if (app._isNarutoTabForced) activeTab = "chakra";
            const isActive = activeTab === "chakra";
            
            let tabButton = nav.find('[data-tab="chakra"]');
            if (tabButton.length === 0) {
                const activeClass = isActive ? "active" : "";
                tabButton = $(`<a class="item ${activeClass}" data-tab="chakra" data-group="primary" data-action="tab">Chakra</a>`);
                nav.append(tabButton);
            } 
            
            if (isActive) {
                tabButton.addClass("active");
                nav.find('a.item:not([data-tab="chakra"])').removeClass("active");
            } else {
                tabButton.removeClass("active");
            }

            // Persistence listeners
            tabButton.off('click.naruto').on('click.naruto', () => {
                app._isNarutoTabForced = true;
                if (app._tabs?.[0]) app._tabs[0].activate("chakra");
                if (app.tabState?.primary) app.tabState.primary.active = "chakra";
                app._activeTab = "chakra";
                app.render(); // Force a re-render to apply classes correctly
            });

            nav.find('a.item:not([data-tab="chakra"])').off('click.naruto').on('click.naruto', () => {
                app._isNarutoTabForced = false;
            });
        }


        // 2. Render and Inject the Tab Content
        data.flags = data.actor.flags || {};
        
        let activeTab = app.tabState?.primary?.active || app._tabs?.[0]?.active || app._activeTab;
        if (app._isNarutoTabForced) activeTab = "chakra";
        const isActive = activeTab === "chakra";
        
        const templatePath = "modules/naruto-d20/templates/actor/chakra-tab.hbs";
        const templateHtml = await foundry.applications.handlebars.renderTemplate(templatePath, data);
        
        const body = $html.find('section.primary-body');
        if (body.length > 0 && body.find('[data-tab="chakra"]').length === 0) {
            const tabContent = $(templateHtml);
            
            let activeTab = app.tabState?.primary?.active || app._tabs?.[0]?.active || app._activeTab;
            if (app._isNarutoTabForced) activeTab = "chakra";
            
            if (activeTab === "chakra") {
                tabContent.addClass("active");
                // Remove active class from other tabs so they hide
                body.find('section.tab:not(.chakra), div.tab:not(.chakra)').removeClass("active");
            } else {
                tabContent.removeClass("active");
            }
            body.append(tabContent);
        }



        // 3. Roll listeners for Learn checks
        $html.find('.shinobi-roll').off('click').on('click', async (ev) => {
            ev.preventDefault();
            const dataset = ev.currentTarget.dataset;
            const bonus = dataset.roll;
            const label = dataset.label;
            
            const roll = new Roll(`1d20 + ${bonus}`);
            await roll.evaluate({ async: true });
            
            roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor: app.actor }),
                flavor: `<h3 style="margin-bottom: 0;">${label} Learn Check</h3>`
            });
        });
    });
}
