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

        // Inject Taijutsu ability selector into the PF1e Settings tab
        const settingsTab = $html.find('div.tab.settings[data-tab="settings"]');
        if (settingsTab.length && !settingsTab.find(".naruto-tai-setting").length) {
            const taiAbility = app.actor.flags?.["naruto-d20"]?.learn?.tai?.ability ?? "str";
            settingsTab.prepend(`
                <div class="naruto-tai-setting">
                    <h2>Naruto D20</h2>
                    <div class="form-group">
                        <label>Taijutsu Governing Ability</label>
                        <select class="naruto-tai-ability-select">
                            <option value="str" ${taiAbility === "str" ? "selected" : ""}>STR (Strength)</option>
                            <option value="dex" ${taiAbility === "dex" ? "selected" : ""}>DEX (Dexterity)</option>
                        </select>
                    </div>
                </div>
            `);
        }

        const body = $html.find("section.primary-body");
        if (!body.length) return;

        // Inject tab content div
        if (!body.find('[data-tab="chakra"]').length) {
            data.flags = app.actor.flags || {};
            const templateHtml = await foundry.applications.handlebars.renderTemplate(
                "modules/naruto-d20/templates/actor/chakra-tab.hbs",
                data
            );
            const $tab = $(templateHtml);

            // Match active state to whichever tab PF1e currently shows
            if (app._tabs?.[0]?.active === "chakra") {
                $tab.addClass("active");
                body.find(".tab:not(.chakra)").removeClass("active");
            }

            body.append($tab);
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

        // Save Taijutsu ability on change
        $html.find(".naruto-tai-ability-select").off("change").on("change", async (ev) => {
            await app.actor.setFlag("naruto-d20", "learn.tai.ability", ev.target.value);
        });
    });
}
