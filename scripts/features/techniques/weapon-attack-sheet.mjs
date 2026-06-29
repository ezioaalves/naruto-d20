import {
  normalizeDamagePartDraftRows,
  normalizeDamagePartRows,
  typeCsvToArray,
  typeArrayToCsv,
} from "./weapon-attack-damage-parts.mjs";

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

export function buildDamageTypeVisualData(types, damageTypeRegistry = null) {
  const normalized = normalizeDamagePartRows([{ formula: "1", types }])[0]?.types ?? [];
  const standard = [];
  const custom = new Set();

  for (const type of normalized) {
    const damageType = damageTypeRegistry?.get?.(type);
    if (damageType) standard.push({ ...damageType, id: damageType.id ?? type });
    else custom.add(type);
  }

  return {
    types: new Set(normalized),
    standard,
    custom,
  };
}

export function damagePartRowsToForm(rows, damageTypeRegistry = null) {
  return normalizeDamagePartFormRows(rows).map((row) => ({
    formula: row.formula,
    typesText: typeArrayToCsv(row.types),
    damage: buildDamageTypeVisualData(row.types, damageTypeRegistry),
  }));
}

export function damagePartRowsFromForm(rows) {
  return normalizeDamagePartFormRows(
    Array.isArray(rows)
      ? rows.map((row) => ({
          formula: row?.formula,
          types: row?.types ?? row?.typesText,
        }))
      : [],
  );
}

/**
 * Set the damage types on a single row, capturing every other row's formula verbatim.
 *
 * `rows` are raw, DOM-captured rows (dense by index, formula + types as typed) — they are
 * NOT pre-normalized, so a still-blank target row survives and keeps its position. The
 * array is padded up to `index` when needed (the row the user is editing may not have been
 * persisted yet) and the input is never mutated. Drop empty rows by passing the result
 * through `damagePartRowsFromForm` at persist time.
 *
 * @param {{ formula?: string, types?: string|string[] }[]} rows
 * @param {number} index
 * @param {string|string[]} types
 * @returns {{ formula: string, types: string[] }[]}
 */
export function setDamagePartTypesAt(rows, index, types) {
  const next = (Array.isArray(rows) ? rows : []).map((row) => ({
    formula: String(row?.formula ?? ""),
    types: row?.types ?? row?.typesText ?? [],
  }));
  if (index < 0) return next;
  while (next.length <= index) next.push({ formula: "", types: [] });
  next[index] = { formula: next[index].formula, types: typeCsvToArray(types) };
  return next;
}

function normalizeDamagePartFormRows(rows) {
  return normalizeDamagePartDraftRows(rows);
}

export function buildWeaponAttackFormData(item, options = {}) {
  const wa = item.system?.weaponAttack;
  if (!wa?.enabled) return { ...DEFAULT_FORM_DATA };
  const damageTypeRegistry = options.damageTypeRegistry ?? null;
  return {
    ...DEFAULT_FORM_DATA,
    enabled: true,
    filter: wa.filter || "meleeWeapon",
    damageMode: wa.damageMode || "add",
    attackBonus: String(wa.attackBonus ?? ""),
    damageParts: damagePartRowsToForm(wa.damageParts, damageTypeRegistry),
    nonCritDamageParts: damagePartRowsToForm(wa.nonCritDamageParts, damageTypeRegistry),
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

/**
 * Collect sparse indexed form keys (e.g. `prefix.0.formula`, `prefix.2.types`) into a
 * dense array of row objects.  Keys consumed here are deleted from `formData` so the caller
 * does not accidentally persist them as raw strings.
 *
 * The returned array is dense (no holes) and preserves the original numeric order of indices,
 * which means a row set like {0, 2} collapses into two consecutive rows [{…}, {…}].
 *
 * @param {Record<string, unknown>} formData - Flat form data object (mutated in place).
 * @param {string} prefix - Dot-separated field prefix, e.g. "system.weaponAttack.damageParts".
 * @returns {{ formula?: string, types?: string, typesText?: string }[]}
 */
export function extractIndexedRows(formData, prefix) {
  const rows = [];
  const match = new RegExp(
    `^${prefix.replaceAll(".", "\\.")}\\.(\\d+)\\.(formula|types|typesText)$`,
  );
  for (const key of Object.keys(formData)) {
    const found = key.match(match);
    if (!found) continue;
    const index = Number(found[1]);
    const field = found[2];
    rows[index] ??= {};
    rows[index][field] = formData[key];
    delete formData[key];
  }
  return rows.filter(Boolean);
}
