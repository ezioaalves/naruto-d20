/**
 * Naruto D20 — Main Entry Point
 *
 * Hook lifecycle ordering:
 *  [1] Foundry "init"              → Register DataModel, item sheet, world settings
 *  [2] "pf1PostInit"               → Register buffTargets (CONFIG.PF1 is now set); register chakra conditions
 *  [3] "pf1PrepareBaseActorData"   → Init flag schema + reset computed fields
 *  [4] "pf1GetChangeFlat"          → Map buff targets to flag paths (changes engine)
 *  [5] "pf1PrepareDerivedActorData"→ Compute all Shinobi statistics
 *  [6] "pf1RegisterDamageTypes"    → Register elemental damage types
 *  [7] Foundry "setup"             → Push Chakra tab, register UI hooks
 *  [8] "preCreateActor"            → Seed default flags on new actors
 *  [9] Foundry "ready"             → GM-only one-time migrations
 * [10] "pf1ActorRest"              → Restore chakra pool, clear temp, recover reserve
 */

import { registerInitHook } from "./lifecycle/init.mjs";
import { registerPf1PostInitHook } from "./lifecycle/pf1-post-init.mjs";
import { registerActorDataHooks } from "./lifecycle/actor-data.mjs";
import { registerSetupHook } from "./lifecycle/setup.mjs";
import { registerActorCreateHook } from "./lifecycle/actor-create.mjs";
import { registerReadyHook } from "./lifecycle/ready.mjs";
import { registerRestHook } from "./lifecycle/rest.mjs";
import { registerDamageTypes } from "./data/damage-types.mjs";

registerInitHook();
registerPf1PostInitHook();
registerActorDataHooks();
Hooks.once("pf1RegisterDamageTypes", registerDamageTypes);
registerSetupHook();
registerActorCreateHook();
registerReadyHook();
registerRestHook();
