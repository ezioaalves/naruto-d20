import { onActorRest } from "../data/rest-recovery.mjs";

export function registerRestHook() {
  Hooks.on("pf1ActorRest", (actor, options) => {
    onActorRest(actor, options);
  });
}
