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

export function stanceModeById(id) {
  return STANCE_MODES.find((mode) => mode.id === id) ?? null;
}

export function isModeChoiceStance(item) {
  return item?.system?.automation?.stanceMode === true;
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

export function stanceBuffFlagData({ sourceTechniqueId, modeId }) {
  return { sourceTechniqueId: sourceTechniqueId ?? null, modeId };
}

export function getStanceBuffFlag(item) {
  const flag = item?.flags?.[MODULE_ID]?.[STANCE_BUFF_FLAG] ?? null;
  if (!flag || !stanceModeById(flag.modeId)) return null;
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
