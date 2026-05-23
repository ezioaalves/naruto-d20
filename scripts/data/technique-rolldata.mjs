import { TECHNIQUE_ITEM_TYPE } from "../constants.mjs";

const PATCH_KEY = Symbol.for("naruto-d20.techniqueRollDataPatched");

/**
 * Inject `cl` into a technique action's rollData so action formulas using
 * `@cl` (duration, range, damage, …) resolve. Techniques have no caster level,
 * so cl = character level + the mastery "Level" offset (acts like a spell's
 * caster level offset). Mirrors installTechniqueSaveDCPatch.
 */
export function installTechniqueRollDataPatch() {
    const proto = pf1.components.ItemAction?.prototype;
    if (!proto || proto[PATCH_KEY]) return;

    const _original = proto.getRollData;

    proto.getRollData = function (...args) {
        const rd = _original.apply(this, args);
        if (this.item?.type === TECHNIQUE_ITEM_TYPE) {
            const actor = this.item.actor;
            const charLevel = actor?.system?.details?.level?.value
                ?? actor?.system?.attributes?.hd?.total
                ?? 0;
            const offset = this.item.system?.derived?.masteryLevel ?? 0;
            rd.cl = charLevel + offset;
        }
        return rd;
    };

    proto[PATCH_KEY] = true;
}
