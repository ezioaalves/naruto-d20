/**
 * Naruto D20 — Legacy weapon-attack migration (dependency-free).
 *
 * Single source of truth for converting the old
 * `system.flags.dictionary` weaponAttack data (dotted `weaponAttack.<k>` keys
 * or a nested `weaponAttack:{}` object) into the typed `system.weaponAttack`
 * shape. Imported by model.migrateData, sync.normalizeSystem, the GM actor
 * migration, the offline compendium script, and the unit tests — so it MUST
 * NOT import any Foundry/pf1 globals.
 */

import {
  legacyFormulaToDamageParts,
  normalizeDamagePartRows,
} from "./weapon-attack-damage-parts.mjs";

const FILTERS = new Set(["meleeWeapon", "rangedWeapon", "unarmedOnly", "meleeOrUnarmed"]);
const DAMAGE_MODES = new Set(["add", "replace"]);
const HELD = new Set(["", "onehanded", "twohanded"]);

/** True when a technique system still carries legacy dictionary weaponAttack data. */
export function hasLegacyWeaponAttack(system) {
  const dict = system?.flags?.dictionary;
  if (!dict || typeof dict !== "object") return false;
  return Object.keys(dict).some((k) => k === "weaponAttack" || k.startsWith("weaponAttack."));
}

function readLegacyValues(dict) {
  const values = {};
  for (const key of Object.keys(dict)) {
    if (key.startsWith("weaponAttack.")) values[key.slice("weaponAttack.".length)] = dict[key];
  }
  const nested =
    dict.weaponAttack && typeof dict.weaponAttack === "object" ? dict.weaponAttack : null;
  if (nested) for (const k of Object.keys(nested)) values[k] = nested[k]; // nested wins
  return values;
}

function parseExtraAttacks(raw) {
  return String(raw ?? "")
    .split(";")
    .map((entry) => {
      const [formula, name] = entry.split("|").map((s) => s.trim());
      return { formula: formula ?? "", name: name ?? "" };
    })
    .filter((e) => e.formula);
}

/**
 * Mutate `source` in place: build typed `source.weaponAttack` from legacy
 * dictionary keys and strip those keys. Also normalizes any typed
 * `source.weaponAttack` that still carries legacy string damage fields.
 * No-op when no legacy keys or legacy damage fields are present.
 * Returns `source`.
 */
export function migrateLegacyWeaponAttack(source) {
  if (!source || typeof source !== "object") return source;

  const hasLegacyDict = hasLegacyWeaponAttack(source);
  const wa0 = source.weaponAttack;
  const hasLegacyDamageStrings =
    wa0 && typeof wa0 === "object" && ("damageBonus" in wa0 || "nonCritDamageBonus" in wa0);

  if (!hasLegacyDict && !hasLegacyDamageStrings) return source;

  if (hasLegacyDict) {
    const dict = source.flags.dictionary;
    const alreadyTyped =
      source.weaponAttack &&
      typeof source.weaponAttack === "object" &&
      source.weaponAttack.enabled !== undefined;

    if (!alreadyTyped) {
      const values = readLegacyValues(dict);
      const str = (k) => String(values[k] ?? "").trim();
      const suppressions = str("suppressedBonuses")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      source.weaponAttack = {
        enabled: str("mode") === "selected",
        filter: FILTERS.has(str("filter")) ? str("filter") : "meleeWeapon",
        damageMode: DAMAGE_MODES.has(str("damageMode")) ? str("damageMode") : "add",
        held: HELD.has(str("held")) ? str("held") : "",
        charge: str("charge").toLowerCase() === "true",
        iteratives: str("iteratives").toLowerCase() !== "false",
        attackBonus: str("attackBonus"),
        damageParts: legacyFormulaToDamageParts(values.damageBonus),
        nonCritDamageParts: legacyFormulaToDamageParts(values.nonCritDamageBonus),
        extraAttacks: parseExtraAttacks(values.extraAttacks),
        suppressNaturalAttack: suppressions.includes("naturalAttack"),
        suppressAbilityDamage: suppressions.includes("abilityDamage"),
      };
    }

    for (const key of Object.keys(dict)) {
      if (key === "weaponAttack" || key.startsWith("weaponAttack.")) delete dict[key];
    }
  }

  const wa = source.weaponAttack;
  if (wa && typeof wa === "object") {
    wa.damageParts = normalizeDamagePartRows(
      wa.damageParts?.length ? wa.damageParts : legacyFormulaToDamageParts(wa.damageBonus),
    );
    wa.nonCritDamageParts = normalizeDamagePartRows(
      wa.nonCritDamageParts?.length
        ? wa.nonCritDamageParts
        : legacyFormulaToDamageParts(wa.nonCritDamageBonus),
    );
    delete wa.damageBonus;
    delete wa.nonCritDamageBonus;
  }

  return source;
}
