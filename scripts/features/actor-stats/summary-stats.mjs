import { MODULE_ID } from "../../core/constants.mjs";
import { actionPointsPath } from "../../core/flag-paths.mjs";

/**
 * Render the Hero Statistics block (Action Points / Reputation / Wealth) into the
 * Summary tab. Called from the ActorSheetPF._renderInner patch (render-patch.mjs)
 * so the markup is present BEFORE the sheet paints. It used to be inserted by a
 * post-render hook, which (being async) landed after the frame painted and caused
 * a visible flicker — worse on downstream sheets that then relocate the block.
 * Idempotent: skips if the block is already present in the freshly built html.
 *
 * @param {Application} app   The actor sheet being rendered.
 * @param {jQuery}      $html The sheet's inner html (still detached, pre-paint).
 * @param {object}      [data] The render context (getData result); flags overridden.
 */
export async function injectHeroStatistics(app, $html, data = {}) {
  if (!["character", "npc"].includes(app.actor?.type)) return;

  const summary = $html.find(".tab.summary");
  if (!summary.length || summary.find("#naruto-hero-statistics").length) return;

  const tplData = { ...data, flags: app.actor.flags || {} };
  const templateHtml = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/actor/summary-stats.hbs`,
    tplData,
  );

  // Insert before the Quick Actions h3, which precedes ol.quick-actions.
  const quickActionsOl = summary.find("ol.quick-actions").first();
  if (quickActionsOl.length) {
    const h3 = quickActionsOl.prev("h3");
    $(templateHtml).insertBefore(h3.length ? h3 : quickActionsOl);
  } else {
    summary.prepend(templateHtml);
  }
}

/**
 * Bind the Action Points roll listener. The Hero Statistics markup itself is now
 * injected pre-paint by {@link injectHeroStatistics}; this post-render hook only
 * wires the rollable, which is safe to (re)bind after paint — attaching a click
 * handler to an existing element causes no flicker.
 */
export function registerSummaryStats() {
  Hooks.on("renderActorSheetPF", (app, html) => {
    if (!["character", "npc"].includes(app.actor?.type)) return;
    const $html = html instanceof HTMLElement ? $(html) : html;
    $html
      .find(".naruto-action-point-roll")
      .off("click")
      .on("click", async (event) => {
        event.preventDefault();
        await rollActionPoint(app.actor);
      });
  });
}

export function registerActorSettings() {
  Hooks.on("renderActorSheetPF", (app, html) => {
    if (!["character", "npc"].includes(app.actor.type)) return;
    const $html = html instanceof HTMLElement ? $(html) : html;
    const settingsTab = $html.find('.tab[data-tab="settings"]');
    if (!settingsTab.length || settingsTab.find(".naruto-d20-actor-settings").length) return;

    const hasChakra = app.actor.flags?.[MODULE_ID]?.hasChakra ?? true;
    const header = game.i18n.localize("NarutoD20.ActorSettings.Header");
    const label = game.i18n.localize("NarutoD20.ActorSettings.HasChakra.Label");
    const hint = game.i18n.localize("NarutoD20.ActorSettings.HasChakra.Hint");

    settingsTab.append(`
      <div class="naruto-d20-actor-settings">
        <h2>${header}</h2>
        <div class="form-group stacked">
          <label class="checkbox" title="${hint}">
            <input type="checkbox" class="naruto-has-chakra"${hasChakra ? " checked" : ""}>
            ${label}
          </label>
        </div>
      </div>`);

    $html.find(".naruto-has-chakra").on("change", async (event) => {
      await app.actor.setFlag(MODULE_ID, "hasChakra", event.target.checked);
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
