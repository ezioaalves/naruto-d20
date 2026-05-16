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
    const LEARN_LABELS = {
        ckc: "Chakra Control", gnj: "Genjutsu", nin: "Ninjutsu",
        tai: "Taijutsu", fui: "Fuinjutsu",
    };

    Hooks.on("renderActorSheetPF", (app, html, _data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;
        const $html = html instanceof HTMLElement ? $(html) : html;

        $html.find(".shinobi-roll").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const { key, label } = ev.currentTarget.dataset;
            const learnData = app.actor.flags?.["naruto-d20"]?.learn?.[key];
            if (!learnData) return;

            const parts = [];
            parts.push(`${learnData.base}[Character Level]`);
            if (learnData.abilityMod) parts.push(`${learnData.abilityMod}[${learnData.abilityLabel}]`);
            const buffFlagPath = `flags.naruto-d20.learn.${key}.buffBonus`;
            const buffSources = app.actor.sourceInfo?.[buffFlagPath]?.positive ?? [];
            if (buffSources.length > 0) {
                for (const src of buffSources) parts.push(`${src.value}[${src.name}]`);
            } else if (learnData.buffBonus) {
                parts.push(`${learnData.buffBonus}[Buff Bonus]`);
            }
            if (learnData.synergyBonus) parts.push(`${learnData.synergyBonus}[Skill Synergy]`);
            if (learnData.miscBonus)    parts.push(`${learnData.miscBonus}[Misc Bonus]`);

            await pf1.dice.d20Roll({
                flavor:   `${label} Learn Check`,
                parts,
                rollData: app.actor.getRollData?.() ?? {},
                speaker:  ChatMessage.implementation.getSpeaker({ actor: app.actor }),
            });
        });

        $html.find("[data-naruto-tooltip^='learn.']")
            .on("pointerenter", async function () {
                const key = this.dataset.narutoTooltip.split(".")[1];
                const learnData = app.actor.flags?.["naruto-d20"]?.learn?.[key];
                if (!learnData) return;

                const sources = [
                    { name: "Character Level", value: learnData.base, builtIn: true },
                    { name: learnData.abilityLabel, value: learnData.abilityMod, builtIn: true },
                ];
                const buffFlagPath = `flags.naruto-d20.learn.${key}.buffBonus`;
                const buffSources = app.actor.sourceInfo?.[buffFlagPath]?.positive ?? [];
                if (buffSources.length > 0) {
                    for (const src of buffSources) sources.push({ name: src.name, value: src.value, builtIn: false });
                } else if (learnData.buffBonus) {
                    sources.push({ name: "Buff Bonus", value: learnData.buffBonus, builtIn: false });
                }
                if (learnData.synergyBonus) sources.push({ name: "Skill Synergy", value: learnData.synergyBonus, builtIn: true });
                if (learnData.miscBonus) sources.push({ name: "Misc Bonus", value: learnData.miscBonus, builtIn: false });

                const context = {
                    header: LEARN_LABELS[key] ?? key,
                    sources: [{ untyped: true, sources }],
                };

                const content = await foundry.applications.handlebars.renderTemplate(
                    "systems/pf1/templates/extended-tooltip.hbs",
                    context
                );
                game.tooltip.activate(this, { content, cssClass: "pf1 extended" });
            })
            .on("pointerleave", function () {
                game.tooltip.deactivate();
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
