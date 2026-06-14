/**
 * tools/normalize-buff-display-names.mjs
 *
 * Two compendium-data normalizations for technique-buffs (and the matching
 * technique), so roll breakdowns read consistently:
 *
 *   1. Casing — the Kanigakure Raiton entry is the only technique-buff stored in
 *      Title Case while the other 52 are ALL CAPS. Uppercase its `name` (on both
 *      the technique and the buff) to match the rest.
 *
 *   2. Short source label — PF1e labels each change in a damage/attack roll
 *      breakdown with `change.flavor`, defaulting to the parent buff's *full*
 *      `JAPANESE (ENGLISH)` name (change.mjs:115). That eats horizontal space.
 *      Set every technique-buff change's `flavor` to the Japanese-only part of
 *      the buff name (substring before the first "(", trimmed) so breakdowns show
 *      e.g. "CHAMPURU DAICHI SUTANSU -AYAUI APPUKU" instead of the whole string.
 *      The buff `name` itself (both languages) is left intact.
 *
 * Run order matters: the Kanigakure uppercase happens first, so its derived
 * flavor comes out uppercase too.
 *
 * Usage:  node tools/normalize-buff-display-names.mjs [--dry-run]
 *   --dry-run  print the name → flavor table, write nothing
 *
 * After running (without --dry-run): `npm run pack && npm run pack:buffs`.
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TECHNIQUES_DIR = join(ROOT, "packs/_source/techniques");
const BUFFS_DIR = join(ROOT, "packs/_source/technique-buffs");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Kanigakure entries to uppercase (req #1) ───────────────────────────────
// Targeted by filename so nothing else is touched.

const UPPERCASE_TARGETS = [
  {
    dir: TECHNIQUES_DIR,
    file: "KANIGAKURE_HIDEN__RAITON_DENKI_SHOKKU__HIDDEN_CRAB_SECRET__LIGHTNING_RELEASE_ELECTRIC_SHOCK__7tyu2YZQGKu4XpPk.json",
  },
  {
    dir: BUFFS_DIR,
    file: "Kanigakure_Hiden__Raiton___Denki_Shokku__Hidden_Crab_Secret__Lightning_Release___Electric_Shock__28Qu45oYDxPj1Cv1.json",
  },
];

/** Japanese-only portion of a "JAPANESE (ENGLISH) (Variant)" name. */
function japaneseOnly(name) {
  return name.split("(")[0].trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, doc) {
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

// ─── Step 1: uppercase Kanigakure names ─────────────────────────────────────

console.log("== Step 1: uppercase Kanigakure name ==");
for (const { dir, file } of UPPERCASE_TARGETS) {
  const path = join(dir, file);
  let doc;
  try {
    doc = readJson(path);
  } catch (err) {
    console.error(`  [error] cannot read ${file}: ${err.message}`);
    process.exitCode = 1;
    continue;
  }
  const before = doc.name;
  const after = before.toUpperCase();
  if (before === after) {
    console.log(`  [already uppercase] ${before}`);
    continue;
  }
  doc.name = after;
  console.log(`  ${before}\n    → ${after}`);
  if (!DRY_RUN) writeJson(path, doc);
}

// ─── Step 2: set Japanese-only flavor on every technique-buff change ─────────

console.log("\n== Step 2: set Japanese-only flavor on buff changes ==");
const buffFiles = readdirSync(BUFFS_DIR).filter((f) => f.endsWith(".json"));

let buffs = 0;
let changesUpdated = 0;
let noChanges = 0;

for (const filename of buffFiles) {
  const path = join(BUFFS_DIR, filename);
  let doc;
  try {
    doc = readJson(path);
  } catch {
    continue;
  }
  if (doc.type !== "buff") continue;
  buffs++;

  const flavor = japaneseOnly(doc.name);
  const changes = doc.system?.changes ?? [];
  if (changes.length === 0) {
    noChanges++;
    console.log(`  [no changes] ${doc.name}`);
    continue;
  }

  for (const c of changes) {
    c.flavor = flavor;
    changesUpdated++;
  }

  console.log(`  ${doc.name}\n    → flavor: "${flavor}" (${changes.length} change(s))`);
  if (!DRY_RUN) writeJson(path, doc);
}

console.log(
  `\nDone. ${buffs} buff(s) scanned, ${changesUpdated} change flavor(s) set` +
    (noChanges ? `, ${noChanges} buff(s) had no changes` : "") +
    (DRY_RUN ? " (dry-run, nothing written)." : "."),
);
if (!DRY_RUN) {
  console.log("Next: npm run pack && npm run pack:buffs");
}
