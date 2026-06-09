import { getRankBuffFlag, isRankBuffItem } from "./rank-buffs.mjs";

const IMMOBILIZING_CONDITIONS = ["helpless", "paralyzed", "immobilized", "grappled", "pinned"];

export function registerSpeedRankPenalties() {
  // Conditions in PF1e are ActiveEffects — updateActor does NOT fire for them
  Hooks.on("createActiveEffect", (effect, _o, userId) =>
    _onEffectChanged(effect, userId),
  );
  Hooks.on("deleteActiveEffect", (effect, _o, userId) =>
    _onEffectChanged(effect, userId),
  );
  // Armor equip/unequip fires updateItem; buff creation fires createItem
  Hooks.on("updateItem", (item, _c, _o, userId) =>
    _onActorItemChanged(item.actor, userId),
  );
  Hooks.on("createItem", (item, _o, userId) =>
    _onActorItemChanged(item.actor, userId),
  );
}

async function _onEffectChanged(effect, userId) {
  if (game.user.id !== userId) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  await _syncSpeedRankLevel(actor);
}

async function _onActorItemChanged(actor, userId) {
  if (game.user.id !== userId) return;
  await _syncSpeedRankLevel(actor);
}

async function _syncSpeedRankLevel(actor) {
  if (!actor?.isOwner) return;
  if (!["character", "npc"].includes(actor.type)) return;

  const speedBuff = actor.items.find(
    (item) => isRankBuffItem(item) && getRankBuffFlag(item)?.key === "KOUSOKU",
  );
  if (!speedBuff?.system?.active) return;

  const flag = getRankBuffFlag(speedBuff);
  const baseLevel = flag?.level ?? speedBuff.system.level;
  const effectiveLevel = _computeEffectiveLevel(actor, baseLevel);

  if (speedBuff.system.level !== effectiveLevel) {
    await speedBuff.update({ "system.level": effectiveLevel });
  }
}

function _computeEffectiveLevel(actor, baseLevel) {
  for (const cond of IMMOBILIZING_CONDITIONS) {
    if (actor.statuses?.has(cond)) return 0;
  }
  return Math.max(0, baseLevel - _armorPenalty(actor));
}

function _armorPenalty(actor) {
  // PF1e armor items have type:"equipment", subType:"armor", and weight in equipmentSubtype
  const equipment = actor.itemTypes?.equipment ?? actor.items.filter((i) => i.type === "equipment");
  for (const item of equipment) {
    if (!item.system?.equipped) continue;
    if (item.system?.subType !== "armor") continue;
    const sub = item.system?.equipmentSubtype;
    if (sub === "heavyArmor") return 3;
    if (sub === "mediumArmor") return 1;
  }
  return 0;
}
