import { parseWeaponAttackConfig, readWeaponAttackRaw } from "./weapon-attack.mjs";

export const WEAPON_ATTACK_FIELD_KEYS = [
  "mode",
  "filter",
  "damageMode",
  "attackBonus",
  "damageBonus",
  "nonCritDamageBonus",
  "extraAttacks",
  "held",
  "charge",
  "iteratives",
  "suppressedBonuses",
];

export const WEAPON_ATTACK_FILTER_CHOICES = {
  meleeWeapon: "NarutoD20.WeaponAttack.Filter.MeleeWeapon",
  rangedWeapon: "NarutoD20.WeaponAttack.Filter.RangedWeapon",
  unarmedOnly: "NarutoD20.WeaponAttack.Filter.UnarmedOnly",
  meleeOrUnarmed: "NarutoD20.WeaponAttack.Filter.MeleeOrUnarmed",
};

export const WEAPON_ATTACK_DAMAGE_MODE_CHOICES = {
  add: "NarutoD20.WeaponAttack.DamageMode.Add",
  replace: "NarutoD20.WeaponAttack.DamageMode.Replace",
};

export const WEAPON_ATTACK_HELD_CHOICES = {
  "": "NarutoD20.WeaponAttack.Held.Unchanged",
  onehanded: "NarutoD20.WeaponAttack.Held.OneHanded",
  twohanded: "NarutoD20.WeaponAttack.Held.TwoHanded",
};

export const WEAPON_ATTACK_PRESET_CHOICES = {
  custom: "NarutoD20.WeaponAttack.Preset.Custom",
  raite: "NarutoD20.WeaponAttack.Preset.Raite",
  jikiUchi: "NarutoD20.WeaponAttack.Preset.JikiUchi",
  ryuutsuki: "NarutoD20.WeaponAttack.Preset.Ryuutsuki",
  fixedCombo: "NarutoD20.WeaponAttack.Preset.FixedCombo",
};

const DEFAULT_FORM_DATA = Object.freeze({
  enabled: false,
  preset: "custom",
  filter: "meleeWeapon",
  damageMode: "add",
  attackBonus: "",
  damageBonus: "",
  nonCritDamageBonus: "",
  extraAttacksText: "",
  held: "",
  charge: false,
  iteratives: true,
  suppressNaturalAttack: false,
  suppressAbilityDamage: false,
  warnings: [],
});

export function buildWeaponAttackFormData(item) {
  const raw = readWeaponAttackRaw(item);
  if (!raw.present) return { ...DEFAULT_FORM_DATA };

  const { config, warnings } = parseWeaponAttackConfig(raw);
  if (!config) return { ...DEFAULT_FORM_DATA, warnings };

  const suppressions = new Set(config.suppressedBonuses ?? []);
  return {
    ...DEFAULT_FORM_DATA,
    enabled: true,
    filter: config.filter,
    damageMode: config.damageMode,
    attackBonus: config.attackBonus,
    damageBonus: config.damageBonus,
    nonCritDamageBonus: config.nonCritDamageBonus,
    extraAttacksText: extraAttacksToText(config.extraAttacks),
    held: config.held,
    charge: config.charge === true,
    iteratives: config.iteratives !== false,
    suppressNaturalAttack: suppressions.has("naturalAttack"),
    suppressAbilityDamage: suppressions.has("abilityDamage"),
    warnings,
  };
}

export function applyWeaponAttackPreset(preset, current) {
  const base = { ...DEFAULT_FORM_DATA, ...current, preset };
  if (preset === "custom") return current;
  if (preset === "raite") {
    return {
      ...base,
      enabled: true,
      filter: "unarmedOnly",
      damageMode: "replace",
      charge: false,
      iteratives: true,
    };
  }
  if (preset === "jikiUchi") {
    return {
      ...base,
      enabled: true,
      filter: "meleeOrUnarmed",
      damageMode: "add",
      charge: false,
      iteratives: true,
    };
  }
  if (preset === "ryuutsuki") {
    return {
      ...base,
      enabled: true,
      filter: "meleeOrUnarmed",
      damageMode: "add",
      charge: true,
      iteratives: true,
    };
  }
  if (preset === "fixedCombo") {
    return {
      ...base,
      enabled: true,
      damageMode: base.damageMode || "replace",
      iteratives: false,
    };
  }
  return current;
}

export function normalizeExtraAttacksText(value) {
  return String(value ?? "")
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(";");
}

export function buildWeaponAttackDictionaryUpdates(formData, currentDictionary = {}) {
  const updates = {};
  if (Object.hasOwn(currentDictionary, "weaponAttack")) {
    updates["system.flags.dictionary.-=weaponAttack"] = null;
  }
  for (const key of WEAPON_ATTACK_FIELD_KEYS) {
    updates[`system.flags.dictionary.-=weaponAttack.${key}`] = null;
  }

  if (formData.enabled !== true) return updates;

  const put = (key, value) => {
    const stringValue = String(value ?? "").trim();
    if (stringValue) {
      updates[`system.flags.dictionary.weaponAttack.${key}`] = stringValue;
      delete updates[`system.flags.dictionary.-=weaponAttack.${key}`];
    }
  };

  put("mode", "selected");
  put("filter", formData.filter || "meleeWeapon");
  put("damageMode", formData.damageMode || "add");
  put("attackBonus", formData.attackBonus);
  put("damageBonus", formData.damageBonus);
  put("nonCritDamageBonus", formData.nonCritDamageBonus);
  put("held", formData.held);

  if (formData.charge === true) put("charge", "true");
  if (formData.iteratives === false) put("iteratives", "false");

  const extraAttacks = normalizeExtraAttacksText(formData.extraAttacksText);
  put("extraAttacks", extraAttacks);

  const suppressions = [];
  if (formData.suppressNaturalAttack === true) suppressions.push("naturalAttack");
  if (formData.suppressAbilityDamage === true) suppressions.push("abilityDamage");
  put("suppressedBonuses", suppressions.join(","));

  for (const key of Object.keys(updates)) {
    if (!key.includes(".-=")) continue;
    const field = key.slice("system.flags.dictionary.-=".length);
    if (Object.hasOwn(currentDictionary, field)) continue;
    delete updates[key];
  }

  return updates;
}

export function buildWeaponAttackSummary(formData, localize = defaultLocalize) {
  if (formData.enabled !== true) return { enabled: false, parts: [], label: "" };

  const parts = [
    filterSummary(formData.filter, localize),
    damageModeSummary(formData.damageMode, localize),
  ];
  if (formData.charge === true) parts.push(localize("NarutoD20.WeaponAttack.Summary.Charge"));

  const attackCount = 1 + countExtraAttacks(formData.extraAttacksText);
  if (attackCount > 1) {
    parts.push(
      localize("NarutoD20.WeaponAttack.Summary.Attacks", {
        count: attackCount,
      }),
    );
  }
  if (formData.iteratives === false) {
    parts.push(localize("NarutoD20.WeaponAttack.Summary.NoIteratives"));
  }

  return {
    enabled: true,
    parts,
    label: parts.join(" · "),
  };
}

export function weaponAttackFormDataFromForm(formData) {
  return {
    enabled: formData["system.weaponAttack.enabled"] === true,
    preset: String(formData["system.weaponAttack.preset"] ?? "custom"),
    filter: String(formData["system.weaponAttack.filter"] ?? "meleeWeapon"),
    damageMode: String(formData["system.weaponAttack.damageMode"] ?? "add"),
    attackBonus: String(formData["system.weaponAttack.attackBonus"] ?? ""),
    damageBonus: String(formData["system.weaponAttack.damageBonus"] ?? ""),
    nonCritDamageBonus: String(formData["system.weaponAttack.nonCritDamageBonus"] ?? ""),
    extraAttacksText: String(formData["system.weaponAttack.extraAttacksText"] ?? ""),
    held: String(formData["system.weaponAttack.held"] ?? ""),
    charge: formData["system.weaponAttack.charge"] === true,
    iteratives: formData["system.weaponAttack.iteratives"] !== false,
    suppressNaturalAttack: formData["system.weaponAttack.suppressNaturalAttack"] === true,
    suppressAbilityDamage: formData["system.weaponAttack.suppressAbilityDamage"] === true,
  };
}

export function removeSyntheticWeaponAttackFormFields(formData) {
  for (const key of Object.keys(formData)) {
    if (key.startsWith("system.weaponAttack.")) delete formData[key];
  }
}

function extraAttacksToText(extraAttacks) {
  return (extraAttacks ?? [])
    .map(({ formula, name }) => [formula, name].filter(Boolean).join("|"))
    .join("\n");
}

function countExtraAttacks(extraAttacksText) {
  const normalized = normalizeExtraAttacksText(extraAttacksText);
  if (!normalized) return 0;
  return normalized.split(";").filter(Boolean).length;
}

function filterSummary(filter, localize) {
  if (filter === "unarmedOnly") return localize("NarutoD20.WeaponAttack.Summary.SelectedUnarmed");
  if (filter === "rangedWeapon") return localize("NarutoD20.WeaponAttack.Summary.SelectedRanged");
  if (filter === "meleeOrUnarmed")
    return localize("NarutoD20.WeaponAttack.Summary.SelectedMeleeOrUnarmed");
  return localize("NarutoD20.WeaponAttack.Summary.SelectedMelee");
}

function damageModeSummary(damageMode, localize) {
  if (damageMode === "replace") return localize("NarutoD20.WeaponAttack.Summary.ReplaceDamage");
  return localize("NarutoD20.WeaponAttack.Summary.AddDamage");
}

function defaultLocalize(key, data = {}) {
  const dictionary = {
    "NarutoD20.WeaponAttack.Summary.SelectedUnarmed": "Selected Unarmed",
    "NarutoD20.WeaponAttack.Summary.SelectedRanged": "Selected Ranged",
    "NarutoD20.WeaponAttack.Summary.SelectedMeleeOrUnarmed": "Selected Melee/Unarmed",
    "NarutoD20.WeaponAttack.Summary.SelectedMelee": "Selected Melee",
    "NarutoD20.WeaponAttack.Summary.ReplaceDamage": "Replace damage",
    "NarutoD20.WeaponAttack.Summary.AddDamage": "Add damage",
    "NarutoD20.WeaponAttack.Summary.Charge": "charge",
    "NarutoD20.WeaponAttack.Summary.NoIteratives": "no iteratives",
  };
  if (key === "NarutoD20.WeaponAttack.Summary.Attacks") return `${data.count} attacks`;
  return dictionary[key] ?? key;
}
