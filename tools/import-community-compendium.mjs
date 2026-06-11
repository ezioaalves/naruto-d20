/**
 * tools/import-community-compendium.mjs
 *
 * Imports new techniques from the Community Compendium source JSON in the
 * external narutod20_db into packs/_source/techniques/, creating any missing
 * Discipline → Subtype → Rank folder documents along the way.
 *
 * Techniques whose normalized name already exists in the pack are skipped and
 * listed in the summary. Records missing rank/complexity get a best-fit pair
 * derived from the book's Learn DC / Successes / Perform DC.
 *
 * Usage: node tools/import-community-compendium.mjs [--dry-run] [--source <file>]
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "packs/_source/techniques");
const DEFAULT_DB_FILE =
  "/Users/joelfmjr/projetos/naruto/narutod20_db/data_sources/json/techniques/community_compendium.json";

const DRY_RUN = process.argv.includes("--dry-run");

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const DB_FILE = resolve(getArgValue("--source", DEFAULT_DB_FILE));

const BOOK_TITLE = "Community Compendium";

const STATS = {
  coreVersion: "13.350",
  systemId: "pf1",
  systemVersion: "11.11",
  createdTime: null,
  modifiedTime: null,
  lastModifiedBy: null,
};

// ── Complexity (mirrors technique-model.mjs) ────────────────────────────────

const COMPLEXITY_TABLE = {
  "E-Class": { learnMod: 1, successes: 1, performMod: 0 },
  "D-Class": { learnMod: 2, successes: 1, performMod: 1 },
  "C-Class": { learnMod: 3, successes: 2, performMod: 3 },
  "B-Class": { learnMod: 4, successes: 3, performMod: 5 },
  "A-Class": { learnMod: 5, successes: 4, performMod: 7 },
  "S-Class": { learnMod: 6, successes: 5, performMod: 10 },
  "SS-Class": { learnMod: 7, successes: 6, performMod: 15 },
  Epic: { learnMod: 15, successes: 8, performMod: 20 },
};

const COMPLEXITY_ALIASES = {
  E: "E-Class",
  D: "D-Class",
  C: "C-Class",
  B: "B-Class",
  A: "A-Class",
  S: "S-Class",
  SS: "SS-Class",
  EPIC: "Epic",
};

/** Mirror of computeTechniqueDerived for the fields the book lists. */
function deriveStats(rank, complexity, { hij, kin, comb }) {
  const c = COMPLEXITY_TABLE[complexity];
  let { learnMod, successes } = c;
  let successModifier = 0;
  if (hij) successModifier += 1;
  if (kin) successModifier += 2;
  if (comb) {
    learnMod += 5;
    successModifier -= 2;
  }
  successes = Math.max(1, successes + successModifier);
  return {
    learnDC: 10 + rank + learnMod,
    performDC: 10 + rank + c.performMod,
    successes,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normName(name) {
  return String(name)
    .normalize("NFKD")
    .toUpperCase()
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomId() {
  return Array.from({ length: 16 }, () => ID_CHARS[Math.floor(Math.random() * 62)]).join("");
}

function sanitizeFileName(name) {
  return String(name).replace(/[^a-zA-Z0-9]/g, "_");
}

function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text description → single <p> body with <br><br> paragraph breaks. */
function bodyHtml(text) {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => esc(clean(p.replace(/\n/g, " "))))
    .filter(Boolean);
  return paragraphs.join("<br><br>");
}

// ── Icon pools (from the original tools/convert-jutsus.mjs, commit dfa2f3d) ─

const M = "modules/naruto-d20/icons";

const DISC_ICON_POOLS = {
  Ninjutsu: [
    `${M}/spells/fireball-red-1.jpg`, `${M}/spells/fireball-red-2.jpg`, `${M}/spells/fireball-red-3.jpg`,
    `${M}/spells/fireball-sky-1.jpg`, `${M}/spells/fireball-sky-2.jpg`, `${M}/spells/fireball-sky-3.jpg`,
    `${M}/spells/fireball-eerie-1.jpg`, `${M}/spells/fireball-eerie-2.jpg`, `${M}/spells/fireball-eerie-3.jpg`,
    `${M}/spells/explosion-red-1.jpg`, `${M}/spells/explosion-red-2.jpg`, `${M}/spells/explosion-red-3.jpg`,
    `${M}/spells/explosion-orange-1.jpg`, `${M}/spells/explosion-orange-2.jpg`, `${M}/spells/explosion-orange-3.jpg`,
    `${M}/spells/explosion-sky-1.jpg`, `${M}/spells/explosion-sky-2.jpg`, `${M}/spells/explosion-sky-3.jpg`,
    `${M}/spells/beam-red-1.jpg`, `${M}/spells/beam-red-2.jpg`, `${M}/spells/beam-red-3.jpg`,
    `${M}/spells/beam-blue-1.jpg`, `${M}/spells/beam-blue-2.jpg`, `${M}/spells/beam-blue-3.jpg`,
    `${M}/spells/beam-orange-1.jpg`, `${M}/spells/beam-orange-2.jpg`, `${M}/spells/beam-orange-3.jpg`,
    `${M}/spells/beam-sky-1.jpg`, `${M}/spells/beam-sky-2.jpg`, `${M}/spells/beam-sky-3.jpg`,
    `${M}/spells/beam-eerie-1.jpg`, `${M}/spells/beam-eerie-2.jpg`, `${M}/spells/beam-eerie-3.jpg`,
    `${M}/spells/fire-arrows-1.jpg`, `${M}/spells/fire-arrows-2.jpg`, `${M}/spells/fire-arrows-3.jpg`,
    `${M}/spells/fire-arrows-sky-1.jpg`, `${M}/spells/fire-arrows-sky-2.jpg`, `${M}/spells/fire-arrows-sky-3.jpg`,
    `${M}/spells/lighting-fire-1.jpg`, `${M}/spells/lighting-fire-2.jpg`, `${M}/spells/lighting-fire-3.jpg`,
    `${M}/spells/lighting-royal-1.jpg`, `${M}/spells/lighting-royal-2.jpg`, `${M}/spells/lighting-royal-3.jpg`,
    `${M}/spells/lighting-sky-1.jpg`, `${M}/spells/lighting-sky-2.jpg`, `${M}/spells/lighting-sky-3.jpg`,
    `${M}/spells/rock-orange-1.jpg`, `${M}/spells/rock-orange-2.jpg`, `${M}/spells/rock-orange-3.jpg`,
    `${M}/spells/rock-royal-1.jpg`, `${M}/spells/rock-royal-2.jpg`, `${M}/spells/rock-royal-3.jpg`,
    `${M}/spells/wind-sky-1.jpg`, `${M}/spells/wind-sky-2.jpg`, `${M}/spells/wind-sky-3.jpg`,
    `${M}/spells/wind-red-1.jpg`, `${M}/spells/wind-red-2.jpg`, `${M}/spells/wind-red-3.jpg`,
    `${M}/spells/air-burst-air-1.jpg`, `${M}/spells/air-burst-air-2.jpg`, `${M}/spells/air-burst-air-3.jpg`,
    `${M}/spells/needles-fire-1.jpg`, `${M}/spells/needles-fire-2.jpg`, `${M}/spells/needles-fire-3.jpg`,
    `${M}/spells/rip-sky-1.jpg`, `${M}/spells/rip-sky-2.jpg`, `${M}/spells/rip-sky-3.jpg`,
    `${M}/spells/slice-orange-1.jpg`, `${M}/spells/slice-orange-2.jpg`, `${M}/spells/slice-orange-3.jpg`,
    `${M}/spells/vines-jade-1.jpg`, `${M}/spells/vines-jade-2.jpg`, `${M}/spells/vines-jade-3.jpg`,
  ],
  Taijutsu: [
    `${M}/feats/stunning-fist.jpg`, `${M}/feats/improved-unarmed-strike.jpg`,
    `${M}/feats/power-attack.jpg`, `${M}/feats/combat-reflexes.jpg`,
    `${M}/feats/vital-strike.jpg`, `${M}/feats/improved-vital-strike.jpg`,
    `${M}/feats/greater-vital-strike.jpg`, `${M}/feats/weapon-finesse.jpg`,
    `${M}/feats/cleave.jpg`, `${M}/feats/great-cleave.jpg`,
    `${M}/feats/dodge.jpg`, `${M}/feats/combat-expertise.jpg`,
    `${M}/feats/improved-grapple.jpg`, `${M}/feats/greater-grapple.jpg`,
    `${M}/feats/improved-trip.jpg`, `${M}/feats/greater-trip.jpg`,
    `${M}/feats/improved-disarm.png`, `${M}/feats/scorpion-style.jpg`,
    `${M}/feats/shatter-defenses.jpg`, `${M}/feats/medusas-wrath.jpg`,
    `${M}/feats/deadly-stroke.jpg`, `${M}/feats/whirlwind-attack.jpg`,
    `${M}/feats/spring-attack.jpg`, `${M}/feats/lunge.jpg`,
    `${M}/feats/mobility.jpg`, `${M}/feats/acrobatic.jpg`,
    `${M}/feats/acrobatic-step.png`, `${M}/feats/athletic.jpg`,
    `${M}/feats/blind-fight.jpg`, `${M}/feats/deflect-arrows.jpg`,
    `${M}/feats/gorgons-fist.jpg`, `${M}/feats/improved-critical.jpg`,
    `${M}/skills/weapon_01.jpg`, `${M}/skills/weapon_02.jpg`, `${M}/skills/weapon_03.jpg`,
    `${M}/skills/weapon_04.jpg`, `${M}/skills/weapon_05.jpg`, `${M}/skills/weapon_06.jpg`,
    `${M}/skills/weapon_07.jpg`, `${M}/skills/weapon_08.jpg`, `${M}/skills/weapon_09.jpg`,
    `${M}/skills/weapon_10.jpg`, `${M}/skills/weapon_11.jpg`, `${M}/skills/weapon_12.jpg`,
    `${M}/skills/weapon_13.jpg`, `${M}/skills/weapon_14.jpg`, `${M}/skills/weapon_15.jpg`,
    `${M}/skills/weapon_16.jpg`, `${M}/skills/weapon_17.jpg`, `${M}/skills/weapon_18.jpg`,
    `${M}/skills/weapon_20.jpg`, `${M}/skills/weapon_22.jpg`, `${M}/skills/weapon_25.jpg`,
    `${M}/spells/slice-sky-1.jpg`, `${M}/spells/slice-sky-2.jpg`, `${M}/spells/slice-sky-3.jpg`,
    `${M}/spells/rip-acid-1.jpg`, `${M}/spells/rip-acid-2.jpg`, `${M}/spells/rip-acid-3.jpg`,
  ],
  "Chakra Control": [
    `${M}/spells/enchant-blue-1.jpg`, `${M}/spells/enchant-blue-2.jpg`, `${M}/spells/enchant-blue-3.jpg`,
    `${M}/spells/enchant-jade-1.jpg`, `${M}/spells/enchant-jade-2.jpg`, `${M}/spells/enchant-jade-3.jpg`,
    `${M}/spells/enchant-sky-1.jpg`, `${M}/spells/enchant-sky-2.jpg`, `${M}/spells/enchant-sky-3.jpg`,
    `${M}/spells/enchant-royal-1.jpg`, `${M}/spells/enchant-royal-2.jpg`, `${M}/spells/enchant-royal-3.jpg`,
    `${M}/spells/heal-jade-1.jpg`, `${M}/spells/heal-jade-2.jpg`, `${M}/spells/heal-jade-3.jpg`,
    `${M}/spells/heal-royal-1.jpg`, `${M}/spells/heal-royal-2.jpg`, `${M}/spells/heal-royal-3.jpg`,
    `${M}/spells/heal-sky-1.jpg`, `${M}/spells/heal-sky-2.jpg`, `${M}/spells/heal-sky-3.jpg`,
    `${M}/spells/light-blue-1.jpg`, `${M}/spells/light-blue-2.jpg`, `${M}/spells/light-blue-3.jpg`,
    `${M}/spells/light-jade-1.jpg`, `${M}/spells/light-jade-2.jpg`, `${M}/spells/light-jade-3.jpg`,
    `${M}/spells/light-royal-1.jpg`, `${M}/spells/light-royal-2.jpg`, `${M}/spells/light-royal-3.jpg`,
    `${M}/spells/protect-blue-1.jpg`, `${M}/spells/protect-blue-2.jpg`, `${M}/spells/protect-blue-3.jpg`,
    `${M}/spells/haste-sky-1.jpg`, `${M}/spells/haste-sky-2.jpg`, `${M}/spells/haste-sky-3.jpg`,
    `${M}/spells/haste-royal-1.jpg`, `${M}/spells/haste-royal-2.jpg`, `${M}/spells/haste-royal-3.jpg`,
    `${M}/spells/link-blue-1.jpg`, `${M}/spells/link-blue-2.jpg`, `${M}/spells/link-blue-3.jpg`,
  ],
  Genjutsu: [
    `${M}/spells/evil-eye-eerie-1.jpg`, `${M}/spells/evil-eye-eerie-2.jpg`, `${M}/spells/evil-eye-eerie-3.jpg`,
    `${M}/spells/evil-eye-red-1.jpg`, `${M}/spells/evil-eye-red-2.jpg`, `${M}/spells/evil-eye-red-3.jpg`,
    `${M}/spells/horror-eerie-1.jpg`, `${M}/spells/horror-eerie-2.jpg`, `${M}/spells/horror-eerie-3.jpg`,
    `${M}/spells/horror-red-1.jpg`, `${M}/spells/horror-red-2.jpg`, `${M}/spells/horror-red-3.jpg`,
    `${M}/spells/horror-acid-1.jpg`, `${M}/spells/horror-acid-2.jpg`, `${M}/spells/horror-acid-3.jpg`,
    `${M}/spells/fog-magenta-1.jpg`, `${M}/spells/fog-magenta-2.jpg`, `${M}/spells/fog-magenta-3.jpg`,
    `${M}/spells/fog-orange-1.jpg`, `${M}/spells/fog-orange-2.jpg`, `${M}/spells/fog-orange-3.jpg`,
    `${M}/spells/fog-blue-1.jpg`, `${M}/spells/fog-blue-2.jpg`, `${M}/spells/fog-blue-3.jpg`,
    `${M}/spells/wild-eerie-1.jpg`, `${M}/spells/wild-eerie-2.jpg`, `${M}/spells/wild-eerie-3.jpg`,
    `${M}/skills/shadow_01.jpg`, `${M}/skills/shadow_02.jpg`, `${M}/skills/shadow_03.jpg`,
    `${M}/skills/shadow_04.jpg`, `${M}/skills/shadow_05.jpg`, `${M}/skills/shadow_06.jpg`,
    `${M}/skills/shadow_07.jpg`, `${M}/skills/shadow_08.jpg`, `${M}/skills/shadow_09.jpg`,
    `${M}/skills/shadow_10.jpg`, `${M}/skills/shadow_11.jpg`, `${M}/skills/shadow_12.jpg`,
    `${M}/skills/violet_01.jpg`, `${M}/skills/violet_03.jpg`, `${M}/skills/violet_05.jpg`,
    `${M}/skills/violet_07.jpg`, `${M}/skills/violet_09.jpg`, `${M}/skills/violet_11.jpg`,
  ],
  Fuinjutsu: [
    `${M}/spells/runes-blue-1.jpg`, `${M}/spells/runes-blue-2.jpg`, `${M}/spells/runes-blue-3.jpg`,
    `${M}/spells/runes-magenta-1.jpg`, `${M}/spells/runes-magenta-2.jpg`, `${M}/spells/runes-magenta-3.jpg`,
    `${M}/spells/runes-orange-1.jpg`, `${M}/spells/runes-orange-2.jpg`, `${M}/spells/runes-orange-3.jpg`,
    `${M}/spells/runes-royal-1.jpg`, `${M}/spells/runes-royal-2.jpg`, `${M}/spells/runes-royal-3.jpg`,
    `${M}/spells/link-blue-1.jpg`, `${M}/spells/link-blue-2.jpg`, `${M}/spells/link-blue-3.jpg`,
    `${M}/spells/link-eerie-1.jpg`, `${M}/spells/link-eerie-2.jpg`, `${M}/spells/link-eerie-3.jpg`,
    `${M}/spells/link-royal-1.jpg`, `${M}/spells/link-royal-2.jpg`, `${M}/spells/link-royal-3.jpg`,
    `${M}/spells/link-spirit-1.jpg`, `${M}/spells/link-spirit-2.jpg`, `${M}/spells/link-spirit-3.jpg`,
    `${M}/spells/shielding-acid-1.jpg`, `${M}/spells/shielding-acid-2.jpg`, `${M}/spells/shielding-acid-3.jpg`,
    `${M}/spells/shielding-eerie-1.jpg`, `${M}/spells/shielding-eerie-2.jpg`, `${M}/spells/shielding-eerie-3.jpg`,
    `${M}/spells/shielding-spirit-1.jpg`, `${M}/spells/shielding-spirit-2.jpg`, `${M}/spells/shielding-spirit-3.jpg`,
    `${M}/spells/protect-red-1.jpg`, `${M}/spells/protect-red-2.jpg`, `${M}/spells/protect-red-3.jpg`,
    `${M}/spells/protect-magenta-1.jpg`, `${M}/spells/protect-magenta-2.jpg`, `${M}/spells/protect-magenta-3.jpg`,
  ],
  Training: [
    `${M}/feats/skill-focus.jpg`, `${M}/feats/iron-will.jpg`,
    `${M}/feats/toughness.jpg`, `${M}/feats/endurance.png`,
    `${M}/feats/great-fortitude.jpg`, `${M}/feats/lighting-reflexes.jpg`,
    `${M}/feats/improved-initiative.jpg`, `${M}/feats/alertness.jpg`,
    `${M}/feats/combat-casting.jpg`, `${M}/feats/magical-aptitude.jpg`,
    `${M}/feats/self-suficient.jpg`, `${M}/feats/persuasive.jpg`,
    `${M}/feats/diehard.jpg`, `${M}/feats/improved-iron-will.jpg`,
    `${M}/feats/improved-great-fortitude.jpg`,
    `${M}/feats/improved-lighting-reflexes.jpg`,
  ],
};

function pickIcon(discipline, name) {
  const pool = DISC_ICON_POOLS[discipline] ?? DISC_ICON_POOLS["Ninjutsu"];
  return pool[hashName(name) % pool.length];
}

// ── Field mappers ────────────────────────────────────────────────────────────

const warnings = [];
function warn(msg) {
  warnings.push(msg);
}

/** Empty / "No" → false; "Yes", "Yes*", "*" → true. Same rule as sync-technique-cr-from-db. */
function parseCR(raw) {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized || normalized === "no") return false;
  return true;
}

function parseComponents(raw, techName) {
  const flags = {
    compHandSeals: false,
    compHalfSeals: false,
    compConcentration: false,
    compMobility: false,
    compFocus: false,
    compEmpower: false,
    compMastery: false,
    compExpendable: false,
    compPhysical: false,
    compXpCost: false,
  };
  const SHORT_CODES = new Set(["C", "H", "S", "MOB", "F", "E", "MAS", "M", "P", "X", "XP"]);
  const tokens = [];
  for (const rawToken of String(raw ?? "").split(",")) {
    const token = rawToken
      .replace(/\(see\s+text\)/gi, "")
      .replace(/range:.*$/i, "") // OCR leak: stat-block "Range:" merged into components
      .replace(/[*.]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!token) continue;
    // OCR sometimes merges two codes without a comma ("M Mas") — split when
    // every space-separated part is itself a known short code.
    const parts = token.split(" ");
    if (parts.length > 1 && parts.every((p) => SHORT_CODES.has(p.toUpperCase()))) {
      tokens.push(...parts);
    } else {
      tokens.push(token);
    }
  }
  for (const token of tokens) {
    const t = token.toUpperCase();
    if (t === "C" || t === "CONCENTRATION") flags.compConcentration = true;
    else if (t === "H" || t === "HAND SEALS") flags.compHandSeals = true;
    else if (t === "S" || t === "HALF-SEALS") flags.compHalfSeals = true;
    else if (t === "MOB" || t === "MOBILITY") flags.compMobility = true;
    else if (t === "F" || t === "FOCUS") flags.compFocus = true;
    else if (t === "E" || t === "EMPOWER") flags.compEmpower = true;
    else if (t === "MAS" || t === "MASTERY") flags.compMastery = true;
    else if (t === "P" || t === "PHYSICAL") flags.compPhysical = true;
    else if (t === "X" || t === "XP" || t === "XP COST") flags.compXpCost = true;
    else if (t === "M") continue; // Material focus — no boolean field, kept as description text
    else if (t === "NONE") continue;
    else if (t.includes("CONSTITUTION")) flags.compPhysical = true;
    else warn(`${techName}: unknown component token "${token}"`);
  }
  return flags;
}

function mapActivation(raw, techName) {
  let t = String(raw ?? "")
    .toLowerCase()
    .replace(/\(see\s+text\)/g, "")
    .replace(/[*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t === "see text" || t.startsWith("varies")) return "standard";
  // Multiple alternatives ("1 attack action or 1 instant action") → first one.
  t = t.split(/\s+or\s+|,/)[0].trim();
  if (/full[\s-]?(round|attack)/.test(t)) return "full";
  if (t.includes("attack")) return "attack";
  if (t.includes("swift")) return "swift";
  if (t.includes("move")) return "move";
  if (t.includes("instant") || t.includes("immediate")) return "immediate";
  if (t.includes("standard")) return "standard";
  if (t.includes("hour")) return "hour";
  if (t.includes("minute")) return "minute";
  if (t.includes("round")) return "round";
  if (t.includes("free")) return "free";
  warn(`${techName}: unmapped activation time "${raw}" → standard`);
  return "standard";
}

/**
 * Subtype cleanup: "*" → "", collapse OCR spacing, split off stray
 * "; requires ..." suffixes (returned separately for the Requires section).
 */
function cleanSubtype(raw) {
  let s = clean(raw);
  if (s === "*") return { subtype: "", extraRequires: "" };
  const semi = s.indexOf(";");
  let extraRequires = "";
  if (semi !== -1) {
    extraRequires = s.slice(semi + 1).trim().replace(/^requires\s+/i, "");
    s = s.slice(0, semi).trim();
  }
  return { subtype: s, extraRequires };
}

const COMPLEXITY_LIST = Object.keys(COMPLEXITY_TABLE);

/**
 * Resolve (rank, complexity). Uses the record's own values when present;
 * otherwise best-fits against the book's Learn DC / Successes / Perform DC
 * using the same derivation as computeTechniqueDerived.
 */
function resolveRankComplexity(record, flags, techName) {
  const bookRank = parseInt(record.rank, 10);
  const bookComplexity = COMPLEXITY_ALIASES[clean(record.complexity).toUpperCase()] ?? null;
  if (clean(record.complexity) && !bookComplexity) {
    warn(`${techName}: unknown complexity "${record.complexity}"`);
  }

  const learnDC = parseInt(record.learn_dc, 10);
  const successes = parseInt(record.learn_successes, 10);
  const performDC = parseInt(record.perform_dc, 10);

  if (Number.isFinite(bookRank) && bookComplexity) {
    // Informational check: does the model's derivation reproduce the book?
    const d = deriveStats(bookRank, bookComplexity, flags);
    const diffs = [];
    if (Number.isFinite(learnDC) && d.learnDC !== learnDC)
      diffs.push(`learnDC ${d.learnDC}≠${learnDC}`);
    if (Number.isFinite(successes) && d.successes !== successes)
      diffs.push(`successes ${d.successes}≠${successes}`);
    if (Number.isFinite(performDC) && d.performDC !== performDC)
      diffs.push(`performDC ${d.performDC}≠${performDC}`);
    if (diffs.length) warn(`${techName}: derived≠book → ${diffs.join(", ")}`);
    return { rank: bookRank, complexity: bookComplexity, fitted: false };
  }

  if (!Number.isFinite(learnDC) && !Number.isFinite(successes) && !Number.isFinite(performDC)) {
    warn(`${techName}: no rank/complexity and no DCs — defaulting to rank 1 E-Class`);
    return { rank: Number.isFinite(bookRank) ? bookRank : 1, complexity: bookComplexity ?? "E-Class", fitted: true };
  }

  const rankCandidates = Number.isFinite(bookRank)
    ? [bookRank]
    : Array.from({ length: 22 }, (_, i) => i + 1);
  const complexityCandidates = bookComplexity ? [bookComplexity] : COMPLEXITY_LIST;

  let best = null;
  let bestScore = Infinity;
  for (const r of rankCandidates) {
    for (const cx of complexityCandidates) {
      const d = deriveStats(r, cx, flags);
      let score = 0;
      if (Number.isFinite(learnDC)) score += 4 * Math.abs(d.learnDC - learnDC);
      if (Number.isFinite(successes)) score += 2 * Math.abs(d.successes - successes);
      if (Number.isFinite(performDC)) score += Math.abs(d.performDC - performDC);
      if (score < bestScore) {
        bestScore = score;
        best = { rank: r, complexity: cx };
      }
    }
  }
  warn(
    `${techName}: best-fit rank ${best.rank} / ${best.complexity} ` +
      `(book: learnDC ${record.learn_dc || "—"}, succ ${record.learn_successes || "—"}, ` +
      `performDC ${record.perform_dc || "—"}; fit error ${bestScore})`,
  );
  return { ...best, fitted: true };
}

// ── Description HTML ─────────────────────────────────────────────────────────

const EXTRA_SECTIONS = [
  ["requires", "Requires"],
  ["effect", "Effect"],
  ["material_focus", "Material Focus"],
  ["expendable_component", "Expendable Component"],
  ["xp_cost", "XP Cost"],
  ["seal_slots", "Seal Slots"],
  ["scribe", "Scribe"],
  ["defensive_maneuver", "Defensive Maneuver"],
  ["empower", "Empower"],
  ["mastery", "Mastery"],
];

function buildDescription(record, { discipline, subtype, displayRank, extraRequires }) {
  const typeLabel = subtype ? `${discipline} (${subtype})` : discipline;
  const components = clean(record.components) || "None";

  let html =
    `\n<p><b>Type:</b> ${esc(typeLabel)}</p>` +
    `\n<p><b>Rank:</b> ${esc(displayRank)}</p>` +
    `\n<p><b>Chakra Cost:</b> ${esc(clean(record.cost))}</p>` +
    `\n\n<p><b>Learn DC:</b> ${esc(clean(record.learn_dc))} | <b>Successes:</b> ${esc(clean(record.learn_successes))}</p>` +
    `\n<p><b>Perform:</b> ${esc(clean(record.perform))} | <b>Perform DC:</b> ${esc(clean(record.perform_dc))}</p>` +
    `\n\n<p><b>Components:</b> ${esc(components)}</p>` +
    `\n\n<hr>\n\n<p>${bodyHtml(record.description)}</p>\n`;

  const sections = [];
  for (const [field, label] of EXTRA_SECTIONS) {
    let raw = record[field] ?? "";
    if (field === "requires" && extraRequires) {
      raw = clean(raw) ? `${raw}; ${extraRequires}` : extraRequires;
    }
    const rendered = bodyHtml(raw);
    if (!rendered) continue;
    sections.push(`<p><b>${label}:</b> ${rendered}</p>`);
  }
  if (sections.length) {
    html += `\n<hr>${sections.join("\n")}\n`;
  }
  return html;
}

// ── Load existing pack source (items + folder tree) ─────────────────────────

const existingNames = new Set();
const foldersById = new Map();
for (const filename of readdirSync(SRC_DIR)) {
  if (!filename.endsWith(".json")) continue;
  const doc = JSON.parse(readFileSync(join(SRC_DIR, filename), "utf8"));
  if (typeof doc._key !== "string") continue;
  if (doc._key.startsWith("!items!")) existingNames.add(normName(doc.name));
  else if (doc._key.startsWith("!folders!")) foldersById.set(doc._id, doc);
}

function folderPath(id) {
  const parts = [];
  let cursor = id;
  while (cursor) {
    const f = foldersById.get(cursor);
    if (!f) break;
    parts.unshift(f.name);
    cursor = f.folder;
  }
  return parts.join("/");
}

const folderIdByPath = new Map();
for (const id of foldersById.keys()) folderIdByPath.set(folderPath(id), id);

const newFolders = [];
function ensureFolder(pathParts) {
  let parentId = null;
  let path = "";
  for (const name of pathParts) {
    path = path ? `${path}/${name}` : name;
    let id = folderIdByPath.get(path);
    if (!id) {
      id = randomId();
      const doc = {
        _id: id,
        name,
        type: "Item",
        description: "",
        folder: parentId,
        sorting: "a",
        color: null,
        sort: 0,
        _stats: { ...STATS },
        _key: `!folders!${id}`,
      };
      foldersById.set(id, doc);
      folderIdByPath.set(path, id);
      newFolders.push(doc);
    }
    parentId = id;
  }
  return parentId;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const records = JSON.parse(readFileSync(DB_FILE, "utf8"));
console.log(`Loaded ${records.length} Community Compendium records from\n  ${DB_FILE}\n`);

const skipped = [];
const created = [];
const importedNames = new Set();

for (const record of records) {
  const name = clean(record.name);
  const key = normName(name);
  if (existingNames.has(key)) {
    skipped.push(`${name} (already in pack)`);
    continue;
  }
  if (importedNames.has(key)) {
    skipped.push(`${name} (duplicate inside Community Compendium)`);
    continue;
  }
  importedNames.add(key);

  const discipline = clean(record.type);
  const { subtype, extraRequires } = cleanSubtype(record.subtype);
  const descriptors = (record.descriptors ?? []).map(clean).filter(Boolean);
  const flags = {
    hij: descriptors.includes("Hijutsu"),
    kin: descriptors.includes("Kinjutsu"),
    comb: descriptors.includes("Combination"),
  };

  const { rank, complexity } = resolveRankComplexity(record, flags, name);
  const storedRank = Math.min(15, Math.max(1, rank));
  if (storedRank !== rank) {
    warn(`${name}: rank ${rank} clamped to ${storedRank} (schema max); true rank kept in description`);
  }

  let chakraCost = parseInt(record.cost, 10);
  if (!Number.isFinite(chakraCost) || chakraCost < 0) chakraCost = 0;

  const id = randomId();
  const doc = {
    _id: id,
    name,
    type: "naruto-d20.technique",
    img: pickIcon(discipline, name),
    _stats: { ...STATS },
    system: {
      description: {
        value: buildDescription(record, {
          discipline,
          subtype,
          displayRank: clean(record.rank) || String(rank),
          extraRequires,
        }),
        summary: "",
        instructions: "",
      },
      discipline,
      subtype,
      descriptors,
      rank: storedRank,
      complexity,
      chakraCost,
      activation: mapActivation(record.time, name),
      range: clean(record.range),
      target: clean(record.target),
      area: clean(record.area),
      duration: clean(record.duration),
      save: clean(record.save),
      chakraResistance: parseCR(record.cr),
      ...parseComponents(record.components, name),
      compExpendable: Boolean(clean(record.expendable_component)),
      isHijutsu: flags.hij,
      isKinjutsu: flags.kin,
      isCombination: flags.comb,
      performMiscBonus: 0,
      active: false,
      changes: [],
      actions: [],
      scriptCalls: [],
      links: { prerequisites: [], supplements: [], children: [] },
      tag: "",
      tags: [],
      flags: { boolean: {}, dictionary: {} },
      showInQuickbar: false,
      showInCombat: false,
      sources: record.page != null ? [{ title: BOOK_TITLE, pages: String(record.page) }] : [],
    },
    effects: [],
    folder: ensureFolder([
      discipline,
      subtype || "General",
      String(storedRank).padStart(2, "0"),
    ]),
    sort: 0,
    ownership: { default: 0 },
    flags: {},
    _key: `!items!${id}`,
  };

  created.push({ filename: `${sanitizeFileName(name)}_${id}.json`, doc });
}

// ── Write ────────────────────────────────────────────────────────────────────

if (!DRY_RUN) {
  for (const folder of newFolders) {
    writeFileSync(
      join(SRC_DIR, `${sanitizeFileName(folder.name)}_${folder._id}.json`),
      JSON.stringify(folder, null, 2) + "\n",
      "utf8",
    );
  }
  for (const { filename, doc } of created) {
    writeFileSync(join(SRC_DIR, filename), JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`${DRY_RUN ? "[dry-run] Would import" : "Imported"} ${created.length} techniques, ` +
  `${newFolders.length} new folders.\n`);

if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  - ${s}`);
  console.log("");
}

if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
