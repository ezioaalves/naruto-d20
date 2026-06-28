import {
  damagePartRowsFromForm,
  damagePartRowsToForm,
} from "./weapon-attack-damage-parts.mjs";

export { damagePartRowsFromForm, damagePartRowsToForm };

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
  damageParts: [],
  nonCritDamageParts: [],
  extraAttacksText: "",
  held: "",
  charge: false,
  iteratives: true,
  suppressNaturalAttack: false,
  suppressAbilityDamage: false,
});

export function buildWeaponAttackFormData(item) {
  const wa = item.system?.weaponAttack;
  if (!wa?.enabled) return { ...DEFAULT_FORM_DATA };
  return {
    ...DEFAULT_FORM_DATA,
    enabled: true,
    filter: wa.filter || "meleeWeapon",
    damageMode: wa.damageMode || "add",
    attackBonus: String(wa.attackBonus ?? ""),
    damageParts: damagePartRowsToForm(wa.damageParts),
    nonCritDamageParts: damagePartRowsToForm(wa.nonCritDamageParts),
    extraAttacksText: extraAttacksTextFromArray(wa.extraAttacks),
    held: wa.held ?? "",
    charge: wa.charge === true,
    iteratives: wa.iteratives !== false,
    suppressNaturalAttack: wa.suppressNaturalAttack === true,
    suppressAbilityDamage: wa.suppressAbilityDamage === true,
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

export function extraAttacksTextFromArray(extraAttacks) {
  return (extraAttacks ?? [])
    .map(({ formula, name }) =>
      [String(formula ?? "").trim(), String(name ?? "").trim()].filter(Boolean).join("|"),
    )
    .filter(Boolean)
    .join("\n");
}

export function extraAttacksArrayFromText(text) {
  return String(text ?? "")
    .split(/[;\n]/)
    .map((entry) => {
      const [formula, name] = entry.split("|").map((s) => s.trim());
      return { formula: formula ?? "", name: name ?? "" };
    })
    .filter((e) => e.formula);
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
