import { MODULE_ID } from "../../core/constants.mjs";
import { chakraPoolTempPath, chakraReserveValuePath } from "../../core/flag-paths.mjs";
import { buildTapReservesRollBreakdown } from "./bonus-sources.mjs";
import { checkAndUpdateConditions } from "./conditions.mjs";
import { buildNarutoRerollMessageData } from "../chat/rerolls.mjs";

const SEAL_BONUS = { none: 0, half: 2, hand: 5 };
const SEAL_LABEL = { none: "no seal", half: "half-seal", hand: "hand seal" };

/**
 * Custom roll dialog for Tap Reserves.
 *
 * The rule (from the homebrew):
 *   You transfer chakra from your Chakra Reserves into temporary chakra.
 *   DC = 10 + 1 per point of chakra tapped.
 *   Half-seal: DC −2.  Hand seal: DC −5.
 *   On success: reserves drop by the tapped amount; temp chakra rises by the same.
 *   Temp chakra dissipates after 1 minute per level.
 *
 * The roll uses the actor's Chakra Control (ckc) learn check modifier.
 * The chat card is produced by pf1.dice.d20Roll (skipDialog:true) so it matches
 * the system's standard d20 roll format with the per-source breakdown.
 */
export class TapReservesDialog extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tap-reserves-dialog",
      classes: ["pf1", "dialog"],
      template: `modules/${MODULE_ID}/templates/actor/tap-reserves-dialog.hbs`,
      title: game.i18n.localize("NarutoD20.App.TapReserves"),
      width: 380,
      height: "auto",
    });
  }

  /** @override */
  getData() {
    const nData = this.actor.flags?.[MODULE_ID]?.chakra ?? {};
    const reserveAvailable = nData.reserve?.value ?? 0;

    return {
      reserveAvailable,
      // Pass the raw object — the template uses {{selectOptions ... localize=true}}
      // which handles localization the same way PF1's own roll-dialog.hbs does.
      rollModes: CONFIG.Dice.rollModes,
      currentRollMode: game.settings.get("core", "rollMode"),
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Live DC update when amount or seal type changes
    html.find(".tap-amount, [name='seal-type']").on("input change", () => this._updateDC(html));

    // Initialise DC display to match default values
    this._updateDC(html);

    html.find(".roll-btn").on("click", () => this._onRoll(html));
    html.find(".cancel-btn").on("click", () => this.close());

    // Allow Enter key to confirm
    html.find(".tap-amount").on("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this._onRoll(html);
      }
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────

  _readValues(html) {
    const amount = parseInt(html.find(".tap-amount").val()) || 0;
    const seal = html.find("[name='seal-type']:checked").val() || "none";
    const sitBonus = html.find(".situational-bonus").val()?.trim() ?? "";
    const rollMode = html.find(".roll-mode").val() || game.settings.get("core", "rollMode");
    return { amount, seal, sitBonus, rollMode };
  }

  _computeDC(amount, seal) {
    return 10 + amount - (SEAL_BONUS[seal] ?? 0);
  }

  _updateDC(html) {
    const { amount, seal } = this._readValues(html);
    const dc = this._computeDC(Math.max(0, amount), seal);
    html.find(".tap-dc-value").text(dc);
  }

  async _onRoll(html) {
    const { amount, seal, sitBonus, rollMode } = this._readValues(html);

    // ── Validation ─────────────────────────────────────────────────
    const reserveAvailable = this.actor.flags?.[MODULE_ID]?.chakra?.reserve?.value ?? 0;
    if (amount < 1) {
      ui.notifications.warn(game.i18n.localize("NarutoD20.Notifications.TapMinimum"));
      return;
    }
    if (amount > reserveAvailable) {
      ui.notifications.warn(
        game.i18n.format("NarutoD20.Notifications.TapNotEnoughReserve", {
          have: reserveAvailable,
          requested: amount,
        }),
      );
      return;
    }

    const dc = this._computeDC(amount, seal);

    // ── Build roll parts from Tap Reserves breakdown ───────────────
    // pf1.dice.d20Roll will prepend the d20 die automatically.
    const breakdown = buildTapReservesRollBreakdown(this.actor);
    const parts = breakdown ? [...breakdown.parts] : [];

    // Add situational bonus to parts if provided.
    // Prefer explicit label; if it already contains "[" leave as-is.
    if (sitBonus) {
      parts.push(sitBonus.includes("[") ? sitBonus : `${sitBonus}[Situational]`);
    }

    // ── Flavor (card title) ────────────────────────────────────────
    const sealText = seal !== "none" ? `, ${SEAL_LABEL[seal]}` : "";
    const flavor = game.i18n.format("NarutoD20.Cards.TapReservesFlavor", {
      amount,
      seal: sealText,
    });

    // ── Roll via pf1's d20Roll (skipDialog so our dialog is the only one)
    // pf1.dice.d20Roll returns a ChatMessage when chatMessage:true (default).
    // Passing dc causes the card to display a success/failure indicator
    // using PF1's native isSuccess/isFailure styling.
    const chatMsg = await pf1.dice.d20Roll({
      skipDialog: true,
      flavor,
      parts,
      rollData: this.actor.getRollData?.() ?? {},
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.actor }),
      rollMode,
      dc,
      messageData: buildNarutoRerollMessageData(this.actor, "tap-reserves"),
    });

    if (!chatMsg) return; // cancelled or hook blocked

    // ── Determine success from the roll total ──────────────────────
    // chatMsg.rolls[0] is the evaluated D20RollPF instance.
    const rollTotal = chatMsg?.rolls?.[0]?.total ?? 0;
    const success = rollTotal >= dc;

    // ── Automate on success ────────────────────────────────────────
    if (success) {
      const nData = this.actor.flags?.[MODULE_ID]?.chakra ?? {};
      const newReserve = Math.max(0, (nData.reserve?.value ?? 0) - amount);
      const newTemp = (nData.pool?.temp ?? 0) + amount;

      await this.actor.update({
        [chakraReserveValuePath]: newReserve,
        [chakraPoolTempPath]: newTemp,
      });

      // Re-evaluate chakra conditions — draining the reserve may trigger
      // Low Reserves or Chakra Depletion (if reserve reaches 0).
      await checkAndUpdateConditions(this.actor);
    }

    this.close();
  }
}

/**
 * Wire the .tap-reserve-roll click listener via renderActorSheetPF.
 * Called once during the "setup" hook in main.mjs.
 */
export function registerTapReservesListener() {
  Hooks.on("renderActorSheetPF", (app, html) => {
    if (!["character", "npc"].includes(app.actor.type)) return;
    const $html = html instanceof HTMLElement ? $(html) : html;

    $html
      .find(".tap-reserve-roll")
      .off("click")
      .on("click", (ev) => {
        ev.preventDefault();
        new TapReservesDialog(app.actor).render(true);
      });
  });
}
