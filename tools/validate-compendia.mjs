/**
 * Validate unpacked compendium source JSON for the Naruto D20 module.
 *
 * This is intentionally lightweight: it catches structural mistakes that break
 * Foundry/PF1e runtime behavior without trying to fully reimplement PF1e or the
 * Technique TypeDataModel.
 *
 * Usage:
 *   node tools/validate-compendia.mjs
 *   node tools/validate-compendia.mjs --strict-warnings
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");
const DEFAULT_SOURCE_ROOT = join(DEFAULT_ROOT, "packs/_source");

const ACTION_ID_RE = /^[A-Za-z0-9]+$/;

const PACKS = [
  { name: "techniques", dir: "techniques", type: "naruto-d20.technique" },
  { name: "feats", dir: "feats", type: "feat" },
  { name: "technique-buffs", dir: "technique-buffs", type: "buff" },
  { name: "equipments", dir: "equipments", type: null },
  { name: "occupations", dir: "occupations", type: "feat" },
  { name: "occupations-community", dir: "occupations-community", type: "feat" },
];

const DISCIPLINES = new Set([
  "Chakra Control",
  "Fuinjutsu",
  "Genjutsu",
  "Ninjutsu",
  "Taijutsu",
  "Hachimon Tonkou",
  "Training",
  "",
]);

const COMPLEXITIES = new Set([
  "Extremely Easy",
  "Very Easy",
  "Easy",
  "E-Class",
  "D-Class",
  "C-Class",
  "B-Class",
  "A-Class",
  "S-Class",
  "SS-Class",
  "Epic",
]);

const AUTOMATION_TARGET_MODES = new Set(["auto", "self", "selected"]);
const EMPOWER_MODES = new Set(["damageBonus"]);
const WEAPON_ATTACK_PREFIX = "weaponAttack";
const WEAPON_ATTACK_KEYS = new Set([
  "mode",
  "filter",
  "damageMode",
  "attackBonus",
  "damageBonus",
  "nonCritDamageBonus",
  "extraAttacks",
  "held",
  "charge",
  "suppressedBonuses",
]);
const WEAPON_ATTACK_MODES = new Set(["selected"]);
const WEAPON_ATTACK_DAMAGE_MODES = new Set(["add", "replace"]);
const WEAPON_ATTACK_FILTERS = new Set([
  "meleeWeapon",
  "rangedWeapon",
  "unarmedOnly",
  "meleeOrUnarmed",
]);
const WEAPON_ATTACK_SUPPRESSED_BONUSES = new Set(["naturalAttack", "abilityDamage"]);
const TRAINING_WEIGHT_TABLE = Object.freeze({
  1: Object.freeze({ weight: 25, rankPenalty: 1, learnBonus: 1 }),
  2: Object.freeze({ weight: 37.5, rankPenalty: 2, learnBonus: 2 }),
  3: Object.freeze({ weight: 50, rankPenalty: 3, learnBonus: 3 }),
  4: Object.freeze({ weight: 62.5, rankPenalty: 4, learnBonus: 4 }),
  5: Object.freeze({ weight: 75, rankPenalty: 5, learnBonus: 5 }),
  6: Object.freeze({ weight: 150, rankPenalty: 6, learnBonus: 5 }),
  7: Object.freeze({ weight: 250, rankPenalty: 8, learnBonus: 5 }),
  8: Object.freeze({ weight: 500, rankPenalty: 10, learnBonus: 5 }),
});

const docsByPack = new Map();
const foldersByPack = new Map();
const issues = [];
let activeRoot = DEFAULT_ROOT;
let activeSourceRoot = DEFAULT_SOURCE_ROOT;

function addIssue(severity, pack, file, message) {
  issues.push({ severity, pack, file, message });
}

function error(pack, file, message) {
  addIssue("error", pack, file, message);
}

function warn(pack, file, message) {
  addIssue("warning", pack, file, message);
}

function rel(path) {
  return relative(activeRoot, path);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function normalizeLookupName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readPack({ name, dir, type }) {
  const packDir = join(activeSourceRoot, dir);
  const docs = [];
  const folders = [];
  if (!existsSync(packDir)) {
    error(name, dir, `missing source directory ${rel(packDir)}`);
    docsByPack.set(name, docs);
    foldersByPack.set(name, folders);
    return docs;
  }

  for (const filename of readdirSync(packDir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const path = join(packDir, filename);
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      error(name, filename, `invalid JSON: ${err.message}`);
      continue;
    }

    if (isFolderDoc(doc)) {
      folders.push({ doc, filename, path, packName: name });
      continue;
    }

    docs.push({ doc, filename, path, expectedType: type, packName: name });
  }

  docsByPack.set(name, docs);
  foldersByPack.set(name, folders);
  return docs;
}

function isFolderDoc(doc) {
  return doc?._key?.startsWith?.("!folders!") || doc?.type === "Folder";
}

function validateCommon({ doc, filename, packName, expectedType }) {
  if (expectedType !== null && doc.type !== expectedType) {
    error(packName, filename, `expected type "${expectedType}", got "${doc.type ?? "<missing>"}"`);
  }

  if (!isNonEmptyString(doc._id)) error(packName, filename, "missing non-empty _id");
  if (!isNonEmptyString(doc.name)) error(packName, filename, "missing non-empty name");
  if (!isPlainObject(doc.system)) error(packName, filename, "missing system object");

  if (isNonEmptyString(doc._id) && doc._key !== undefined && doc._key !== `!items!${doc._id}`) {
    warn(packName, filename, `_key "${doc._key}" does not match _id "${doc._id}"`);
  }

  validateActions(packName, filename, doc.system?.actions, {
    technique: doc.type === "naruto-d20.technique",
    range: doc.system?.range,
    suppressedBonuses: weaponAttackSuppressedBonuses(doc.system?.flags?.dictionary),
  });
  validateChanges(packName, filename, doc.system?.changes);
  validateLinks(packName, filename, doc.system?.links);
}

function validateUniqueIds(packName, docs) {
  const ids = new Map();
  for (const { doc, filename } of docs) {
    if (!isNonEmptyString(doc._id)) continue;
    const previous = ids.get(doc._id);
    if (previous) {
      error(packName, filename, `duplicate _id "${doc._id}" also used by ${previous}`);
    } else {
      ids.set(doc._id, filename);
    }
  }
}

function validateActions(
  packName,
  filename,
  actions,
  { technique = false, range, suppressedBonuses = new Set() } = {},
) {
  if (actions === undefined) return;
  if (!Array.isArray(actions)) {
    error(packName, filename, "system.actions must be an array");
    return;
  }

  const seen = new Set();
  actions.forEach((action, index) => {
    const prefix = `system.actions[${index}]`;
    if (!isPlainObject(action)) {
      error(packName, filename, `${prefix} must be an object`);
      return;
    }

    if (action.id && !action._id) error(packName, filename, `${prefix} uses legacy id without _id`);
    if (!isNonEmptyString(action._id)) error(packName, filename, `${prefix} missing _id`);
    else if (!ACTION_ID_RE.test(action._id))
      error(packName, filename, `${prefix} has invalid _id "${action._id}"`);
    else if (seen.has(action._id))
      error(packName, filename, `${prefix} duplicates action _id "${action._id}"`);
    else seen.add(action._id);

    if (technique)
      validateTechniqueAction(packName, filename, prefix, action, range, suppressedBonuses);
  });
}

function isMeleeTouchRange(range) {
  return (
    typeof range === "string" &&
    range
      .trim()
      .replace(/\s*\*$/, "")
      .toLowerCase() === "melee touch"
  );
}

function validateTechniqueAction(packName, filename, prefix, action, range, suppressedBonuses) {
  const type = action.actionType;
  if (type === "msak" || type === "rsak") {
    error(
      packName,
      filename,
      `${prefix}.actionType "${type}" is a PF1e spell attack type; use mwak/rwak for techniques`,
    );
  }

  if (type === "mwak" || type === "rwak") {
    const attack = action.ability?.attack;
    const damage = action.ability?.damage;
    // Melee touch is keyed off the technique's `system.range` descriptor, not
    // the action's range.units (which is "touch" for both melee-touch chakra
    // techniques and physical "Melee attack" strikes).
    const meleeTouch = type === "mwak" && isMeleeTouchRange(range);
    if (attack !== "dex") {
      error(packName, filename, `${prefix} ${type} should use ability.attack="dex"`);
    }
    if (meleeTouch) {
      // Melee touch techniques don't add STR to damage (see #58).
      if (hasActionDamage(action) && damage) {
        error(packName, filename, `${prefix} melee touch with damage should use ability.damage=""`);
      }
    } else if (
      hasActionDamage(action) &&
      damage !== "str" &&
      !suppressedBonuses.has("abilityDamage")
    ) {
      error(packName, filename, `${prefix} ${type} with damage should use ability.damage="str"`);
    }
  }
}

function weaponAttackSuppressedBonuses(dict) {
  if (!isPlainObject(dict)) return new Set();

  const nested =
    dict[WEAPON_ATTACK_PREFIX] &&
    typeof dict[WEAPON_ATTACK_PREFIX] === "object" &&
    !Array.isArray(dict[WEAPON_ATTACK_PREFIX])
      ? dict[WEAPON_ATTACK_PREFIX]
      : null;
  const raw = nested?.suppressedBonuses ?? dict[`${WEAPON_ATTACK_PREFIX}.suppressedBonuses`];
  if (raw === undefined) return new Set();

  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}

function hasActionDamage(action) {
  const parts = action.damage?.parts;
  return (
    Array.isArray(parts) &&
    parts.some((part) => {
      if (typeof part === "string") return part.trim() !== "";
      return isPlainObject(part) && String(part.formula ?? "").trim() !== "";
    })
  );
}

function validateChanges(packName, filename, changes) {
  if (changes === undefined) return;
  if (!Array.isArray(changes)) {
    error(packName, filename, "system.changes must be an array");
    return;
  }

  const seen = new Set();
  changes.forEach((change, index) => {
    const prefix = `system.changes[${index}]`;
    if (!isPlainObject(change)) {
      error(packName, filename, `${prefix} must be an object`);
      return;
    }
    if (!isNonEmptyString(change._id)) error(packName, filename, `${prefix} missing _id`);
    else if (seen.has(change._id))
      error(packName, filename, `${prefix} duplicates change _id "${change._id}"`);
    else seen.add(change._id);
    if (!isNonEmptyString(change.target)) warn(packName, filename, `${prefix} missing target`);
    if (!isNonEmptyString(change.operator)) warn(packName, filename, `${prefix} missing operator`);
  });
}

function validateLinks(packName, filename, links) {
  if (links === undefined) return;
  if (!isPlainObject(links)) {
    error(packName, filename, "system.links must be an object");
    return;
  }

  for (const key of ["prerequisites", "supplements", "children"]) {
    const value = links[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      error(packName, filename, `system.links.${key} must be an array`);
      continue;
    }
    value.forEach((link, index) => {
      const prefix = `system.links.${key}[${index}]`;
      if (!isPlainObject(link)) {
        error(packName, filename, `${prefix} must be an object`);
        return;
      }
      if (!isNonEmptyString(link._id)) error(packName, filename, `${prefix} missing _id`);
      if (!isNonEmptyString(link.uuid)) error(packName, filename, `${prefix} missing uuid`);
    });
  }
}

function validateTechnique({ doc, filename, packName }) {
  const system = doc.system ?? {};

  if (!DISCIPLINES.has(system.discipline)) {
    error(packName, filename, `unknown discipline "${system.discipline ?? "<missing>"}"`);
  }
  if (!isIntegerInRange(system.rank, 1, 15))
    error(packName, filename, `rank must be an integer from 1 to 15`);
  if (!COMPLEXITIES.has(system.complexity))
    error(packName, filename, `unknown complexity "${system.complexity ?? "<missing>"}"`);
  if (!Number.isInteger(system.chakraCost) || system.chakraCost < 0)
    error(packName, filename, "chakraCost must be a non-negative integer");

  if (system.descriptors !== undefined && !Array.isArray(system.descriptors)) {
    error(packName, filename, "system.descriptors must be an array in source JSON");
  }

  if (system.automation !== undefined) {
    if (!isPlainObject(system.automation))
      error(packName, filename, "system.automation must be an object");
    else if (
      system.automation.targetMode !== undefined &&
      !AUTOMATION_TARGET_MODES.has(system.automation.targetMode)
    ) {
      error(packName, filename, `unknown automation.targetMode "${system.automation.targetMode}"`);
    }
  }

  validateEmpower(packName, filename, system.automation?.empower, system.compEmpower === true);
  validateWeaponAttack(doc, filename, packName);
}

function validateWeaponAttack(doc, filename, packName) {
  const dict = doc.system?.flags?.dictionary ?? {};
  if (!isPlainObject(dict)) {
    error(packName, filename, "system.flags.dictionary must be an object");
    return;
  }

  const rawNested = dict[WEAPON_ATTACK_PREFIX];
  const nested =
    rawNested && typeof rawNested === "object" && !Array.isArray(rawNested) ? rawNested : null;
  const malformed = rawNested !== undefined && nested === null;
  const dottedKeys = Object.keys(dict).filter((k) => k.startsWith(`${WEAPON_ATTACK_PREFIX}.`));
  const present = malformed || nested !== null || dottedKeys.length > 0;
  if (!present) return;

  if (malformed)
    error(
      packName,
      filename,
      `"${WEAPON_ATTACK_PREFIX}" must be an object or use dotted "${WEAPON_ATTACK_PREFIX}.*" keys`,
    );

  const values = {};
  const keys = new Set();
  if (nested) {
    for (const [key, value] of Object.entries(nested)) {
      keys.add(key);
      values[key] = value;
    }
  }
  for (const dotted of dottedKeys) {
    const key = dotted.slice(WEAPON_ATTACK_PREFIX.length + 1);
    keys.add(key);
    values[key] ??= dict[dotted];
  }

  for (const key of keys) {
    if (!WEAPON_ATTACK_KEYS.has(key))
      error(packName, filename, `unknown weaponAttack field "${WEAPON_ATTACK_PREFIX}.${key}"`);
  }

  const str = (key) => String(values[key] ?? "").trim();
  const mode = str("mode");
  if (!mode)
    error(packName, filename, `weaponAttack.mode is required when weaponAttack config is present`);
  else if (!WEAPON_ATTACK_MODES.has(mode))
    error(packName, filename, `unsupported weaponAttack.mode "${mode}"`);

  const filter = str("filter") || "meleeWeapon";
  if (!WEAPON_ATTACK_FILTERS.has(filter))
    error(packName, filename, `unsupported weaponAttack.filter "${filter}"`);

  const damageMode = str("damageMode") || "add";
  if (!WEAPON_ATTACK_DAMAGE_MODES.has(damageMode))
    error(packName, filename, `unsupported weaponAttack.damageMode "${damageMode}"`);

  const charge = str("charge").toLowerCase();
  if (charge && charge !== "true" && charge !== "false")
    error(packName, filename, `weaponAttack.charge must be "true" or "false"`);

  const suppressedBonuses = str("suppressedBonuses");
  if (suppressedBonuses) {
    for (const token of suppressedBonuses.split(",")) {
      const value = token.trim();
      if (value && !WEAPON_ATTACK_SUPPRESSED_BONUSES.has(value)) {
        error(packName, filename, `unsupported weaponAttack.suppressedBonuses token "${value}"`);
      }
    }
  }
}

function validateEmpower(packName, filename, empower, hasComponent) {
  if (empower === undefined) {
    if (hasComponent)
      warn(packName, filename, "compEmpower is set but automation.empower is absent");
    return;
  }
  if (!isPlainObject(empower)) {
    error(packName, filename, "system.automation.empower must be an object");
    return;
  }
  if (hasComponent && empower.enabled !== true) {
    warn(packName, filename, "compEmpower is set but automation.empower.enabled is not true");
  }
  if (empower.enabled !== true) return;

  const mode = String(empower.mode ?? "").trim();
  if (!EMPOWER_MODES.has(mode)) {
    error(packName, filename, `unsupported automation.empower.mode "${mode}"`);
  }
  if (!Number.isInteger(empower.costPerStep) || empower.costPerStep < 1) {
    error(packName, filename, "automation.empower.costPerStep must be a positive integer");
  }
  if (!isNonEmptyString(empower.formulaPerStep)) {
    error(packName, filename, "automation.empower.formulaPerStep must be a non-empty string");
  }
  if (empower.damageTypes !== undefined && !Array.isArray(empower.damageTypes)) {
    error(packName, filename, "automation.empower.damageTypes must be an array");
  }
  if (
    empower.performIncreaseEvery !== undefined &&
    (!Number.isInteger(empower.performIncreaseEvery) || empower.performIncreaseEvery < 0)
  ) {
    error(
      packName,
      filename,
      "automation.empower.performIncreaseEvery must be a non-negative integer",
    );
  }
  if (
    empower.performIncreaseAmount !== undefined &&
    (!Number.isInteger(empower.performIncreaseAmount) || empower.performIncreaseAmount < 0)
  ) {
    error(
      packName,
      filename,
      "automation.empower.performIncreaseAmount must be a non-negative integer",
    );
  }
}

function validateFeat({ doc, filename, packName }) {
  const subType = doc.system?.subType;
  if (!isNonEmptyString(subType)) warn(packName, filename, "system.subType is empty");
  if (doc.system?.actions !== undefined) validateActions(packName, filename, doc.system.actions);
}

function validateBuff({ doc, filename, packName }) {
  const subType = doc.system?.subType;
  if (!isNonEmptyString(subType)) warn(packName, filename, "system.subType is empty");
  if (doc.system?.duration !== undefined && !isPlainObject(doc.system.duration)) {
    error(packName, filename, "system.duration must be an object when present");
  }
}

function validateOccupation(ctx) {
  const { doc, filename, packName } = ctx;
  const occupation = doc.flags?.["naruto-d20"]?.occupation;
  if (!isPlainObject(occupation)) {
    error(packName, filename, "missing flags.naruto-d20.occupation");
    return;
  }

  if (doc.type !== "feat") error(packName, filename, "occupation must be a feat item");
  if (doc.system?.subType !== "trait") {
    error(packName, filename, "occupation system.subType must be trait");
  }
  if (!isNonEmptyString(occupation.slug)) {
    error(packName, filename, "occupation.slug is required");
  }

  validateOccupationSkillOptions(packName, filename, occupation.fixedClassSkills, {
    path: "occupation.fixedClassSkills",
  });
  validateOccupationSkillOptions(packName, filename, occupation.classSkillOptions, {
    path: "occupation.classSkillOptions",
  });

  if (!Number.isInteger(occupation.skillSelectCount) || occupation.skillSelectCount < 0) {
    error(packName, filename, "occupation.skillSelectCount must be a non-negative integer");
  } else if (
    Array.isArray(occupation.classSkillOptions) &&
    occupation.skillSelectCount > occupation.classSkillOptions.length
  ) {
    error(packName, filename, "occupation.skillSelectCount exceeds classSkillOptions length");
  }

  validateStringArray(packName, filename, occupation.featOptions, "occupation.featOptions");
  validateStringArray(
    packName,
    filename,
    occupation.manualFeatOptions ?? [],
    "occupation.manualFeatOptions",
  );
  validateStringArray(
    packName,
    filename,
    occupation.techniqueOptions,
    "occupation.techniqueOptions",
  );

  if (typeof occupation.wealthBonus !== "number" || !Number.isFinite(occupation.wealthBonus)) {
    error(packName, filename, "occupation.wealthBonus must be a finite number");
  }
  if (
    typeof occupation.reputationBonus !== "number" ||
    !Number.isFinite(occupation.reputationBonus)
  ) {
    error(packName, filename, "occupation.reputationBonus must be a finite number");
  }

  validateOccupationReferences(packName, filename, occupation);
}

function validateOccupationSkillOptions(packName, filename, value, { path }) {
  if (!Array.isArray(value)) {
    error(packName, filename, `${path} must be an array`);
    return;
  }
  value.forEach((option, index) => {
    const prefix = `${path}[${index}]`;
    if (!isPlainObject(option)) {
      error(packName, filename, `${prefix} must be an object`);
      return;
    }
    if (!isNonEmptyString(option.key)) error(packName, filename, `${prefix}.key is required`);
    if (!isNonEmptyString(option.label)) error(packName, filename, `${prefix}.label is required`);
  });
}

function validateStringArray(packName, filename, value, path) {
  if (!Array.isArray(value)) {
    error(packName, filename, `${path} must be an array`);
    return false;
  }
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) error(packName, filename, `${path}[${index}] must be a string`);
  });
  return true;
}

function validateOccupationReferences(packName, filename, occupation) {
  const featNames = lookupNamesForPack("feats");
  const techniqueNames = lookupNamesForPack("techniques");

  for (const featName of occupation.featOptions ?? []) {
    if (!hasExactLookupName(featNames, featName)) {
      error(packName, filename, `occupation feat option not found: ${featName}`);
    }
  }

  for (const techniqueName of occupation.techniqueOptions ?? []) {
    if (!findFuzzyLookupName(techniqueNames, techniqueName)) {
      error(packName, filename, `occupation technique option not found: ${techniqueName}`);
    }
  }
}

function lookupNamesForPack(packName) {
  return (docsByPack.get(packName) ?? [])
    .map(({ doc }) => doc.name)
    .filter(isNonEmptyString)
    .map(normalizeLookupName);
}

function hasExactLookupName(names, value) {
  return names.includes(normalizeLookupName(value));
}

function findFuzzyLookupName(names, value) {
  const target = normalizeLookupName(value);
  if (!target) return false;
  return names.some(
    (candidate) => candidate === target || candidate.includes(target) || target.includes(candidate),
  );
}

function validateTrainingWeight(packName, filename, doc) {
  if (doc.system?.subType !== "gear") {
    error(packName, filename, `training weight items must use loot subtype "gear"`);
  }

  const flag = doc.flags?.["naruto-d20"]?.trainingWeightItem;
  if (!isPlainObject(flag)) {
    error(packName, filename, "missing flags.naruto-d20.trainingWeightItem");
    return;
  }

  if (!["wrist", "ankle"].includes(flag.slot)) {
    error(packName, filename, `trainingWeightItem.slot must be "wrist" or "ankle"`);
  }
  if (!isIntegerInRange(flag.type, 1, 8)) {
    error(packName, filename, "trainingWeightItem.type must be 1..8");
  }
  const row = TRAINING_WEIGHT_TABLE[flag.type];
  const weight = doc.system?.weight?.value ?? doc.system?.weight;
  if (typeof weight !== "number" || !Number.isFinite(weight)) {
    error(packName, filename, "training weight must define numeric system.weight.value");
  } else if (row && weight !== row.weight) {
    error(packName, filename, `training weight type ${flag.type} must weigh ${row.weight}`);
  }
  if (row && flag.rankPenalty !== row.rankPenalty) {
    error(
      packName,
      filename,
      `trainingWeightItem.rankPenalty for type ${flag.type} must be ${row.rankPenalty}`,
    );
  }
  if (row && flag.learnBonus !== row.learnBonus) {
    error(
      packName,
      filename,
      `trainingWeightItem.learnBonus for type ${flag.type} must be ${row.learnBonus}`,
    );
  }
}

const RANK_BUFF_NAMES = {
  JOURYOKU: "JOURYOKU (STRENGTH RANK)",
  KOUSOKU: "KOUSOKU (SPEED RANK)",
};

function resolveRankBuffName(techniqueName) {
  const match = String(techniqueName ?? "").match(/^[A-Z]+\s+(JOURYOKU|KOUSOKU)\b/i);
  if (!match) return null;
  return RANK_BUFF_NAMES[match[1].toUpperCase()] ?? null;
}

function validateAutomationBuffMatches() {
  const techniques = docsByPack.get("techniques") ?? [];
  const buffs = docsByPack.get("technique-buffs") ?? [];
  const buffNames = new Set(buffs.map(({ doc }) => doc.name).filter(isNonEmptyString));

  for (const { doc, filename, packName } of techniques) {
    if (doc.system?.automation?.enabled !== true) continue;
    if (buffNames.has(doc.name)) continue;
    const hasVariant = Array.from(buffNames).some((name) => name.startsWith(`${doc.name} (`));
    if (hasVariant) continue;
    const rankBuff = resolveRankBuffName(doc.name);
    if (rankBuff && buffNames.has(rankBuff)) continue;
    warn(packName, filename, `automation.enabled is true but no matching buff source was found`);
  }
}

function printSummary() {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  for (const issue of issues) {
    const label = issue.severity.toUpperCase();
    console.log(`${label} ${issue.pack}/${issue.file}: ${issue.message}`);
  }

  console.log("");
  for (const { name } of PACKS) {
    const docs = docsByPack.get(name) ?? [];
    const folders = foldersByPack.get(name) ?? [];
    console.log(
      `${name}: ${docs.length} item document(s) scanned, ${folders.length} folder document(s) skipped`,
    );
  }
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
}

export function validateCompendia({
  root = DEFAULT_ROOT,
  sourceRoot = null,
  strictWarnings = false,
  print = false,
} = {}) {
  activeRoot = resolve(root);
  activeSourceRoot = sourceRoot ? resolve(sourceRoot) : join(activeRoot, "packs/_source");
  issues.length = 0;
  docsByPack.clear();
  foldersByPack.clear();

  for (const pack of PACKS) {
    const docs = readPack(pack);
    validateUniqueIds(pack.name, docs);
    for (const ctx of docs) {
      validateCommon(ctx);
      if (pack.name === "techniques") validateTechnique(ctx);
      if (pack.name === "feats") validateFeat(ctx);
      if (pack.name === "technique-buffs") validateBuff(ctx);
      if (pack.name === "occupations" || pack.name === "occupations-community")
        validateOccupation(ctx);
      if (ctx.doc.flags?.["naruto-d20"]?.trainingWeightItem)
        validateTrainingWeight(pack.name, ctx.filename, ctx.doc);
    }
  }

  validateAutomationBuffMatches();
  if (print) printSummary();

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    issues: issues.map((i) => ({ ...i })),
    errorCount,
    warningCount,
    failed: errorCount > 0 || (strictWarnings && warningCount > 0),
    counts: PACKS.map(({ name }) => ({
      name,
      documents: docsByPack.get(name)?.length ?? 0,
      folders: foldersByPack.get(name)?.length ?? 0,
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateCompendia({
    strictWarnings: process.argv.includes("--strict-warnings"),
    print: true,
  });
  if (result.failed) process.exit(1);
}
