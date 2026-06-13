import {
  ELEMENTS,
  ELEMENT_IDS,
  findMaintenanceBuffForTechnique,
  getMaintenanceBuffFlag,
} from "./maintenance-buffs.mjs";

/**
 * Maintenance techniques with element selection let the caster pick the damage
 * element(s) for the technique's attack. The choice is injected into the action's
 * damage parts at roll time so the stored action data is never mutated.
 *
 * On entry the buff does not exist yet when the first attack rolls, so the chosen
 * elements are stashed in `pendingCastElements` for the duration of that cast; on
 * later turns the elements are read back from the active maintenance buff's flag.
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

export function getActiveElements(actor, item) {
  const buff = findMaintenanceBuffForTechnique(actor, item.id);
  const flagElements = getMaintenanceBuffFlag(buff)?.elements;
  if (Array.isArray(flagElements) && flagElements.length) return flagElements;
  return pendingCastElements.get(castKey(actor, item)) ?? null;
}

export function promptElements(item, count = 1) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const optionRows = ELEMENTS.map(
      (e) => `<option value="${e.id}">${game.i18n.localize(e.labelKey)}</option>`,
    ).join("");
    const selects = Array.from(
      { length: count },
      (_, i) =>
        `<div class="form-group">
          <label>${game.i18n.format("NarutoD20.MaintenanceElement.SlotLabel", { n: i + 1 })}</label>
          <select name="maintenance-element-${i}">${optionRows}</select>
        </div>`,
    ).join("");

    new Dialog({
      title: game.i18n.format("NarutoD20.MaintenanceElement.Title", { name: item.name }),
      content: `<p>${game.i18n.localize("NarutoD20.MaintenanceElement.Prompt")}</p>${selects}`,
      buttons: {
        confirm: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("NarutoD20.Common.Confirm"),
          callback: (html) => {
            const root = html[0] ?? html;
            const elements = Array.from({ length: count }, (_, i) => {
              const val = root.querySelector(`select[name="maintenance-element-${i}"]`)?.value;
              return ELEMENT_IDS.includes(val) ? val : ELEMENT_IDS[0];
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

export function elementCount(item) {
  const m = item?.system?.automation?.maintenance ?? {};
  if (!m.element) return 0;
  const mastery = Number(item?.system?.mastery ?? 0) || 0;
  const step = Number(m.elementDoubleStep ?? 5) || 0;
  return step > 0 && mastery >= step ? 2 : 1;
}

export function registerElementDamage() {
  Hooks.on("pf1PreDamageRoll", (action, _rollData, parts) => {
    const item = action?.item;
    const maintenance = item?.system?.automation?.maintenance;
    if (!maintenance?.enabled || !maintenance.element) return;

    const actor = item.actor;
    if (!actor) return;

    const elements = getActiveElements(actor, item);
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
