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

let installed = false;

export function registerChakraTab() {
    _installRenderInnerPatch();

    // The hook only handles things that depend on the live, in-DOM sheet —
    // roll listeners. DOM injection now happens in _renderInner.
    Hooks.on("renderActorSheetPF", (app, html, _data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;
        const $html = html instanceof HTMLElement ? $(html) : html;
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

function _installRenderInnerPatch() {
    if (installed) return;
    const ActorSheetPF = pf1?.applications?.actor?.ActorSheetPF;
    if (!ActorSheetPF?.prototype?._renderInner) {
        console.error("Naruto D20 | pf1.applications.ActorSheetPF._renderInner not found — chakra tab cannot patch");
        return;
    }
    installed = true;

    const original = ActorSheetPF.prototype._renderInner;
    ActorSheetPF.prototype._renderInner = async function (...args) {
        const $html = await original.apply(this, args);
        if (!["character", "npc"].includes(this.actor.type)) return $html;

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
            const tplData = { ...data, flags: this.actor.flags || {} };
            const tplHtml = await foundry.applications.handlebars.renderTemplate(
                "modules/naruto-d20/templates/actor/chakra-tab.hbs",
                tplData
            );
            body.append(tplHtml);
        }

        return $html;
    };
}
