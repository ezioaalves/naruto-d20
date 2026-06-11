/**
 * tools/add-actions.mjs
 *
 * Reads every naruto-d20.technique JSON in packs/_source/techniques/,
 * generates system.actions[0] from the technique's own flat fields
 * (activation, range, duration, save, area, target, discipline, description),
 * and writes the file back.
 *
 * Skips any technique that already has system.actions entries.
 *
 * Usage:  node tools/add-actions.mjs [--dry-run] [--force]
 *   --dry-run  print what would change, write nothing
 *   --force    overwrite even if system.actions is already populated
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "packs/_source/techniques");

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

function randomId(len = 16) {
  return randomBytes(Math.ceil(len / 2))
    .toString("hex")
    .slice(0, len);
}

// ─── Activation ─────────────────────────────────────────────────────────────

const ACTIVATION_MAP = {
  standard: { type: "standard", unchained: { type: "action", cost: 2 } },
  swift: { type: "swift", unchained: { type: "action", cost: 1 } },
  full: { type: "full", unchained: { type: "action", cost: 3 } },
  free: { type: "free", unchained: { type: "free", cost: 0 } },
  move: { type: "move", unchained: { type: "action", cost: 1 } },
  immediate: { type: "immediate", unchained: { type: "reaction", cost: 0 } },
};

function mapActivation(raw = "standard") {
  return ACTIVATION_MAP[raw.toLowerCase()] ?? ACTIVATION_MAP.standard;
}

// ─── Range ───────────────────────────────────────────────────────────────────

function mapRange(raw = "") {
  const s = raw.trim().toLowerCase();
  if (!s || s === "*") return null;
  if (s === "personal") return { units: "personal" };
  if (/^touch$|^melee\s*touch$/i.test(s)) return { units: "touch" };
  if (/^melee\s*attack$/i.test(s)) return { units: "touch" };
  if (/^close\b/i.test(raw)) return { units: "close" };
  if (/^medium\b/i.test(raw)) return { units: "medium" };
  if (/^long\b/i.test(raw)) return { units: "long" };
  const ft = raw.match(/^(\d+)\s*ft/i);
  if (ft) return { units: "ft", value: ft[1] };
  // Keep as seeText if we can't map it but it has a value
  return { units: "seeText" };
}

// ─── Duration ────────────────────────────────────────────────────────────────

function mapDuration(raw = "") {
  const s = raw.trim().toLowerCase();
  if (!s || s === "*") return { units: "inst" };
  if (/^instant/i.test(s)) return { units: "inst" };
  if (/^perm/i.test(s)) return { units: "perm" };
  if (/^conc/i.test(s)) return { units: "conc" };

  // "1r/level", "1 round/level"
  const roundLevel = s.match(/^(\d+)r\s*\/\s*level/i) || s.match(/^(\d+)\s*round\s*\/\s*level/i);
  if (roundLevel) {
    const n = parseInt(roundLevel[1]);
    return { units: "round", value: n === 1 ? "@cl" : `${n}*@cl` };
  }
  if (/^1\s*round$/i.test(s)) return { units: "round", value: "1" };

  // "1m/level", "Xm/level"
  const minLevel = s.match(/^(\d+)m\s*\/\s*level/i) || s.match(/^(\d+)\s*min\w*\s*\/\s*level/i);
  if (minLevel) {
    const n = parseInt(minLevel[1]);
    return { units: "minute", value: n === 1 ? "@cl" : `${n}*@cl` };
  }
  if (/^1\s*minute?$/i.test(s)) return { units: "minute", value: "1" };
  if (/^(\d+)\s*minutes?$/i.test(s)) {
    const m = s.match(/^(\d+)\s*minute/i);
    return { units: "minute", value: m[1] };
  }

  const hourLevel = s.match(/^(\d+)h\s*\/\s*level/i) || s.match(/^(\d+)\s*hour\s*\/\s*level/i);
  if (hourLevel) {
    const n = parseInt(hourLevel[1]);
    return { units: "hour", value: n === 1 ? "@cl" : `${n}*@cl` };
  }

  const dayLevel = s.match(/^(\d+)d\s*\/\s*level/i) || s.match(/^(\d+)\s*day\s*\/\s*level/i);
  if (dayLevel) {
    const n = parseInt(dayLevel[1]);
    return { units: "day", value: n === 1 ? "@cl" : `${n}*@cl` };
  }

  // "10m/level" style already caught above. Catch "Xh/level" etc.
  if (/\/\s*level/i.test(s)) {
    // generic per-level: try to extract number + unit letter
    const gen = s.match(/^(\d+)\s*([rmhd])\s*\/\s*level/i);
    if (gen) {
      const unitMap = { r: "round", m: "minute", h: "hour", d: "day" };
      return {
        units: unitMap[gen[2].toLowerCase()] ?? "round",
        value: gen[1] === "1" ? "@cl" : `${gen[1]}*@cl`,
      };
    }
  }

  return { units: "seeText" };
}

// ─── Save ────────────────────────────────────────────────────────────────────

function mapSave(raw = "") {
  const s = raw.trim();
  if (!s || /^[*-]+$/.test(s) || /^none$/i.test(s)) return null;

  let type;
  if (/^fort/i.test(s)) type = "fort";
  else if (/^ref/i.test(s)) type = "ref";
  else if (/^will/i.test(s)) type = "will";
  else return null;

  const harmless = /harmless/i.test(s);

  // Normalize description: strip asterisks and trailing notes in parens
  let description = s
    .replace(/\s*\*+\s*/g, "")
    .replace(/\s*\([^)]*\)\s*/g, "")
    .trim();
  // normalize "halves" → "half"
  description = description.replace(/\bhalves\b/i, "half");

  const result = { type, description };
  if (harmless) result.harmless = true;
  return result;
}

// ─── Damage extraction ───────────────────────────────────────────────────────

const DAMAGE_TYPE_MAP = {
  fire: "fire",
  acid: "acid",
  cold: "cold",
  ice: "cold",
  electric: "electric",
  electricity: "electric",
  lightning: "electric",
  sonic: "sonic",
  earth: "earth",
  water: "water",
  wind: "wind",
  air: "wind",
  holy: "holy",
  positive: "holy",
  force: "untyped",
  bludgeoning: "bludgeoning",
  slashing: "slashing",
  piercing: "piercing",
  poison: "poison",
  negative: "negative",
  psychic: "untyped",
  bleed: "untyped",
  untyped: "untyped",
};

function extractDamage(html = "") {
  // Strip HTML tags
  const text = html.replace(/<[^>]+>/g, " ");

  // Match patterns like "4d6 fire damage", "2d6+2 damage", "1d6 points of acid damage"
  const pattern = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(?:points?\s+of\s+)?(?:([a-zA-Z]+)\s+)?damage/gi;
  const matches = [...text.matchAll(pattern)];

  const parts = [];
  for (const m of matches) {
    // Skip "maximum Xd6 damage", "up to Xd6 damage", "minimum Xd6 damage"
    const preceding = text.slice(Math.max(0, m.index - 20), m.index).toLowerCase();
    if (/\b(?:maximum|minimum|max|up\s+to)\s+$/.test(preceding)) continue;
    // Skip "Xd6 damage" where typeWord is actually "additional", "extra", "more", etc.
    const typeWord = (m[2] ?? "").toLowerCase();
    if (["additional", "extra", "more", "bonus", "per", "level"].includes(typeWord)) continue;

    const formula = m[1].replace(/\s+/g, "");
    const typeId = DAMAGE_TYPE_MAP[typeWord] ?? null;
    const types = typeId ? [typeId] : [];
    parts.push({ formula, types });
  }

  // De-duplicate formulas (some descriptions repeat the same damage)
  const seen = new Set();
  return parts.filter((p) => {
    const key = p.formula + "|" + p.types.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── MeasureTemplate ─────────────────────────────────────────────────────────

function extractTemplate(areaText = "") {
  const s = areaText.trim();
  if (!s || s === "*") return null;

  // "X ft. Burst / Circle / Spread / Emanation"
  const circleMatch = s.match(/(\d+)\s*ft\.?\s*(?:burst|circle|spread|emanation)/i);
  if (circleMatch) return { type: "circle", size: circleMatch[1] };

  // "Cone" or "X ft. Cone"
  if (/cone/i.test(s)) {
    const coneSize = s.match(/(\d+)\s*ft/i);
    return { type: "cone", size: coneSize ? coneSize[1] : "30" };
  }

  // "X ft wide Line" or "Line"
  const lineMatch = s.match(/(\d+)\s*ft\.?\s*wide?\s*line/i) || s.match(/(\d+)\s*ft\.?\s*line/i);
  if (lineMatch) return { type: "ray", size: lineMatch[1] };
  if (/\bline\b/i.test(s)) return { type: "ray", size: "30" };

  return null;
}

// ─── ActionType inference ────────────────────────────────────────────────────

function inferActionType(system) {
  const discipline = (system.discipline ?? "").toLowerCase();
  const rangeRaw = (system.range ?? "").toLowerCase().trim();
  const desc = (system.description?.value ?? "").toLowerCase();
  const save = mapSave(system.save);
  const damage = extractDamage(system.description?.value ?? "");
  const hasDamage = damage.length > 0;

  if (discipline === "taijutsu") return "mwak";

  if (/\bheal\b.*\bhit\s*point|\brestore.*\bhit\s*point/i.test(desc) && !hasDamage) return "heal";

  if (save) {
    return hasDamage ? "spellsave" : "save";
  }

  // Naruto d20 has no spell-attack concept: model touch/melee as a melee
  // weapon attack and ranged as a ranged weapon attack.
  if (/^touch$|^melee\s*touch|^melee\s*attack/i.test(rangeRaw)) return "mwak";

  if (/^close\b|^medium\b|^long\b/i.test(rangeRaw)) return hasDamage ? "rwak" : "other";

  return "other";
}

// ─── Main generation ─────────────────────────────────────────────────────────

function generateAction(system) {
  const actionType = inferActionType(system);
  const activation = mapActivation(system.activation);
  const range = mapRange(system.range);
  const duration = mapDuration(system.duration);
  const save = mapSave(system.save);
  const damage = extractDamage(system.description?.value ?? "");
  const template = extractTemplate(system.area);
  const isTaijutsu = (system.discipline ?? "").toLowerCase() === "taijutsu";
  const isTouch = range?.units === "touch";

  const action = {
    _id: randomId(16),
    name: "Use",
    actionType,
    activation,
  };

  if (duration) {
    action.duration = duration;
  }

  if (range) {
    action.range = range;
  }

  if (system.target) {
    action.target = { value: system.target };
  }

  if (system.area) {
    action.area = system.area;
  }

  if (template) {
    action.measureTemplate = template;
  }

  if (damage.length > 0) {
    action.damage = { parts: damage };
  }

  if (save) {
    action.save = save;
  }

  if (isTouch && actionType === "mwak") {
    action.touch = true;
  }

  // Weapon attacks roll on DEX to hit and STR for damage in Naruto d20.
  if (isTaijutsu || actionType === "mwak" || actionType === "rwak") {
    action.ability = { attack: "dex", damage: "str", critRange: 20, critMult: 2 };
  }

  return action;
}

// ─── Script entry point ───────────────────────────────────────────────────────

let total = 0,
  populated = 0,
  skipped = 0;

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

  const sys = doc.system ?? {};

  if (!FORCE && Array.isArray(sys.actions) && sys.actions.length > 0) {
    skipped++;
    continue;
  }

  const action = generateAction(sys);
  const actionType = action.actionType;

  // Only populate "other" actions when there is something useful (range, save, or damage)
  // Pure buffs with no details still get an "other" action for the Use button to work
  doc.system.actions = [action];

  if (DRY_RUN) {
    console.log(
      `[dry-run] ${doc.name} → actionType=${actionType}, damage=${action.damage?.parts?.map((p) => p.formula + (p.types[0] ? "/" + p.types[0] : "")).join(",") || "none"}, save=${action.save?.type ?? "none"}, range=${action.range?.units ?? "none"}`,
    );
  } else {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
  populated++;
}

console.log(`\nDone. ${total} techniques scanned.`);
console.log(`  ${populated} action(s) generated${DRY_RUN ? " (dry-run, not written)" : ""}.`);
console.log(`  ${skipped} skipped (already had actions).`);
