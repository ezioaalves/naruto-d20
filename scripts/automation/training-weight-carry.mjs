import { getIgnoredTrainingWeightTotal } from "../data/training-weights.mjs";

export function registerTrainingWeightCarryPatch() {
  const ActorPF = pf1?.documents?.actor?.ActorPF;
  if (!ActorPF) return;
  if (ActorPF.prototype.__nd20TrainingWeightCarryPatched) return;

  const original = ActorPF.prototype.getCarriedWeight;
  ActorPF.prototype.getCarriedWeight = function patchedGetCarriedWeight(...args) {
    const total = original.apply(this, args);
    const ignoredRaw = getIgnoredTrainingWeightTotal(this);
    const ignored = pf1.utils.convertWeight(ignoredRaw);
    return Math.max(0, total - ignored);
  };

  Object.defineProperty(ActorPF.prototype, "__nd20TrainingWeightCarryPatched", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}
