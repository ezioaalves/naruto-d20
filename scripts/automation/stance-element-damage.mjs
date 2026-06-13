import {
  STANCE_ELEMENTS,
  STANCE_ELEMENT_IDS,
  findStanceBuffForTechnique,
  getStanceBuffFlag,
  isElementStance,
} from "./stance-buffs.mjs";

/**
 * Element-selection stances (Amatsu no Karada) let the caster pick the damage
 * element(s) of the technique's attack. The choice is injected into the action's
 * damage parts at roll time via the `pf1PreDamageRoll` hook, so the stored action
 * data is never mutated.
 *
 * On entry the buff does not exist yet when the first attack rolls, so the chosen
 * elements are stashed in `pendingCastElements` for the duration of that cast; on
 * later turns the elements are read back from the active stance buff's flag.
 */
const pendingCastElements = new Map();

function castKey(actor, item) {
  return `${actor?.id}:${item?.id}`;
}

export function setPendingCastElements(actor, item, elements) {
  pendingCastElements.set(castKey(actor, item), elements ?? []);
}

export function clearPendingCastElements(actor, item) {
  pendingCastElements.delete(castKey(actor, item));
}

/**
 * Resolve the active elements for an element stance: the live stance buff's stored
 * elements take priority (later turns), falling back to the pending cast (entry turn).
 */
export function getActiveStanceElements(actor, item) {
  const buff = findStanceBuffForTechnique(actor, item.id);
  const flagElements = getStanceBuffFlag(buff)?.elements;
  if (Array.isArray(flagElements) && flagElements.length) return flagElements;
  return pendingCastElements.get(castKey(actor, item)) ?? null;
}

/**
 * Prompt the caster to pick `count` damage element(s). Duplicates are allowed (a
 * step-5 master may pick the same element twice). Resolves to an array of element
 * ids, or null if cancelled.
 */
export function promptStanceElements(item, count = 1) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const optionRows = STANCE_ELEMENTS.map(
      (e) => `<option value="${e.id}">${game.i18n.localize(e.labelKey)}</option>`,
    ).join("");
    const selects = Array.from(
      { length: count },
      (_, i) =>
        `<div class="form-group">
          <label>${game.i18n.format("NarutoD20.StanceElement.SlotLabel", { n: i + 1 })}</label>
          <select name="stance-element-${i}">${optionRows}</select>
        </div>`,
    ).join("");

    new Dialog({
      title: game.i18n.format("NarutoD20.StanceElement.Title", { name: item.name }),
      content: `<p>${game.i18n.localize("NarutoD20.StanceElement.Prompt")}</p>${selects}`,
      buttons: {
        confirm: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("NarutoD20.Common.Confirm"),
          callback: (html) => {
            const root = html[0] ?? html;
            const elements = Array.from({ length: count }, (_, i) => {
              const val = root.querySelector(`select[name="stance-element-${i}"]`)?.value;
              return STANCE_ELEMENT_IDS.includes(val) ? val : STANCE_ELEMENT_IDS[0];
            });
            done(elements);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("NarutoD20.Common.Cancel"),
          callback: () => done(null),
        },
      },
      default: "confirm",
      close: () => done(null),
    }).render(true);
  });
}

/**
 * How many elements an element stance picks: two (duplicates allowed) once the
 * technique reaches its `elementDoubleStep` mastery, otherwise one.
 */
export function stanceElementCount(item) {
  const step = Number(item.system?.automation?.elementDoubleStep ?? 5) || 5;
  const mastery = Number(item.system?.mastery ?? 0) || 0;
  return mastery >= step ? 2 : 1;
}

/**
 * Register the damage-roll hook that stamps the chosen element(s) onto an element
 * stance's attack. The action's first damage part is the elemental 2d6:
 * - one element  → type that part with the element (base stays 2d6).
 * - two elements → split into 1d6 (elA) + 1d6 (elB).
 */
export function registerStanceElementDamage() {
  Hooks.on("pf1PreDamageRoll", (action, _rollData, parts) => {
    const item = action?.item;
    if (!item || !isElementStance(item)) return;

    const actor = item.actor;
    if (!actor) return;

    const elements = getActiveStanceElements(actor, item);
    if (!Array.isArray(elements) || !elements.length) return;

    const part = parts?.[0];
    if (!part) return;

    if (elements.length >= 2) {
      part.base = "1d6";
      part.damageType = [elements[0]];
      parts.push({ base: "1d6", extra: [], damageType: [elements[1]], type: part.type });
    } else {
      part.damageType = [elements[0]];
    }
  });
}
