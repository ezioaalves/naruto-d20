/**
 * tools/add-weapon-attack-flags.mjs
 *
 * Finds every technique in packs/_source/techniques/ that:
 *   - has subtype "Strike"
 *   - has actionType "mwak" on its first action
 *   - has no custom damage.parts (relies on weapon damage)
 *   - does NOT already have weaponAttack.mode in flags.dictionary
 *
 * Then stamps the weaponAttack.* dictionary flags so the perform flow
 * opens the weapon selector instead of rolling the technique's own action.
 *
 * Usage:  node tools/add-weapon-attack-flags.mjs [--dry-run]
 *   --dry-run   print candidates and what would change, write nothing
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "packs/_source/techniques");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Filter rules ─────────────────────────────────────────────────────────────
// Techniques whose name starts with these patterns need a RANGED weapon.
const RANGED_FAMILIES = /^KYUJUTSU:|^SHURIKENJUTSU:/i;

// Techniques whose name starts with these patterns use an equipped MELEE WEAPON.
const WEAPON_FAMILIES = new RegExp(
  [
    "^KENJUTSU:",
    "^SOUJUTSU:",
    "^KODACHI",
    "^NITEN ICHIRYU:",
    "^ZAN:",
    "^GATOTSU",
    "^RYU KAN SEN",
    "^RYU SOU SEN",
    "^RYU TSUI",
    "^RYU SHOU SEN",
    "^SOU RYU SEN",
    "^SHI RYU SEN",
    "^HI RYU SEN",
    "^HI:",
    "^SEN:",
    "^HOKOJUTSU:",
    "^TSUIJUTSU:",
    "^KEN:",
    "^SHIDEN\\b",
    "^ISSEN NO SHIDEN",
    "^MIKAZUKI NO MAI",
    "^TSUBAKI NO MAI",
    "^RENSATSU ZANSHIN",
    "^RYUUSEI MASAI",
    "^RYUUTSUKI",
    "^HAMETSU KATA",
    "^GAMIYARI",
    "^KETSUMEI NO TSURUGI",
    "^KOUSEN RYU:",
  ].join("|"),
  "i",
);

// Techniques whose name starts with these patterns use UNARMED / natural attacks.
const UNARMED_FAMILIES = new RegExp(
  [
    "^GOUKEN",
    "^HYUUGA RYU:",
    "^INUZUKA RYU:",
    "^JUURYU",
    "^KENSOKU:",
    "^TAIJUTSU:",
    "^TAIJUTSU OUGI:",
    "^TAIJUTSU HIKEN:",
    "^SHISHI RENDAN",
    "^KAGE BUYOU",
    "^NAGEWAZA:",
    "^SHIME\\b",
    "^SENNEN GOROSHI",
    "^SHOU:",
    "^SENNINRIKI",
    "^RENZUKI",
    "^NIGEKI RENDAN",
    "^SANGEKI",
    "^UKE RENDAN",
    "^TODOME",
    "^UZUKAZE RENGEKI",
    "^KEIKAI-UCHI",
    "^BOUGYOWARU",
    "^BUTSUKARI",
  ].join("|"),
  "i",
);

function determineFilter(name) {
  if (RANGED_FAMILIES.test(name)) return "rangedWeapon";
  if (WEAPON_FAMILIES.test(name)) return "meleeWeapon";
  if (UNARMED_FAMILIES.test(name)) return "unarmedOnly";
  return "meleeOrUnarmed";
}

// ─── Label extraction ─────────────────────────────────────────────────────────
// "KENJUTSU: KIRITSUKI (SWORD ART: CUT AND THRUST)" → "KIRITSUKI"
// "JIKI-UCHI (OPPORTUNITY STRIKE)"                   → "JIKI-UCHI"
function extractLabel(name) {
  let label = name.replace(/\s*\([^)]*\)\s*/g, "").trim();
  const colonIdx = label.lastIndexOf(": ");
  if (colonIdx !== -1) label = label.slice(colonIdx + 2).trim();
  return label;
}

// ─── Candidate check ──────────────────────────────────────────────────────────
function isCandidate(doc) {
  const sys = doc.system ?? {};

  if (sys.subtype !== "Strike") return false;

  const actions = Array.isArray(sys.actions) ? sys.actions : [];
  if (!actions.length) return false;

  const first = actions[0];
  if (first.actionType !== "mwak") return false;

  const damageParts = first.damage?.parts ?? [];
  if (damageParts.length > 0) return false;

  const dict = sys.flags?.dictionary ?? {};
  if (dict["weaponAttack.mode"]) return false;

  return true;
}

// ─── Apply flags ──────────────────────────────────────────────────────────────
function applyFlags(doc) {
  const label = extractLabel(doc.name);
  const filter = determineFilter(doc.name);

  if (!doc.system.flags) doc.system.flags = {};
  if (!doc.system.flags.dictionary) doc.system.flags.dictionary = {};

  const dict = doc.system.flags.dictionary;
  dict["weaponAttack.mode"] = "selected";
  dict["weaponAttack.filter"] = filter;
  dict["weaponAttack.attackBonus"] = `2[${label}]`;
  dict["weaponAttack.damageBonus"] = `2[${label}]`;

  return { label, filter };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
let total = 0,
  applied = 0,
  skipped = 0;
const byFilter = {};

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
  total++;

  if (!isCandidate(doc)) {
    skipped++;
    continue;
  }

  const { label, filter } = applyFlags(doc);
  byFilter[filter] = (byFilter[filter] ?? 0) + 1;

  if (DRY_RUN) {
    console.log(`[${filter}] ${doc.name}  →  2[${label}]`);
  } else {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.log(`Updated [${filter}]: ${doc.name}`);
  }
  applied++;
}

console.log(`\nDone. ${total} techniques scanned.`);
console.log(`  ${applied} ${DRY_RUN ? "would be updated (dry-run)" : "updated"}.`);
console.log(
  `  ${skipped} skipped (not Strike subtype, has custom damage, already has flags, or no mwak action).`,
);
if (Object.keys(byFilter).length) {
  console.log("\n  By filter:");
  for (const [f, n] of Object.entries(byFilter)) console.log(`    ${f}: ${n}`);
}
