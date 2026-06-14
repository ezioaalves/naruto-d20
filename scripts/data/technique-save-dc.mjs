import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";
import { DISCIPLINE_SKILL_MAP, resolveSkillAbility } from "./skills.mjs";

const PATCH_KEY = Symbol.for("naruto-d20.techniqueDCPatched");
const techniqueDCContexts = new WeakMap();

export function setTechniqueSaveDCContext(action, item, sourceAction) {
  if (!action) return () => {};

  const previous = techniqueDCContexts.get(action);
  techniqueDCContexts.set(action, { item, sourceAction });

  return () => {
    if (previous) techniqueDCContexts.set(action, previous);
    else techniqueDCContexts.delete(action);
  };
}

export function installTechniqueSaveDCPatch() {
  const proto = pf1.components.ItemAction?.prototype;
  if (!proto || proto[PATCH_KEY]) return;

  const _original = proto.getDC;

  proto.getDC = function (...args) {
    const context = techniqueDCContexts.get(this);
    const item = context?.item ?? this.item;
    const sourceAction = context?.sourceAction ?? this;
    if (item?.type !== TECHNIQUE_ITEM_TYPE) return _original.apply(this, args);

    const rank = item.system.rank ?? 0;
    const skillKey = DISCIPLINE_SKILL_MAP[item.system.discipline];
    const ability = resolveSkillAbility(item.actor, skillKey);
    const ablMod = item.actor?.system.abilities?.[ability]?.mod ?? 0;

    const rollData = args[0] ?? item.actor?.getRollData?.() ?? {};
    const offset = RollPF.safeRollSync(sourceAction.save?.dc?.toString() || "0", rollData).total;
    const dcBonus = rollData.dcBonus ?? 0;

    // Buff-driven DC: global ("all") + per-discipline (mirror of pf1's spell DC).
    const tdc = item.actor?.flags?.[MODULE_ID]?.techniqueDC ?? {};
    const globalDC = Number(tdc.all?.buffBonus) || 0;
    const typeDC = skillKey ? Number(tdc[skillKey]?.buffBonus) || 0 : 0;

    return 10 + rank + ablMod + offset + dcBonus + globalDC + typeDC;
  };

  proto[PATCH_KEY] = true;
}
