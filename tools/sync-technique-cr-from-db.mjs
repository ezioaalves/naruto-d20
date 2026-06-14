/**
 * Sync Naruto d20 technique Chakra Resistance from the external source DB.
 *
 * Usage: node tools/sync-technique-cr-from-db.mjs [--dry-run] [--source <dir>]
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "packs/_source/techniques");
const DEFAULT_DB_DIR = "/home/joelfmjr/projetos/naruto/narutod20_db/data_sources/json/techniques";

const DRY_RUN = process.argv.includes("--dry-run");

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const DB_DIR = resolve(getArgValue("--source", DEFAULT_DB_DIR));

/**
 * Returns true if the technique has Chakra Resistance per the external DB.
 * Empty string / "No" → false. "Yes*", "Yes (harmless)", "*" → true.
 */
function parseCR(raw) {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "no") return false;
  return true;
}

function getJsonFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return getJsonFiles(path);
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectExternalTechniques() {
  const byName = new Map();
  const duplicateNames = new Set();

  for (const path of getJsonFiles(DB_DIR)) {
    const json = readJson(path);
    const records = Array.isArray(json) ? json : [json];

    for (const record of records) {
      if (!record || typeof record !== "object" || typeof record.name !== "string") continue;
      if (byName.has(record.name)) duplicateNames.add(record.name);
      byName.set(record.name, { path, record });
    }
  }

  return { byName, duplicateNames };
}

const external = collectExternalTechniques();
const externalNames = new Set(external.byName.keys());
const matchedExternalNames = new Set();

const summary = {
  moduleTechniques: 0,
  matched: 0,
  changed: 0,
  unchanged: 0,
};

const unmatchedModule = [];
const changedDocs = [];

for (const filename of readdirSync(SRC_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const path = join(SRC_DIR, filename);
  const doc = readJson(path);
  if (doc.type !== "naruto-d20.technique") continue;

  summary.moduleTechniques++;
  const externalEntry = external.byName.get(doc.name);
  if (!externalEntry) {
    unmatchedModule.push(doc.name);
    continue;
  }

  summary.matched++;
  matchedExternalNames.add(doc.name);

  const crValue = parseCR(externalEntry.record.cr);
  const current = doc.system?.chakraResistance ?? false;

  if (crValue === current) {
    summary.unchanged++;
    continue;
  }

  summary.changed++;
  changedDocs.push({
    name: doc.name,
    filename,
    rawCr: externalEntry.record.cr,
    newValue: crValue,
  });

  doc.system.chakraResistance = crValue;

  if (!DRY_RUN) {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
}

const unmatchedExternal = [...externalNames]
  .filter((name) => !matchedExternalNames.has(name))
  .sort();

for (const change of changedDocs) {
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}${change.name} (${change.filename}): cr=${JSON.stringify(change.rawCr)} -> chakraResistance=${change.newValue}`,
  );
}

console.log("\nDone.");
console.log(`  External source: ${DB_DIR}`);
console.log(`  Module techniques scanned: ${summary.moduleTechniques}`);
console.log(`  External techniques indexed: ${external.byName.size}`);
console.log(`  Matched by name: ${summary.matched}`);
console.log(`  Changed: ${summary.changed}${DRY_RUN ? " (dry-run, not written)" : ""}`);
console.log(`  Unchanged: ${summary.unchanged}`);
console.log(`  Unmatched module techniques: ${unmatchedModule.length}`);
console.log(`  Unmatched external techniques: ${unmatchedExternal.length}`);
console.log(`  Duplicate external names: ${external.duplicateNames.size}`);

if (unmatchedModule.length) {
  console.log("\nUnmatched module techniques:");
  for (const name of unmatchedModule) console.log(`  - ${name}`);
}

if (unmatchedExternal.length) {
  console.log("\nUnmatched external techniques:");
  for (const name of unmatchedExternal) console.log(`  - ${name}`);
}

if (external.duplicateNames.size) {
  console.log("\nDuplicate external names:");
  for (const name of [...external.duplicateNames].sort()) console.log(`  - ${name}`);
}
