import { NarutoFeatBrowser } from "./feat-browser.mjs";

/**
 * Injects a second Browse button (fa-scroll) next to PF1's native Browse in
 * every section header of the Features tab. Clicking it opens the
 * NarutoFeatBrowser, pre-filtered to the section's subType when available.
 *
 * Uses renderActorSheetPF (post-render injection) — no _renderInner patch
 * needed because the Features tab markup already exists on first render.
 * The idempotency guard (`.naruto-feat-browse` check) prevents the button
 * from being appended on every re-render.
 */
export function registerFeatListListeners() {
  Hooks.on("renderActorSheetPF", (app, html) => {
    if (!["character", "npc"].includes(app.actor.type)) return;
    const $html = html instanceof HTMLElement ? $(html) : html;
    const featsBody = $html.find(".feats-body")[0];
    if (!featsBody) return;

    for (const controls of featsBody.querySelectorAll(".item-list-header .item-controls")) {
      if (controls.querySelector(".naruto-feat-browse")) continue; // idempotent

      // The <ol> ancestor carries data-subtype so we can pre-select the filter.
      const subType = controls.closest("ol[data-subtype]")?.dataset.subtype ?? "";

      controls.insertAdjacentHTML(
        "beforeend",
        `
                <a class="naruto-feat-browse item-control"
                   data-tooltip="Browse Naruto Feats"
                   data-subtype="${subType}">
                  <i class="fa-solid fa-scroll" inert></i>
                </a>
            `,
      );
    }

    featsBody.querySelectorAll(".naruto-feat-browse").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const subType = ev.currentTarget.dataset.subtype || undefined;
        new NarutoFeatBrowser({ subType }).render(true);
      });
    });
  });
}
