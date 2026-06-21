import { BUFF_TARGETS } from "../core/flag-paths.mjs";
import { prepareBaseActorData, prepareDerivedActorData } from "../features/actor-stats/derived-data.mjs";
import { ensureActorSkillEntries } from "../features/actor-stats/skills.mjs";

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
