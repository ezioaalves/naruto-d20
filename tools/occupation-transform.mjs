/**
 * Pure transform from kaihou occupation source JSON to naruto-d20 source JSON.
 * Build-time only; imported by tools/import-occupations.mjs and the unit tests.
 */

const NINJA_LORE_SLUG = "knowledge-ninja-lore";
const DEFAULT_OPTS = {
  oldNs: "naruto-d20-kaihou",
  newNs: "naruto-d20",
  img: "icons/skills/social/diplomacy-peace-alliance.webp",
};
const FEAT_ALIASES = new Map([
  ["Archaic Weapon Proficiency", "Archaic Weapons Proficiency"],
  ["Exotic Melee Weapon Proficiency", "Exotic Melee Weapons Proficiency"],
  ["Genius Nin", "Genius Ninja"],
  ["Greater Fortitude", "Great Fortitude"],
  ["Nin Weapon Proficiency", "Nin Weapons Proficiency"],
  ["Resist Poison", "Resist Poisons"],
]);
const MANUAL_FEAT_PATTERNS = [
  /^Armor Proficiency$/i,
  /^Craft Poison\b/i,
  /^Dodge \(/i,
  /^Exotic Weapon Proficiency \(/i,
  /^Expertise \(/i,
  /^Ki Shout \(/i,
  /^Prone Attack$/i,
  /^Powerful Maneuvers$/i,
  /^Remain Conscious$/i,
  /^Skill Focus \(/i,
  /^Tenodori$/i,
  /^Unarmed Combatant \(/i,
  /^Weapon Focus \(/i,
];

function expandAdvancedBloodlineOptions(name) {
  const value = String(name ?? "").trim();
  const match = /^Advanced Bloodline \((.+)\)$/i.exec(value);
  if (!match) return [value];

  const parts = match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [value];
  return parts.map((part) => `Advanced Bloodline (${part})`);
}

export function convertSkillKey(option) {
  if (option?.slug === NINJA_LORE_SLUG || option?.key === "lor") {
    return { ...option, key: "kar" };
  }
  return { ...option };
}

export function dedupeByKey(options) {
  const seen = new Set();
  const out = [];
  for (const option of options ?? []) {
    if (option?.key == null || seen.has(option.key)) continue;
    seen.add(option.key);
    out.push(option);
  }
  return out;
}

export function normalizeFeatOption(name) {
  const value = String(name ?? "").trim();
  return FEAT_ALIASES.get(value) ?? value;
}

export function isManualFeatOption(name) {
  const value = String(name ?? "").trim();
  if (!value) return false;
  if (value.startsWith("[")) return true;
  if (MANUAL_FEAT_PATTERNS.some((pattern) => pattern.test(value))) return true;
  return /\([^)]*,[^)]*\)/.test(value);
}

export function splitFeatOptions(options) {
  const featOptions = [];
  const manualFeatOptions = [];
  for (const option of options ?? []) {
    const normalized = normalizeFeatOption(option);
    const expandedOptions = expandAdvancedBloodlineOptions(normalized);
    for (const expanded of expandedOptions) {
      if (isManualFeatOption(expanded)) manualFeatOptions.push(expanded);
      else featOptions.push(expanded);
    }
  }
  return { featOptions, manualFeatOptions };
}

export function transformOccupationFlag(occupation) {
  const classSkillOptions = dedupeByKey((occupation.classSkillOptions ?? []).map(convertSkillKey));
  const fixedClassSkills = dedupeByKey((occupation.fixedClassSkills ?? []).map(convertSkillKey));
  const requested = Number(occupation.skillSelectCount ?? 0) || 0;
  const skillSelectCount = Math.min(requested, classSkillOptions.length);
  const splitFeats = splitFeatOptions([
    ...(occupation.featOptions ?? []),
    ...(occupation.manualFeatOptions ?? []),
  ]);
  return {
    ...occupation,
    ...splitFeats,
    classSkillOptions,
    fixedClassSkills,
    skillSelectCount,
  };
}

export function transformOccupationDoc(doc, opts = {}) {
  const { oldNs, newNs, img } = { ...DEFAULT_OPTS, ...opts };
  const occupation = doc.flags?.[oldNs]?.occupation ?? {};
  const flags = { ...(doc.flags ?? {}) };
  delete flags[oldNs];
  flags[newNs] = { ...(flags[newNs] ?? {}), occupation: transformOccupationFlag(occupation) };
  return { ...doc, img, flags };
}
