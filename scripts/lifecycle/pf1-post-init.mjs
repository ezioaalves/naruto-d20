import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../core/constants.mjs";
import { BUFF_TARGETS } from "../core/flag-paths.mjs";
import { registerNarutoSkills } from "../features/actor-stats/skills.mjs";
import { installTechniqueSaveDCPatch } from "../features/techniques/save-dc.mjs";
import { installTechniqueRollDataPatch } from "../features/techniques/rolldata.mjs";
import { registerStrengthRankCombat } from "../features/automation/combat/strength-rank-combat.mjs";
import { registerSpeedRankAttack } from "../features/automation/combat/speed-rank-attack.mjs";
import { registerAttackNoManeuver } from "../features/automation/combat/attack-no-maneuver.mjs";
import { registerChakraConditions } from "../features/chakra/conditions.mjs";

function _registerScriptCallCategories() {
  if (!pf1.registry?.scriptCalls) return;
  for (const catId of ["use", "postUse"]) {
    const cat = pf1.registry.scriptCalls.get(catId);
    if (cat && !cat.itemTypes.includes(TECHNIQUE_ITEM_TYPE)) {
      cat.itemTypes.push(TECHNIQUE_ITEM_TYPE);
    }
  }
}

function _registerBuffTargets() {
  if (!CONFIG.PF1) return;

  CONFIG.PF1.buffTargetCategories.chakra = { label: "Chakra" };
  CONFIG.PF1.buffTargetCategories.technique = {
    label: game.i18n.localize("NarutoD20.BuffTargets.Category"),
  };
  for (const [key, { label, sort, category = "chakra" }] of Object.entries(BUFF_TARGETS)) {
    CONFIG.PF1.buffTargets[key] = { label: game.i18n.localize(label), category, sort };
  }
}

export function registerPf1PostInitHook() {
  Hooks.once("pf1PostInit", () => {
    _registerBuffTargets();
    CONFIG.PF1.weaponGroups.ninWeapons = { label: "Nin Weapons" };
    CONFIG.PF1.weaponProficiencies.ninWeapons = "NarutoD20.WeaponProficiency.ninWeapons";
    CONFIG.PF1.weaponTypes.ninWeapons = {
      _label: "NarutoD20.WeaponType.ninWeapons",
      light: "PF1.WeaponSubtypeLight",
      "1h": "PF1.WeaponSubtypeOneHanded",
      "2h": "PF1.WeaponSubtypeTwoHanded",
      ranged: "PF1.WeaponSubtypeRanged",
    };
    CONFIG.PF1.weaponProficiencies.archaicWeapons = "NarutoD20.WeaponProficiency.archaicWeapons";
    CONFIG.PF1.weaponTypes.archaicWeapons = {
      _label: "NarutoD20.WeaponType.archaicWeapons",
      light: "PF1.WeaponSubtypeLight",
      "1h": "PF1.WeaponSubtypeOneHanded",
      "2h": "PF1.WeaponSubtypeTwoHanded",
      ranged: "PF1.WeaponSubtypeRanged",
    };
    CONFIG.PF1.weaponProficiencies.exoticWeapons = "NarutoD20.WeaponProficiency.exoticWeapons";
    CONFIG.PF1.weaponTypes.exoticWeapons = {
      _label: "NarutoD20.WeaponType.exoticWeapons",
      light: "PF1.WeaponSubtypeLight",
      "1h": "PF1.WeaponSubtypeOneHanded",
      "2h": "PF1.WeaponSubtypeTwoHanded",
      ranged: "PF1.WeaponSubtypeRanged",
    };
    registerNarutoSkills();
    _registerScriptCallCategories();
    installTechniqueSaveDCPatch();
    installTechniqueRollDataPatch();
    registerStrengthRankCombat();
    registerSpeedRankAttack();
    registerAttackNoManeuver();
    registerChakraConditions();
  });
}
