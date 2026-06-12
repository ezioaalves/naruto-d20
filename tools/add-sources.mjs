/**
 * tools/add-sources.mjs
 *
 * Reads page-number data from the narutod20_db JSON source files and injects
 * PF1e-compatible `system.sources` entries into each technique's compendium
 * source JSON in packs/_source/techniques/.
 *
 * Each technique gets a single source entry:
 *   { title: "NarutoD20 Redux v1.3", pages: "<page>" }
 *
 * Matching is done by uppercased technique name.
 *
 * Usage:  node tools/add-sources.mjs [--dry-run] [--force]
 *   --dry-run  print what would change, write nothing
 *   --force    overwrite even if system.sources is already populated
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TECHNIQUES_DIR = join(ROOT, "packs/_source/techniques");

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const BOOK_TITLE = "NarutoD20 Redux v1.3";

// ─── JSON DB path (sibling project) ─────────────────────────────────────────

const DB_JSON_DIR = resolve(
  ROOT,
  "../../../../projetos/naruto/narutod20_db/data_sources/json/techniques",
);

// ─── Build lookup: UPPERCASED name → page number ────────────────────────────

function buildPageLookup() {
  const lookup = new Map();
  let files;
  try {
    files = readdirSync(DB_JSON_DIR).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.error(`Error reading DB JSON dir: ${DB_JSON_DIR}`);
    console.error(err.message);
    process.exit(1);
  }

  for (const filename of files) {
    const path = join(DB_JSON_DIR, filename);
    const data = JSON.parse(readFileSync(path, "utf8"));
    for (const tech of data) {
      const name = tech.name.trim().toUpperCase();
      const page = tech.page;
      if (page != null) {
        lookup.set(name, String(page));
      }
    }
  }

  return lookup;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const pageLookup = buildPageLookup();
console.log(`Loaded ${pageLookup.size} techniques from narutod20_db.\n`);

const files = readdirSync(TECHNIQUES_DIR).filter((f) => f.endsWith(".json"));

let total = 0;
let updated = 0;
let skipped = 0;
let noMatch = 0;

for (const filename of files) {
  const path = join(TECHNIQUES_DIR, filename);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    continue;
  }

  // Only process technique items (skip folders)
  if (doc.type !== "naruto-d20.technique") continue;
  total++;

  // Skip if already has sources (unless --force)
  const existing = doc.system?.sources;
  if (
    !FORCE &&
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    skipped++;
    continue;
  }

  const name = doc.name.trim().toUpperCase();
  const page = pageLookup.get(name);

  if (page == null) {
    noMatch++;
    console.log(`  [no match] ${doc.name}`);
    continue;
  }

  const sourceEntry = { title: BOOK_TITLE, pages: page };
  doc.system.sources = [sourceEntry];

  if (DRY_RUN) {
    console.log(`[dry-run] ${doc.name} → p.${page}`);
  } else {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
  updated++;
}

console.log(`\nDone. ${total} techniques scanned.`);
console.log(`  ${updated} source(s) added${DRY_RUN ? " (dry-run, not written)" : ""}.`);
console.log(`  ${skipped} skipped (already had sources).`);
if (noMatch > 0) {
  console.log(`  ${noMatch} technique(s) had no match in narutod20_db.`);
}
