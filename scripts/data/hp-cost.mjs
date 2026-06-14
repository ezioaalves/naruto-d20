/**
 * Self-damage helper for techniques with an HP upkeep cost (e.g. the Amatsu no
 * Karada stance, which costs 1d4 HP each round). Rolls the formula, subtracts it
 * from the actor's current HP, and posts a short chat message as feedback.
 */
export async function applyHpCost(actor, formula, rollData = null) {
  if (!actor) return null;
  const { roll, amount } = await rollHpCost(actor, formula, rollData);
  return commitHpCost(actor, roll, amount);
}

/**
 * Roll the HP-cost formula without applying it. Split from the commit so callers
 * (e.g. the forced Kai-Mon upkeep) can roll, check a lethal guard, and only then
 * subtract the HP. Returns the roll and its clamped (>= 0) amount.
 */
export async function rollHpCost(actor, formula, rollData = null) {
  const roll = await RollPF.safeRoll(String(formula ?? "0"), rollData ?? (actor?.getRollData?.() ?? {}));
  return { roll, amount: Math.max(0, Number(roll?.total) || 0) };
}

/** Subtract a pre-rolled HP cost from the actor and post the upkeep chat message. */
export async function commitHpCost(actor, roll, amount) {
  if (!actor || amount <= 0) return roll;

  const current = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
  await actor.update({ "system.attributes.hp.value": current - amount });

  await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format("NarutoD20.Maintenance.HpCostFlavor", { amount }),
  });

  return roll;
}
