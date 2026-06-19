/**
 * Shared helpers for granting compendium items to actors (occupations and any
 * future grant feature). Only the body of each async/Foundry function touches
 * Foundry globals, so the pure helpers here are unit-testable under node:test.
 */

export const FEAT_PACK_IDS = ["naruto-d20.feats", "pf1.feats"];
export const TECHNIQUE_PACK_IDS = ["naruto-d20.techniques"];

export function normalizeItemName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findBestIndexMatch(index, targetName, type) {
  const target = normalizeItemName(targetName);
  if (!target) return null;

  const candidates = [...index].filter((entry) => {
    if (!type) return true;
    return entry.type === type || String(entry.type ?? "").endsWith(`.${type}`);
  });

  return (
    candidates.find((entry) => normalizeItemName(entry.name) === target) ??
    candidates.find((entry) => normalizeItemName(entry.name).includes(target)) ??
    candidates.find((entry) => {
      const candidate = normalizeItemName(entry.name);
      return candidate && target.includes(candidate);
    })
  );
}

export async function findCompendiumItemByName(name, packIds, type = null) {
  for (const packId of packIds) {
    const pack = game.packs.get(packId);
    if (!pack) continue;

    const index = await pack.getIndex({ fields: ["name", "type", "img"] });
    const entry = findBestIndexMatch(index, name, type);
    if (!entry) continue;

    return pack.getDocument(entry._id);
  }

  return null;
}

export function buildEmbeddedGrantData(doc, flagPath, flagData) {
  const itemData = doc.toObject();
  delete itemData._id;
  foundry.utils.setProperty(itemData, "flags.core.sourceId", doc.uuid);
  foundry.utils.setProperty(itemData, flagPath, { ...flagData, sourceUuid: doc.uuid });
  return itemData;
}

export function linkRowFromDocument(doc) {
  return {
    _id: foundry.utils.randomID(8),
    uuid: doc.uuid,
    name: doc.name,
    img: doc.img ?? "",
  };
}
