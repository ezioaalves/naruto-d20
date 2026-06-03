import { MODULE_ID } from "../constants.mjs";
import { analyzeActor, syncSelected, STATUS } from "../automation/technique-sync.mjs";

/** Per-status display metadata. `sync: true` means the row gets a (checked) checkbox. */
const STATUS_META = {
  [STATUS.OUT_OF_DATE]: {
    label: "NarutoD20.Synckit.Status.OutOfDate",
    css: "out-of-date",
    icon: "fa-triangle-exclamation",
    sync: true,
  },
  [STATUS.UP_TO_DATE]: {
    label: "NarutoD20.Synckit.Status.UpToDate",
    css: "up-to-date",
    icon: "fa-circle-check",
    sync: false,
  },
  [STATUS.ORPHAN]: {
    label: "NarutoD20.Synckit.Status.Orphan",
    css: "orphan",
    icon: "fa-link-slash",
    sync: false,
  },
};

const STATUS_ORDER = { [STATUS.OUT_OF_DATE]: 0, [STATUS.ORPHAN]: 1, [STATUS.UP_TO_DATE]: 2 };

/**
 * Technique Synckit — per-actor window that lists each embedded technique with a
 * status badge (out of date / up to date / not in compendium) and re-syncs the
 * selected out-of-date ones from the `naruto-d20.techniques` compendium.
 *
 * Application (V1) to match pf1 v11.11's own app chrome (see CLAUDE.md).
 */
export class TechniqueSynckitApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "naruto-technique-synckit",
      template: `modules/${MODULE_ID}/templates/actor/technique-synckit.hbs`,
      classes: ["pf1", "app", "naruto-technique-synckit"],
      width: 560,
      height: "auto",
      resizable: true,
    });
  }

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  /** Unique per actor so two sheets don't share/steal one window. */
  get id() {
    return `naruto-technique-synckit-${this.actor?.id}`;
  }

  get title() {
    const base = game.i18n.localize("NarutoD20.Synckit.Title");
    return this.actor?.name ? `${base} — ${this.actor.name}` : base;
  }

  async getData() {
    const rows = await analyzeActor(this.actor);

    const decorated = rows
      .map((r) => {
        const meta = STATUS_META[r.status] ?? STATUS_META[STATUS.ORPHAN];
        return {
          ...r,
          statusLabel: game.i18n.localize(meta.label),
          statusCss: meta.css,
          statusIcon: meta.icon,
          syncable: meta.sync,
        };
      })
      .sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
      );

    const counts = {
      outOfDate: rows.filter((r) => r.status === STATUS.OUT_OF_DATE).length,
      upToDate: rows.filter((r) => r.status === STATUS.UP_TO_DATE).length,
      orphan: rows.filter((r) => r.status === STATUS.ORPHAN).length,
    };

    return {
      rows: decorated,
      counts,
      hasRows: rows.length > 0,
      hasOutOfDate: counts.outOfDate > 0,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];

    root.querySelector('[data-action="select-outdated"]')?.addEventListener("click", () => {
      root.querySelectorAll("input.synckit-pick").forEach((cb) => {
        cb.checked = true;
      });
    });

    root.querySelector('[data-action="sync"]')?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const ids = [...root.querySelectorAll("input.synckit-pick:checked")].map(
        (cb) => cb.dataset.itemId,
      );
      if (!ids.length) {
        ui.notifications.warn(game.i18n.localize("NarutoD20.Synckit.NothingSelected"));
        return;
      }
      ev.currentTarget.disabled = true;
      const count = await syncSelected(this.actor, ids);
      ui.notifications.info(game.i18n.format("NarutoD20.Synckit.Synced", { count }));
      this.render(true);
      this.actor?.sheet?.render(false);
    });
  }
}
