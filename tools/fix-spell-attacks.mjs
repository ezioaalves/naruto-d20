/**
 * tools/fix-spell-attacks.mjs
 *
 * Naruto d20 has no "spell attack" concept (rsak/msak), which key off a
 * spellcasting class ability the techniques don't have. This script rewrites
 * every generated action that used those types into the corresponding weapon
 * attack, keyed off DEX to hit and STR for damage:
 *
 *   actionType "rsak" (ranged spell attack) -> "rwak" (ranged weapon attack)
 *   actionType "msak" (melee spell attack)  -> "mwak" (melee weapon attack)
 *
 * Converted actions get ability { attack: "dex", damage: "str", critRange, critMult }
 * (mirroring how Taijutsu actions are seeded in add-actions.mjs). All other
 * fields (range, damage, save, target, touch, ...) are left untouched.
 *
 * Operates only on the unpacked source JSON in packs/_source/. After running,
 * repack with `npm run pack` so the change reaches the LevelDB Foundry loads.
 *
 * Usage:  node tools/fix-spell-attacks.mjs [--dry-run]
 *   --dry-run  print what would change, write nothing
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "packs/_source/techniques");

const DRY_RUN = process.argv.includes("--dry-run");

// rsak -> rwak (ranged), msak -> mwak (melee). Both become weapon attacks.
const TYPE_MAP = { rsak: "rwak", msak: "mwak" };

let total = 0,
  filesChanged = 0;
const counts = { rsak: 0, msak: 0 };

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"));

for (const filename of files) {
  const path = join(SRC_DIR, filename);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    continue;
  }

  if (doc.type !== "naruto-d20.technique") continue;
  total++;

  const actions = doc.system?.actions;
  if (!Array.isArray(actions) || actions.length === 0) continue;

  let changed = false;
  for (const action of actions) {
    const newType = TYPE_MAP[action?.actionType];
    if (!newType) continue;

    counts[action.actionType]++;
    action.actionType = newType;

    // Force DEX to hit and STR for damage, preserving any existing crit values.
    const prev = action.ability ?? {};
    action.ability = {
      attack: "dex",
      damage: "str",
      critRange: prev.critRange ?? 20,
      critMult: prev.critMult ?? 2,
    };

    changed = true;
  }

  if (!changed) continue;
  filesChanged++;

  if (DRY_RUN) {
    console.log(`[dry-run] ${doc.name} (${filename})`);
  } else {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
}

console.log(`\nDone. ${total} techniques scanned.`);
console.log(`  rsak -> rwak: ${counts.rsak}`);
console.log(`  msak -> mwak: ${counts.msak}`);
console.log(
  `  ${filesChanged} file(s) ${DRY_RUN ? "would be" : ""} rewritten${DRY_RUN ? " (dry-run, not written)" : ""}.`,
);
