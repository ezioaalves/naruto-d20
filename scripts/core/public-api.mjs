import { TECHNIQUE_ITEM_TYPE } from "./constants.mjs";
import {
  attemptLearnTechnique,
  buildLearningView,
  isTechniqueEffectivelyLearned,
} from "../features/techniques/learn.mjs";
import { attemptMasterTechnique, buildMasteryView } from "../features/techniques/master.mjs";
import { listLearnable, listMasterable } from "../features/techniques/queries.mjs";

/**
 * The stable public API other modules (e.g. naruto-d20-kaihou) may use.
 * Keep this surface small and additive; do not break existing keys.
 */
export function buildPublicApi() {
  return Object.freeze({
    attemptLearnTechnique,
    attemptMasterTechnique,
    buildLearningView,
    buildMasteryView,
    isTechniqueEffectivelyLearned,
    listLearnable,
    listMasterable,
    TECHNIQUE_ITEM_TYPE,
  });
}
