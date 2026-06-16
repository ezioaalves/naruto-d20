import { getIgnoredTrainingWeightTotal } from "../data/training-weights.mjs";

let _patched = false;

export function registerTrainingWeightCarryPatch() {
  const pf1Api = globalThis.pf1;
  const ActorPF = pf1Api?.documents?.actor?.ActorPF;
  if (!ActorPF) {
    console.error("Naruto D20 | ActorPF not found — training weight carry patch skipped");
    return;
  }
  if (_patched) return;

  if (!ActorPF.prototype.getCarriedWeight) {
    console.error("Naruto D20 | ActorPF.getCarriedWeight not found — training weight carry patch skipped");
    return;
  }

  const original = ActorPF.prototype.getCarriedWeight;
  ActorPF.prototype.getCarriedWeight = function patchedGetCarriedWeight(...args) {
    const total = original.apply(this, args);
    const ignoredRaw = getIgnoredTrainingWeightTotal(this);
    const ignored = pf1Api?.utils?.convertWeight?.(ignoredRaw) ?? ignoredRaw;
    return Math.max(0, total - ignored);
  };

  _patched = true;
}
