import {
    buildLearnCheckBreakdown,
    buildChakraPoolBreakdown,
    buildChakraReserveBreakdown,
} from "../data/bonus-sources.mjs";

const LEARN_LABELS = {
    ckc: "Chakra Control",
    gnj: "Genjutsu",
    nin: "Ninjutsu",
    tai: "Taijutsu",
    fui: "Fuinjutsu",
};

/**
 * Wire roll and tooltip listeners for the .shinobi-roll buttons and
 * [data-naruto-tooltip="learn.X"] hover targets. Both share the same
 * breakdown logic (buildLearnCheckBreakdown), so a buff added to e.g.
 * `learnNin` shows the same per-source rows in both the chat card and
 * the hover popover.
 */
export function registerLearnCheckListeners() {
    Hooks.on("renderActorSheetPF", (app, html, _data) => {
        if (!["character", "npc"].includes(app.actor.type)) return;
        const $html = html instanceof HTMLElement ? $(html) : html;

        $html.find(".shinobi-roll").off("click").on("click", async (ev) => {
            ev.preventDefault();
            const { key, label } = ev.currentTarget.dataset;
            const breakdown = buildLearnCheckBreakdown(app.actor, key);
            if (!breakdown) return;

            await pf1.dice.d20Roll({
                flavor:   `${label} Learn Check`,
                parts:    breakdown.parts,
                rollData: app.actor.getRollData?.() ?? {},
                speaker:  ChatMessage.implementation.getSpeaker({ actor: app.actor }),
            });
        });

        $html.find("[data-naruto-tooltip^='learn.']")
            .on("pointerenter", async function () {
                const key = this.dataset.narutoTooltip.split(".")[1];
                const breakdown = buildLearnCheckBreakdown(app.actor, key);
                if (!breakdown) return;

                const content = await foundry.applications.handlebars.renderTemplate(
                    "systems/pf1/templates/extended-tooltip.hbs",
                    {
                        header:  LEARN_LABELS[key] ?? key,
                        sources: [{ untyped: true, sources: breakdown.sources }],
                    }
                );
                game.tooltip.activate(this, { html: content, cssClass: "pf1 extended" });
            })
            .on("pointerleave", function () {
                game.tooltip.deactivate();
            });

        // ── Chakra Pool Max tooltip ───────────────────────────────────────
        $html.find("[data-naruto-tooltip='chakra.pool.max']")
            .on("pointerenter", async function () {
                const breakdown = buildChakraPoolBreakdown(app.actor);
                if (!breakdown) return;
                const content = await foundry.applications.handlebars.renderTemplate(
                    "systems/pf1/templates/extended-tooltip.hbs",
                    {
                        header:  "Chakra Pool Max",
                        sources: [{ untyped: true, sources: breakdown.sources }],
                    }
                );
                game.tooltip.activate(this, { html: content, cssClass: "pf1 extended" });
            })
            .on("pointerleave", function () {
                game.tooltip.deactivate();
            });

        // ── Chakra Reserve Max tooltip ────────────────────────────────────
        $html.find("[data-naruto-tooltip='chakra.reserve.max']")
            .on("pointerenter", async function () {
                const breakdown = buildChakraReserveBreakdown(app.actor);
                if (!breakdown) return;
                const content = await foundry.applications.handlebars.renderTemplate(
                    "systems/pf1/templates/extended-tooltip.hbs",
                    {
                        header:  "Chakra Reserve Max",
                        sources: [{ untyped: true, sources: breakdown.sources }],
                    }
                );
                game.tooltip.activate(this, { html: content, cssClass: "pf1 extended" });
            })
            .on("pointerleave", function () {
                game.tooltip.deactivate();
            });
    });
}
