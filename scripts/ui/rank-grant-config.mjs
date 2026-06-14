import { MODULE_ID } from "../constants.mjs";
import { getRankGrantType } from "../automation/rank-buffs.mjs";
import {
  MAINTENANCE_BUFF_FLAG_PATH,
  getRankMaintenanceFlag,
} from "../automation/maintenance-buffs.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/item/rank-grant-config.hbs`;

/**
 * Inject a "Naruto Rank" section into PF1e buff item sheets so a GM can mark
 * a buff as a Speed/Strength rank grant (temporary ranks or a rank bonus).
 * Technique-created ("paid") rank buffs render read-only — their flag is
 * managed by the technique automation.
 */
export function registerRankGrantConfig() {
  Hooks.on("renderItemSheetPF", onRenderItemSheet);
}

async function onRenderItemSheet(app, html) {
  const item = app.item;
  if (item?.type !== "buff") return;
  if (html.find(".naruto-rank-grant").length) return;

  const anchor = html.find('.tab.details select[name="system.subType"]').closest(".form-group");
  if (!anchor.length) return;

  const flag = getRankMaintenanceFlag(item);
  const grantType = getRankGrantType(item);
  const rendered = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    flagPath: MAINTENANCE_BUFF_FLAG_PATH,
    key: flag?.key ?? "",
    grantType: grantType === "paid" ? "paid" : (flag?.grantType ?? "temp"),
    isPaid: grantType === "paid",
    editable: app.isEditable,
    typeOptions: {
      "": "NarutoD20.RankGrant.Type.None",
      KOUSOKU: "NarutoD20.RankGrant.Type.Speed",
      JOURYOKU: "NarutoD20.RankGrant.Type.Strength",
    },
    modeOptions: {
      temp: "NarutoD20.RankGrant.Mode.Temp",
      bonus: "NarutoD20.RankGrant.Mode.Bonus",
    },
  });

  anchor.after(rendered);
}
