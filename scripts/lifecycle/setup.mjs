import { MODULE_ID } from "../core/constants.mjs";
import { buildPublicApi } from "../core/public-api.mjs";
import {
  installChakraTabPatch,
  installSynckitHeaderButton,
  installTechniqueGetChatDataPatch,
  installTechniqueGetDescriptionPatch,
} from "../ui/render-patch.mjs";
import { registerLearnCheckListeners } from "../ui/learn-checks.mjs";
import { registerLearnCardContextMenu } from "../features/techniques/learn.mjs";
import { registerMasterCardContextMenu } from "../features/techniques/master.mjs";
import { registerNarutoRollContextMenu } from "../features/chat/rerolls.mjs";
import { registerTechniqueListListeners } from "../features/techniques/list.mjs";
import {
  registerSummaryStats,
  registerActorSettings,
} from "../features/actor-stats/summary-stats.mjs";
import { registerFeatListListeners } from "../ui/feat-list.mjs";
import { registerFeatGrantDeletion } from "../automation/feat-grants.mjs";
import {
  registerOccupationAutoApply,
  registerOccupationAutoRevert,
} from "../features/automation/occupations/grants.mjs";
import { registerChargeDefensePenalty } from "../features/automation/combat/charge-defense.mjs";
import { registerTechniqueDamageTransforms } from "../features/automation/combat/damage-transform.mjs";
import { registerTurnMaintenance } from "../features/automation/maintenance/turn-maintenance.mjs";
import { registerElementDamage } from "../features/automation/maintenance/element-damage.mjs";
import { registerRankRollData } from "../features/automation/ranks/rolldata.mjs";
import { registerRankGrantConfig } from "../ui/rank-grant-config.mjs";
import { registerTapReservesListener } from "../features/chakra/tap-reserves.mjs";
import { registerChakraConditionCombatHooks } from "../features/chakra/conditions.mjs";

export function registerSetupHook() {
  Hooks.once("setup", () => {
    registerChakraConditionCombatHooks(); // combat end -> apply delayed Low Reserve fatigue
    installChakraTabPatch(); // _renderInner wrap — must run before first render
    installSynckitHeaderButton(); // _getHeaderButtons wrap — "Sync Techniques" title-bar button
    installTechniqueGetChatDataPatch(); // inject "Chakra Resistance" into item summary properties
    installTechniqueGetDescriptionPatch(); // prepend technique stat-block header into chat card / item summary
    registerLearnCheckListeners(); // .shinobi-roll + learn-check tooltips + chakra max tooltips
    registerLearnCardContextMenu(); // learn chat card → right-click "Add Action Point"
    registerMasterCardContextMenu(); // mastery chat card → right-click "Add Action Point"
    registerNarutoRollContextMenu(); // Naruto d20 cards → AP / reroll context menu
    registerTechniqueListListeners(); // chakra tab: filter, drop zone, CRUD
    registerSummaryStats(); // Hero Statistics block on the Summary tab
    registerActorSettings(); // Has Chakra toggle in the Settings tab
    registerFeatListListeners(); // Naruto Browse button on the Features tab
    registerFeatGrantDeletion(); // cascade-delete feat supplements on feat removal
    registerOccupationAutoApply(); // occupation drop → prompt + apply grants
    registerOccupationAutoRevert(); // occupation delete → reverse wealth/reputation
    registerChargeDefensePenalty(); // PF1e charge attack AC penalty until next turn
    registerTechniqueDamageTransforms(); // generic technique damage multiplication/type conversion
    registerTurnMaintenance(); // start-of-turn maintenance + spent-buff cleanup
    registerElementDamage(); // type configured maintenance-element attack damage at roll time
    registerRankRollData(); // KOUSOKU/JOURYOKU effective rank (paid/temp/bonus + armor/condition penalties)
    registerRankGrantConfig(); // "Naruto Rank" grant section on PF1e buff sheets
    registerTapReservesListener(); // Chakra Reserve header → Tap Reserves dialog
  });

  // Publish stable public API for downstream modules after all internal hooks are wired.
  Hooks.once("setup", () => {
    game.modules.get(MODULE_ID).api = buildPublicApi();
  });
}
