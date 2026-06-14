import { MODULE_ID } from "../constants.mjs";
import { chakraPoolTempPath, chakraPoolValuePath } from "../flag-paths.mjs";
import { checkAndUpdateConditions } from "./chakra-conditions.mjs";

/**
 * Resolve Chakra Damage against an actor's pool. Damage is absorbed by temp
 * chakra first, then the pool (both floored at 0). Any portion the pool cannot
 * absorb is doubled and dealt as HP damage (per the Chakra Damage rule). The
 * reserve is never touched and the deliberate-spend "emergency transfer" never
 * fires — damage is not a spend. Pure: returns new values, writes nothing.
 *
 * @returns {{temp:number, pool:number, absorbed:number, hpOverflow:number}}
 */
export function calculateChakraDamage(actor, amount) {
  const dmg = Math.max(0, Number(amount) || 0);
  const chakra = actor?.flags?.[MODULE_ID]?.chakra ?? {};
  const tempValue = Math.max(0, Number(chakra.pool?.temp ?? 0) || 0);
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);

  const fromTemp = Math.min(dmg, tempValue);
  const fromPool = Math.min(dmg - fromTemp, poolValue);
  const absorbed = fromTemp + fromPool;
  const hpOverflow = (dmg - absorbed) * 2;

  return {
    temp: tempValue - fromTemp,
    pool: poolValue - fromPool,
    absorbed,
    hpOverflow,
  };
}

/**
 * Apply a resolved chakra-damage calculation to the actor: write the new
 * temp/pool, subtract any HP overflow, refresh chakra conditions, and post a
 * chat message. `before`/`after` are the pool totals for the flavor line.
 */
export async function commitChakraDamage(actor, technique, calc, amount) {
  if (!actor) return;

  const beforePool = Math.max(0, Number(actor.flags?.[MODULE_ID]?.chakra?.pool?.value ?? 0) || 0);

  const updates = {
    [chakraPoolTempPath]: calc.temp,
    [chakraPoolValuePath]: calc.pool,
  };
  if (calc.hpOverflow > 0) {
    const hp = Number(actor.system?.attributes?.hp?.value ?? 0) || 0;
    updates["system.attributes.hp.value"] = hp - calc.hpOverflow;
  }
  await actor.update(updates);
  await checkAndUpdateConditions(actor);

  let flavor = game.i18n.format("NarutoD20.Maintenance.ChakraDamageFlavor", {
    name: technique?.name ?? "",
    amount,
    before: beforePool,
    after: calc.pool,
  });
  if (calc.hpOverflow > 0) {
    flavor += game.i18n.format("NarutoD20.Maintenance.ChakraDamageOverflow", {
      hp: calc.hpOverflow,
    });
  }

  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${flavor}</p>`,
  });
}
