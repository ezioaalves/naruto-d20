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
const WEAPON_ATTACK_PREFIX = "weaponAttack";
const WEAPON_ATTACK_KEYS = new Set([
  "mode",
  "filter",
  "attackBonus",
  "damageBonus",
  "held",
  "charge",
]);
const WEAPON_ATTACK_MODES = new Set(["selected"]);
const WEAPON_ATTACK_FILTERS = new Set([
  "meleeWeapon",
  "rangedWeapon",
  "unarmedOnly",
  "meleeOrUnarmed",
]);

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
  if (doc.type !== expectedType) {
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

function validateActions(packName, filename, actions, { technique = false } = {}) {
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

    if (technique) validateTechniqueAction(packName, filename, prefix, action);
  });
}

function validateTechniqueAction(packName, filename, prefix, action) {
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
    if (attack !== "dex") {
      error(packName, filename, `${prefix} ${type} should use ability.attack="dex"`);
    }
    if (hasActionDamage(action) && damage !== "str") {
      error(packName, filename, `${prefix} ${type} with damage should use ability.damage="str"`);
    }
  }
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

  const charge = str("charge").toLowerCase();
  if (charge && charge !== "true" && charge !== "false")
    error(packName, filename, `weaponAttack.charge must be "true" or "false"`);
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

function validateAutomationBuffMatches() {
  const techniques = docsByPack.get("techniques") ?? [];
  const buffs = docsByPack.get("technique-buffs") ?? [];
  const buffNames = new Set(buffs.map(({ doc }) => doc.name).filter(isNonEmptyString));

  for (const { doc, filename, packName } of techniques) {
    if (doc.system?.automation?.enabled !== true) continue;
    if (buffNames.has(doc.name)) continue;
    const hasVariant = Array.from(buffNames).some((name) => name.startsWith(`${doc.name} (`));
    if (!hasVariant)
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
