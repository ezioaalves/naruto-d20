import { MODULE_ID } from "../constants.mjs";
import { actionPointsPath } from "../flag-paths.mjs";

export function registerSummaryStats() {
  Hooks.on("renderActorSheetPF", async (app, html, data) => {
    if (!["character", "npc"].includes(app.actor.type)) return;

    const $html = html instanceof HTMLElement ? $(html) : html;
    const summary = $html.find(".tab.summary");
    if (!summary.length || summary.find("#naruto-hero-statistics").length) return;

    data.flags = app.actor.flags || {};
    const templateHtml = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/actor/summary-stats.hbs`,
      data,
    );

    // Insert before the Quick Actions h3, which precedes ol.quick-actions
    const quickActionsOl = summary.find("ol.quick-actions").first();
    if (quickActionsOl.length) {
      const h3 = quickActionsOl.prev("h3");
      $(templateHtml).insertBefore(h3.length ? h3 : quickActionsOl);
    } else {
      summary.prepend(templateHtml);
    }

    $html
      .find(".naruto-action-point-roll")
      .off("click")
      .on("click", async (event) => {
        event.preventDefault();
        await rollActionPoint(app.actor);
      });
  });
}

async function rollActionPoint(actor) {
  const current = Number(foundry.utils.getProperty(actor, actionPointsPath) ?? 0);
  if (!Number.isFinite(current) || current <= 0) {
    ui.notifications.warn(
      game.i18n.format("NarutoD20.Notifications.NoActionPoints", { actor: actor.name }),
    );
    return;
  }

  const remaining = current - 1;
  await actor.update({ [actionPointsPath]: remaining });

  const roll = new Roll("1d6");
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format("NarutoD20.Cards.ActionPointFlavor", {
      from: current,
      to: remaining,
    }),
    rollMode: game.settings.get("core", "rollMode"),
  });
}
