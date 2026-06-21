import { MAX_MASTERY_STEP, TECHNIQUE_ITEM_TYPE } from "../../core/constants.mjs";
import { isTechniqueEffectivelyLearned } from "./learn.mjs";

function techniqueItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  return Array.from(items).filter((item) => item?.type === TECHNIQUE_ITEM_TYPE);
}

/** Technique items the actor can still learn (not yet effectively learned). */
export function listLearnable(actor) {
  return techniqueItems(actor).filter((item) => !isTechniqueEffectivelyLearned(item));
}

/** Learned technique items still below the mastery cap. */
export function listMasterable(actor) {
  return techniqueItems(actor).filter(
    (item) =>
      isTechniqueEffectivelyLearned(item) &&
      (Number(item.system?.mastery ?? 0) || 0) < MAX_MASTERY_STEP,
  );
}
