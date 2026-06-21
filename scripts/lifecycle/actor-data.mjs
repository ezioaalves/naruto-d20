import { BUFF_TARGETS } from "../flag-paths.mjs";
import { prepareBaseActorData, prepareDerivedActorData } from "../data/derived-data.mjs";
import { ensureActorSkillEntries } from "../data/skills.mjs";

export function registerActorDataHooks() {
  Hooks.on("pf1PrepareBaseActorData", (actor) => {
    prepareBaseActorData(actor);
    ensureActorSkillEntries(actor);
  });

  Hooks.on("pf1GetChangeFlat", (result, target) => {
    const entry = BUFF_TARGETS[target];
    if (entry) result.push(entry.path);
  });

  Hooks.on("pf1PrepareDerivedActorData", (actor) => {
    prepareDerivedActorData(actor);
  });
}
