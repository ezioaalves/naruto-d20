import { MODULE_ID } from "../constants.mjs";

export const STANCE_BUFF_FLAG = "stanceBuff";
export const STANCE_BUFF_FLAG_PATH = `flags.${MODULE_ID}.${STANCE_BUFF_FLAG}`;

/**
 * Mode-choice stances (Champuru) let the user pick, at the start of each turn,
 * which mode to fight in. Each mode maps to a same-named buff variant in the
 * technique-buffs compendium: "<technique name> (Dexterity|Strength)".
 */
export const STANCE_MODES = [
  { id: "dex", suffix: "Dexterity", labelKey: "NarutoD20.StanceBuff.Dexterity" },
  { id: "str", suffix: "Strength", labelKey: "NarutoD20.StanceBuff.Strength" },
];

/**
 * Selectable damage elements for element-selection stances (Amatsu no Karada).
 * Ids are the bare PF1e damage-type keys — core `cold`/`electric`/`fire` plus the
 * module-registered `earth`/`water`/`wind` (registered bare, NOT namespaced).
 */
export const STANCE_ELEMENTS = [
  { id: "cold", labelKey: "NarutoD20.StanceElement.Cold" },
  { id: "earth", labelKey: "NarutoD20.StanceElement.Earth" },
  { id: "electric", labelKey: "NarutoD20.StanceElement.Electric" },
  { id: "fire", labelKey: "NarutoD20.StanceElement.Fire" },
  { id: "water", labelKey: "NarutoD20.StanceElement.Water" },
  { id: "wind", labelKey: "NarutoD20.StanceElement.Wind" },
];

export const STANCE_ELEMENT_IDS = STANCE_ELEMENTS.map((e) => e.id);

export function stanceModeById(id) {
  return STANCE_MODES.find((mode) => mode.id === id) ?? null;
}

export function isModeChoiceStance(item) {
  return item?.system?.automation?.stanceMode === true;
}

export function isUpkeepStance(item) {
  return item?.system?.automation?.stanceUpkeep === true;
}

export function isElementStance(item) {
  return item?.system?.automation?.elementChoice === true;
}

export function stanceBuffName(item, mode) {
  const resolved = typeof mode === "string" ? stanceModeById(mode) : mode;
  if (!resolved) return null;
  return `${item.name} (${resolved.suffix})`;
}

export function stanceBuffDuration() {
  return {
    units: "round",
    value: "1",
    end: "turnStart",
    start: game.time.worldTime,
  };
}

/**
 * Build the stanceBuff flag payload. Two discriminated kinds:
 * - mode  (Champuru): `{ sourceTechniqueId, kind:"mode", modeId }`
 * - upkeep (Amatsu):  `{ sourceTechniqueId, kind:"upkeep", elements:[ids] }`
 */
export function stanceBuffFlagData({ sourceTechniqueId, modeId, elements }) {
  if (Array.isArray(elements)) {
    return { sourceTechniqueId: sourceTechniqueId ?? null, kind: "upkeep", elements };
  }
  return { sourceTechniqueId: sourceTechniqueId ?? null, kind: "mode", modeId };
}

/**
 * Resolve a flag's kind. A flag predating the discriminator (only `modeId`) is a
 * mode stance for back-compat.
 */
export function stanceBuffKind(flag) {
  if (!flag) return null;
  if (flag.kind === "upkeep" && Array.isArray(flag.elements)) return "upkeep";
  if (flag.kind === "mode" || stanceModeById(flag.modeId)) return "mode";
  return null;
}

export function getStanceBuffFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[STANCE_BUFF_FLAG] ?? null;
  if (!flag || !stanceBuffKind(flag)) return null;
  return flag;
}

export function isStanceBuffItem(item) {
  return Boolean(getStanceBuffFlag(item));
}

/**
 * Find the active stance buff this technique placed on the actor, if any.
 * Identity is the source technique id stored on the stanceBuff flag.
 */
export function findStanceBuffForTechnique(actor, techniqueId) {
  if (!actor || !techniqueId) return null;
  return (
    actor.items.find((item) => getStanceBuffFlag(item)?.sourceTechniqueId === techniqueId) ?? null
  );
}
