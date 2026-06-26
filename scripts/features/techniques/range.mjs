import { TECHNIQUE_ITEM_TYPE } from "../../core/constants.mjs";

const PATCH_KEY = Symbol.for("naruto-d20.techniqueRangePatched");
const TECHNIQUE_RANGE_UNITS = new Set(["close", "medium", "long"]);

export function calculateNarutoTechniqueRange(rangeUnit, rollData = {}) {
  const cl = Number.isFinite(Number(rollData?.cl)) ? Number(rollData.cl) : 0;

  switch (rangeUnit) {
    case "close":
      return 10 + Math.floor(cl / 2) * 5;
    case "medium":
      return 20 + Math.floor(cl / 2) * 10;
    case "long":
      return 30 + Math.floor(cl / 2) * 15;
    default:
      return null;
  }
}

export function installTechniqueRangePatch() {
  const proto = pf1.components.ItemAction?.prototype;
  if (!proto || proto[PATCH_KEY]) return;

  const original = proto.getRange;

  proto.getRange = function ({ type = "single", rollData = null } = {}) {
    const rangeUnit = this.range?.units;
    if (this.item?.type !== TECHNIQUE_ITEM_TYPE || !TECHNIQUE_RANGE_UNITS.has(rangeUnit)) {
      return original.call(this, { type, rollData });
    }

    if (type === "min") return 0;

    const resolvedRollData = rollData ?? this.getRollData();
    const range = calculateNarutoTechniqueRange(rangeUnit, resolvedRollData);
    if (range == null) return original.call(this, { type, rollData: resolvedRollData });
    if (type === "single") return range;

    return range * (Number(this.range?.maxIncrements) || 1);
  };

  proto[PATCH_KEY] = true;
}
