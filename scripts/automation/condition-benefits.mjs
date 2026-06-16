export async function applyConditionBenefits(actor, facets) {
  if (!facets?.clearConditions?.length) return;

  const payload = {};
  for (const id of facets.clearConditions) payload[id] = false;
  await actor.setConditions(payload);
}
