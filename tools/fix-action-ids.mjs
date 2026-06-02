/**
 * Rewrite invalid PF1e ItemAction IDs in unpacked technique source JSON.
 *
 * PF1e v11.11 validates ItemAction._id as alphanumeric. Older generated
 * technique actions used base64url IDs, which can include "-" and "_".
 *
 * Usage: node tools/fix-action-ids.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "packs/_source/techniques");

const DRY_RUN = process.argv.includes("--dry-run");
const ACTION_ID_RE = /^[A-Za-z0-9]+$/;

function isValidActionId(id) {
  return typeof id === "string" && ACTION_ID_RE.test(id);
}

function randomId(existing) {
  let id;
  do {
    id = randomBytes(8).toString("hex");
  } while (existing.has(id));
  return id;
}

let scanned = 0;
let actionsScanned = 0;
let actionsChanged = 0;
let filesChanged = 0;

const files = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

for (const filename of files) {
  const path = join(SRC_DIR, filename);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    continue;
  }

  if (doc.type !== "naruto-d20.technique") continue;
  scanned++;

  const actions = doc.system?.actions;
  if (!Array.isArray(actions)) continue;

  const seen = new Set();
  let changed = false;

  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    actionsScanned++;

    if (action.id && !action._id) {
      action._id = action.id;
      delete action.id;
      changed = true;
    }

    if (!isValidActionId(action._id) || seen.has(action._id)) {
      action._id = randomId(seen);
      changed = true;
      actionsChanged++;
    }

    seen.add(action._id);
  }

  if (!changed) continue;
  filesChanged++;

  if (DRY_RUN) {
    console.log(`[dry-run] ${doc.name} (${filename})`);
  } else {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
}

console.log(`\nDone. ${scanned} techniques scanned.`);
console.log(`  ${actionsScanned} action(s) scanned.`);
console.log(
  `  ${actionsChanged} action id(s) ${DRY_RUN ? "would be" : ""} rewritten${DRY_RUN ? " (dry-run, not written)" : ""}.`,
);
console.log(
  `  ${filesChanged} file(s) ${DRY_RUN ? "would be" : ""} rewritten${DRY_RUN ? " (dry-run, not written)" : ""}.`,
);
