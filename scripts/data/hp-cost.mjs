/**
 * Self-damage helper for techniques with an HP upkeep cost (e.g. the Amatsu no
 * Karada stance, which costs 1d4 HP each round). Rolls the formula, subtracts it
 * from the actor's current HP, and posts a short chat message as feedback.
 */
export async function applyHpCost(actor, formula) {
  if (!actor) return null;

  const roll = await RollPF.safeRoll(String(formula ?? "0"), actor.getRollData?.() ?? {});
  const amount = Math.max(0, Number(roll?.total) || 0);
  if (amount <= 0) return roll;

  const current = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
  await actor.update({ "system.attributes.hp.value": current - amount });

  await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format("NarutoD20.StanceBuff.HpCostFlavor", { amount }),
  });

  return roll;
}
