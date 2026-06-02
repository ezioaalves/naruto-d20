/**
 * Cascade-delete items that were auto-granted via system.links.supplements when
 * their parent feat is removed from an actor.
 *
 * PF1's _createSupplements stamps `flags.pf1.source = <compendiumUuid>` on each
 * granted item, where the UUID matches the entry in the parent's supplements list.
 * On feat deletion we look up those same UUIDs and remove the matching embedded
 * items from the actor.
 *
 * Only applies to feats that have supplements listed — silent no-op otherwise.
 */
export function registerFeatGrantDeletion() {
  Hooks.on("preDeleteItem", (item) => {
    if (item.type !== "feat") return;
    const actor = item.actor;
    if (!actor) return;

    const supplements = item.system?.links?.supplements;
    if (!Array.isArray(supplements) || !supplements.length) return;

    // Build a set of the compendium UUIDs for each supplement entry.
    const supplementUuids = new Set(supplements.map((s) => s.uuid).filter(Boolean));
    if (!supplementUuids.size) return;

    // Find embedded items whose pf1.source flag matches one of those UUIDs.
    const toDelete = actor.items
      .filter((i) => {
        const src = i.getFlag?.("pf1", "source");
        return src && supplementUuids.has(src);
      })
      .map((i) => i.id);

    if (!toDelete.length) return;

    // Defer so this hook's synchronous call stack completes first.
    actor.deleteEmbeddedDocuments("Item", toDelete, { render: false });
  });
}
