import { MODULE_ID } from "../../core/constants.mjs";
import {
  chakraPoolTempPath,
  chakraPoolValuePath,
  chakraReserveValuePath,
} from "../../core/flag-paths.mjs";
import { checkAndUpdateConditions } from "./conditions.mjs";

export function allocateTemporaryChakraGrantSpend(items, amount) {
  let remaining = Math.max(0, Number(amount) || 0);
  const updates = [];

  for (const item of items ?? []) {
    if (remaining <= 0) break;
    const grant = Math.max(
      0,
      Number(item?.flags?.[MODULE_ID]?.temporaryChakra?.remaining ?? 0) || 0,
    );
    if (grant <= 0) continue;

    const spent = Math.min(remaining, grant);
    updates.push({
      _id: item.id,
      [`flags.${MODULE_ID}.temporaryChakra.remaining`]: grant - spent,
    });
    remaining -= spent;
  }

  return { updates, remaining };
}

export function availableChakra(actor) {
  const chakra = actor?.flags?.[MODULE_ID]?.chakra ?? {};
  const tempValue = Math.max(0, Number(chakra.pool?.temp ?? 0) || 0);
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);
  return tempValue + poolValue;
}

export function canPayChakra(actor, amount) {
  const cost = Math.max(0, Number(amount) || 0);
  return cost <= 0 || availableChakra(actor) >= cost;
}

export function calculateChakraSpend(actor, cost) {
  const amount = Math.max(0, Number(cost) || 0);

  // Deduct chakra: temp first, then pool. Reserve never pays a technique's
  // cost directly; it only participates via the Emergency Transfer rule below.
  const chakra = actor.flags[MODULE_ID]?.chakra ?? {};
  const tempValue = Math.max(0, Number(chakra.pool?.temp ?? 0) || 0);
  const poolValue = Math.max(0, Number(chakra.pool?.value ?? 0) || 0);
  const reserveValue = Math.max(0, Number(chakra.reserve?.value ?? 0) || 0);
  const fromTemp = Math.min(amount, tempValue);
  const remaining = amount - fromTemp;
  const fromPool = Math.min(remaining, poolValue);

  let newPool = poolValue - fromPool;
  let newReserve = reserveValue;

  // Emergency Transfer: if pool hits 0 but reserve still has chakra, the body
  // automatically burns the entire reserve to return 1 chakra to the pool
  // after the normal temp+pool spend resolves. This guarantees pool == 0 only
  // when reserve == 0 (which triggers Chakra Depletion).
  if (newPool <= 0 && newReserve > 0) {
    newPool = 1;
    newReserve = 0;
  }

  const spendParts = [];
  if (fromTemp > 0) spendParts.push(`${fromTemp} temp`);
  if (fromPool > 0) spendParts.push(`${fromPool} pool`);

  return {
    temp: tempValue - fromTemp,
    pool: newPool,
    reserve: newReserve,
    fromTemp,
    fromPool,
    summary: spendParts.join(", ") || "0",
  };
}

export async function applyChakraSpend(actor, spend) {
  await actor.update({
    [chakraPoolTempPath]: spend.temp,
    [chakraPoolValuePath]: spend.pool,
    [chakraReserveValuePath]: spend.reserve,
  });

  const grantSpend = allocateTemporaryChakraGrantSpend(actor.items, spend.fromTemp);
  if (grantSpend.updates.length && actor.updateEmbeddedDocuments) {
    await actor.updateEmbeddedDocuments("Item", grantSpend.updates);
  }

  await checkAndUpdateConditions(actor);
}

export async function payChakra(actor, amount) {
  if (!canPayChakra(actor, amount)) {
    return { paid: false, spend: null };
  }

  const spend = calculateChakraSpend(actor, amount);
  await applyChakraSpend(actor, spend);
  return { paid: true, spend };
}
