import {
  buildLearnCheckBreakdown,
  buildChakraPoolBreakdown,
  buildChakraReserveBreakdown,
} from "../data/bonus-sources.mjs";

const LEARN_LABELS = {
  ckc: "NarutoD20.Skills.ckc",
  gnj: "NarutoD20.Skills.gnj",
  nin: "NarutoD20.Skills.nin",
  tai: "NarutoD20.Skills.tai",
  fui: "NarutoD20.Skills.fui",
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

    $html
      .find(".shinobi-roll")
      .off("click")
      .on("click", async (ev) => {
        ev.preventDefault();
        const { key, label } = ev.currentTarget.dataset;
        const breakdown = buildLearnCheckBreakdown(app.actor, key);
        if (!breakdown) return;

        await pf1.dice.d20Roll({
          flavor: game.i18n.format("NarutoD20.ChakraTab.LearnCheckFlavor", { label }),
          parts: breakdown.parts,
          rollData: app.actor.getRollData?.() ?? {},
          speaker: ChatMessage.implementation.getSpeaker({ actor: app.actor }),
        });
      });

    $html
      .find("[data-naruto-tooltip^='learn.']")
      .on("pointerenter", async function () {
        const key = this.dataset.narutoTooltip.split(".")[1];
        const breakdown = buildLearnCheckBreakdown(app.actor, key);
        if (!breakdown) return;

        const content = await foundry.applications.handlebars.renderTemplate(
          "systems/pf1/templates/extended-tooltip.hbs",
          {
            header: game.i18n.localize(LEARN_LABELS[key] ?? key),
            sources: [{ untyped: true, sources: breakdown.sources }],
          },
        );
        game.tooltip.activate(this, { html: content, cssClass: "pf1 extended" });
      })
      .on("pointerleave", function () {
        game.tooltip.deactivate();
      });

    // ── Chakra Pool Max tooltip ───────────────────────────────────────
    $html
      .find("[data-naruto-tooltip='chakra.pool.max']")
      .on("pointerenter", async function () {
        const breakdown = buildChakraPoolBreakdown(app.actor);
        if (!breakdown) return;
        const content = await foundry.applications.handlebars.renderTemplate(
          "systems/pf1/templates/extended-tooltip.hbs",
          {
            header: game.i18n.localize("NarutoD20.BuffTargets.ChakraPool"),
            sources: [{ untyped: true, sources: breakdown.sources }],
          },
        );
        game.tooltip.activate(this, { html: content, cssClass: "pf1 extended" });
      })
      .on("pointerleave", function () {
        game.tooltip.deactivate();
      });

    // ── Chakra Reserve Max tooltip ────────────────────────────────────
    $html
      .find("[data-naruto-tooltip='chakra.reserve.max']")
      .on("pointerenter", async function () {
        const breakdown = buildChakraReserveBreakdown(app.actor);
        if (!breakdown) return;
        const content = await foundry.applications.handlebars.renderTemplate(
          "systems/pf1/templates/extended-tooltip.hbs",
          {
            header: game.i18n.localize("NarutoD20.BuffTargets.ChakraReserve"),
            sources: [{ untyped: true, sources: breakdown.sources }],
          },
        );
        game.tooltip.activate(this, { html: content, cssClass: "pf1 extended" });
      })
      .on("pointerleave", function () {
        game.tooltip.deactivate();
      });
  });
}
