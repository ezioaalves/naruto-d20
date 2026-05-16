const chakraActiveApps = new WeakSet();

export function registerChakraTab() {
    Hooks.on("renderActorSheetPF", async (app, html, data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;

        const $html = html instanceof HTMLElement ? $(html) : html;

        // Inject nav button — the character-sheet.hbs hard-codes nav items and doesn't
        // render from TABS config, so we must add the <a> element ourselves.
        const nav = $html.find("nav.sheet-navigation.tabs[data-group='primary']");
        if (nav.length && !nav.find('[data-tab="chakra"]').length) {
            nav.append('<a class="item" data-tab="chakra" data-group="primary">Chakra</a>');
        }

        // Track which tab is active across re-renders (DOM is fresh each render, so
        // app._tabs[0].active gets overwritten before our hook fires — WeakSet survives).
        nav.find('[data-tab="chakra"]').on("click", () => chakraActiveApps.add(app));
        nav.find('.item:not([data-tab="chakra"])').on("click", () => chakraActiveApps.delete(app));

        const body = $html.find("section.primary-body");
        if (!body.length) return;

        // Inject tab content div
        if (!body.find('[data-tab="chakra"]').length) {
            data.flags = app.actor.flags || {};
            const templateHtml = await foundry.applications.handlebars.renderTemplate(
                "modules/naruto-d20/templates/actor/chakra-tab.hbs",
                data
            );
            body.append($(templateHtml));
        }

        // Restore active state — must happen after tab div is in the DOM
        if (chakraActiveApps.has(app) || app._tabs?.[0]?.active === "chakra") {
            if (app._tabs?.[0]) app._tabs[0].active = "chakra";
            nav.find('.item').removeClass("active");
            nav.find('[data-tab="chakra"]').addClass("active");
            body.find(".tab").removeClass("active");
            body.find('[data-tab="chakra"]').addClass("active");
            chakraActiveApps.add(app);
        }

        // Roll listeners for Learn checks
        $html.find(".shinobi-roll").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const { bonus, label } = ev.currentTarget.dataset;
            const roll = new Roll(`1d20 + ${bonus}`);
            await roll.evaluate({ async: true });
            roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor: app.actor }),
                flavor: `<h3 style="margin-bottom: 0;">${label} Learn Check</h3>`
            });
        });

    });
}
