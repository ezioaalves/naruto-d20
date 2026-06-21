import { MODULE_ID } from "../constants.mjs";
import { HERO_STAT_DEFAULTS, moduleFlagsPath } from "../flag-paths.mjs";

export function registerActorCreateHook() {
  Hooks.on("preCreateActor", (doc, data) => {
    if (!["character", "npc"].includes(data.type)) return;
    const existing = data.flags?.[MODULE_ID] ?? {};
    const patch = {};
    for (const { key } of HERO_STAT_DEFAULTS) {
      if (existing[key] === undefined) patch[key] = 0;
    }
    if (!foundry.utils.isEmpty(patch)) {
      doc.updateSource({ [moduleFlagsPath]: patch });
    }
  });
}
