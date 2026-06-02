import { MODULE_ID } from "../constants.mjs";
import {
  learnBuffPath,
  chakraPoolMaxBonusPath,
  chakraReserveMaxBonusPath,
} from "../flag-paths.mjs";

const AFFINITY_DESCRIPTOR_ALIASES = {
  Earth: ["Earth"],
  Fire: ["Fire"],
  Lightning: ["Electric", "Lightning"],
  Water: ["Water"],
  Wind: ["Air", "Wind"],
};

const AFFINITY_SUBTYPE_ALIASES = {
  Earth: ["Doton", "Earth"],
  Fire: ["Katon", "Fire"],
  Lightning: ["Raiton", "Lightning"],
  Water: ["Suiton", "Water"],
  Wind: ["Fuuton", "Futon", "Wind"],
};

/**
 * Build the breakdown of a learn check for both the d20Roll parts array and
 * pf1's extended-tooltip sources list.
 *
 * Source-name discovery: pf1's changes engine populates
 * `actor.sourceInfo[flagPath].positive` with `{name, value}` entries — one per
 * change writing to that flag. We use those individual names when available
 * (so the chat card / tooltip shows "Iron Will Buff" instead of a generic
 * "Buff Bonus" line). Falls back to the lump-sum `data.buffBonus` if pf1's
 * sourceInfo is empty for the path.
 *
 * @param {Actor}  actor
 * @param {string} key   Learn discipline key (ckc | fui | gnj | nin | tai).
 * @param {object} [options]
 * @param {Item}   [options.item] Technique being learned. When provided,
 * conditional affinity bonuses can be resolved against its descriptors.
 * @param {boolean} [options.includeConditional=false]
 * @returns {{parts: string[], sources: object[]}|null}
 */
export function buildLearnCheckBreakdown(
  actor,
  key,
  { item = null, includeConditional = false } = {},
) {
  const data = actor.flags?.[MODULE_ID]?.learn?.[key];
  if (!data) return null;

  const parts = []; // labeled formula parts for pf1.dice.d20Roll
  const sources = []; // {name, value, builtIn} rows for extended-tooltip.hbs
  const characterLevelLabel = game.i18n.localize("NarutoD20.Breakdown.CharacterLevel");
  const buffBonusLabel = game.i18n.localize("NarutoD20.Breakdown.BuffBonus");
  const skillSynergyLabel = game.i18n.localize("NarutoD20.Breakdown.SkillSynergy");
  const miscBonusLabel = game.i18n.localize("NarutoD20.Breakdown.MiscBonus");

  parts.push(`${data.base}[${characterLevelLabel}]`);
  sources.push({ name: characterLevelLabel, value: data.base, builtIn: true });

  if (data.abilityMod) {
    parts.push(`${data.abilityMod}[${data.abilityLabel}]`);
    sources.push({ name: data.abilityLabel, value: data.abilityMod, builtIn: true });
  }

  const buffSources = actor.sourceInfo?.[learnBuffPath(key)]?.positive ?? [];
  if (buffSources.length > 0) {
    for (const src of buffSources) {
      parts.push(`${src.value}[${src.name}]`);
      sources.push({ name: src.name, value: src.value, builtIn: false });
    }
  } else if (data.buffBonus) {
    parts.push(`${data.buffBonus}[${buffBonusLabel}]`);
    sources.push({ name: buffBonusLabel, value: data.buffBonus, builtIn: false });
  }

  if (data.synergyBonus) {
    parts.push(`${data.synergyBonus}[${skillSynergyLabel}]`);
    sources.push({ name: skillSynergyLabel, value: data.synergyBonus, builtIn: true });
  }
  if (data.miscBonus) {
    parts.push(`${data.miscBonus}[${miscBonusLabel}]`);
    sources.push({ name: miscBonusLabel, value: data.miscBonus, builtIn: false });
  }

  const affinity = includeConditional ? resolveNinjutsuAffinityBonus(actor, key, item) : null;
  if (affinity) {
    parts.push(`${affinity.value}[${affinity.label}]`);
    sources.push({ name: affinity.label, value: affinity.value, builtIn: true });
  }

  return { parts, sources };
}

function resolveNinjutsuAffinityBonus(actor, key, item) {
  if (key !== "nin") return null;

  const bonus = Number(actor.flags?.[MODULE_ID]?.learn?.nin?.conditional ?? 0) || 0;
  if (!bonus) return null;

  const primary = String(actor.flags?.[MODULE_ID]?.chakra?.nature?.primary ?? "").trim();
  if (!primary) return null;

  if (item && !techniqueMatchesPrimaryAffinity(item, primary)) return null;

  return {
    value: bonus,
    label: game.i18n.format("NarutoD20.Breakdown.PrimaryAffinity", { affinity: primary }),
  };
}

function techniqueMatchesPrimaryAffinity(item, primary) {
  if (item.system?.discipline !== "Ninjutsu") return false;

  const descriptorAliases = AFFINITY_DESCRIPTOR_ALIASES[primary] ?? [primary];
  const descriptors = normalizeStringCollection(item.system?.descriptors);
  if (descriptorAliases.some((alias) => descriptors.has(alias.toLowerCase()))) return true;

  const subtype = String(item.system?.subtype ?? "")
    .trim()
    .toLowerCase();
  if (!subtype) return false;

  const subtypeAliases = AFFINITY_SUBTYPE_ALIASES[primary] ?? [primary];
  return subtypeAliases.some((alias) => subtype === alias.toLowerCase());
}

function normalizeStringCollection(value) {
  const values =
    value instanceof Set
      ? Array.from(value)
      : Array.isArray(value)
        ? value
        : Object.values(value ?? {});
  return new Set(
    values
      .map((v) =>
        String(v ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
}

/**
 * Build the "from sources" breakdown for Chakra Pool Max.
 * Used only for tooltips (no roll parts needed).
 *
 * Formula: 2 + ((2 + conMod) × charLevel) + maxBonus
 *
 * @param {Actor} actor
 * @returns {{ sources: object[] }|null}
 */
export function buildChakraPoolBreakdown(actor) {
  const nData = actor.flags?.[MODULE_ID]?.chakra?.pool;
  if (!nData) return null;

  const charLevel = actor.system.details?.level?.value || actor.system.details?.cr?.total || 0;
  const conMod = actor.system.abilities?.con?.mod || 0;

  const sources = [];

  // Base portion: 2 + (2 × Level)
  const base = 2 + 2 * charLevel;
  sources.push({
    name: game.i18n.localize("NarutoD20.Breakdown.ChakraPoolBase"),
    value: base,
    builtIn: true,
  });

  // Constitution contribution: conMod × Level (may be negative)
  const conContrib = conMod * charLevel;
  if (conContrib !== 0) {
    sources.push({
      name: game.i18n.localize("NarutoD20.Breakdown.ConTimesLevel"),
      value: conContrib,
      builtIn: true,
    });
  }

  // Buff bonuses — use named per-source entries when available
  const buffSources = actor.sourceInfo?.[chakraPoolMaxBonusPath]?.positive ?? [];
  if (buffSources.length > 0) {
    for (const src of buffSources) {
      sources.push({ name: src.name, value: src.value, builtIn: false });
    }
  } else if (nData.maxBonus) {
    sources.push({
      name: game.i18n.localize("NarutoD20.Breakdown.BuffBonus"),
      value: nData.maxBonus,
      builtIn: false,
    });
  }

  return { sources };
}

/**
 * Build the "from sources" breakdown for Chakra Reserve Max.
 * Used only for tooltips (no roll parts needed).
 *
 * Formula: (2 × charLevel) + maxBonus
 *
 * @param {Actor} actor
 * @returns {{ sources: object[] }|null}
 */
export function buildChakraReserveBreakdown(actor) {
  const nData = actor.flags?.[MODULE_ID]?.chakra?.reserve;
  if (!nData) return null;

  const charLevel = actor.system.details?.level?.value || actor.system.details?.cr?.total || 0;

  const sources = [];

  sources.push({
    name: game.i18n.localize("NarutoD20.Breakdown.TwoTimesLevel"),
    value: 2 * charLevel,
    builtIn: true,
  });

  const buffSources = actor.sourceInfo?.[chakraReserveMaxBonusPath]?.positive ?? [];
  if (buffSources.length > 0) {
    for (const src of buffSources) {
      sources.push({ name: src.name, value: src.value, builtIn: false });
    }
  } else if (nData.maxBonus) {
    sources.push({
      name: game.i18n.localize("NarutoD20.Breakdown.BuffBonus"),
      value: nData.maxBonus,
      builtIn: false,
    });
  }

  return { sources };
}
