import { MODULE_ID, TECHNIQUE_ITEM_TYPE } from "../constants.mjs";
import { normalizeActionIds } from "../data/action-ids.mjs";
import { applyTechniqueSystemDefaults } from "../data/technique-defaults.mjs";

/**
 * Technique synckit core — detection & sync (no UI).
 *
 * Techniques are copied onto actors as embedded items at drop time; they keep no
 * live link to the compendium. This module re-establishes the link on demand:
 * it matches each embedded technique to its compendium counterpart and reports
 * whether the stored data still matches.
 *
 * Detection strategy: CONTENT DIFF (deep-equal of normalized `system` data).
 * No version field is required on the technique, so any edit you make in the
 * compendium is detected automatically with zero per-technique maintenance.
 * See dev-notes/technique-synckit.md for the alternatives (version flag / indexed hash)
 * and how to migrate to them later.
 *
 * Cost: runs only on a button click, only over the techniques of ONE actor
 * (~10-50, never the whole 1.3k-item pack). Source docs are batch-loaded in a
 * single query; the comparison itself (foundry.utils.objectsEqual) is sub-ms.
 */

export const STATUS = {
  UP_TO_DATE: "up-to-date",
  OUT_OF_DATE: "out-of-date",
  ORPHAN: "orphan", // no counterpart in the compendium — cannot be synced
};

export function getTechniqueCompendium() {
  return game.packs.get(`${MODULE_ID}.techniques`);
}

function embeddedTechniques(actor) {
  return actor?.items?.filter((i) => i.type === TECHNIQUE_ITEM_TYPE) ?? [];
}

/**
 * Pull the source document `_id` out of an embedded item's compendiumSource,
 * but only when it points at `pack`. Foundry v13 sets `_stats.compendiumSource`
 * (older items used `flags.core.sourceId`) to `Compendium.<packId>.Item.<id>`
 * when a compendium item is dragged onto an actor. Zero-cost, exact.
 */
function sourceIdFromCompendiumSource(item, pack) {
  const cs = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  if (typeof cs !== "string") return null;
  const prefix = `Compendium.${pack.collection}.Item.`;
  return cs.startsWith(prefix) ? cs.slice(prefix.length) : null;
}

/**
 * Map each embedded technique → its compendium source `_id`.
 * Primary key: compendiumSource (when present and still valid). Fallback: exact
 * name match against the pack index. Returns null for techniques with no match.
 *
 * @returns {Map<string, string|null>} embedded item id → source `_id` (or null)
 */
function resolveMatches(actor, pack, index) {
  const byName = new Map();
  const indexIds = new Set();
  for (const entry of index) {
    indexIds.add(entry._id);
    if (!byName.has(entry.name)) byName.set(entry.name, entry._id);
  }

  const matches = new Map();
  for (const item of embeddedTechniques(actor)) {
    let sourceId = sourceIdFromCompendiumSource(item, pack);
    // Stale link (source deleted/renamed in the pack) → fall back to name.
    if (sourceId && !indexIds.has(sourceId)) sourceId = null;
    if (!sourceId) sourceId = byName.get(item.name) ?? null;
    matches.set(item.id, sourceId);
  }
  return matches;
}

/**
 * Deep structural equality that recurses into arrays.
 * NOTE: foundry.utils.objectsEqual is unusable here — it compares arrays by
 * reference (`v0 === v1`), so any object holding a non-empty array (every
 * technique has `system.actions`) always reports "different".
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    if (typeof b !== "object" || Array.isArray(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return a === b;
}

/** Recursively drop every `_id` key — identifiers are not semantic content. */
function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "_id") continue;
      out[k] = stripIds(v);
    }
    return out;
  }
  return value;
}

/**
 * Canonicalize an HTML string. Foundry re-serializes HTMLFields when an item is
 * embedded on an actor (void tags `<br>`/`<hr>` become `<br />`/`<hr />`), so a
 * byte comparison of the source vs the embedded copy always differs even when
 * the content is identical. Round-tripping through innerHTML normalizes both
 * forms to the same string.
 */
function canonicalizeHtml(s) {
  if (typeof s !== "string" || !s) return s;
  if (typeof document === "undefined") return s;
  const el = document.createElement("div");
  el.innerHTML = s;
  return el.innerHTML;
}

/**
 * Normalize a `system` object for comparison. Callers pass `doc.toObject().system`
 * (always available — `item.system.toObject()` can throw on a mistyped item).
 * Removes the noise that the system introduces but the user never edits:
 *  - `_id`s inside actions/changes/links (randomized on import),
 *  - `system.tag` (pf1 auto-derives it from the name when empty),
 *  - actor-owned progression fields (`system.learning`, `system.mastery`),
 *  - HTML serialization differences in description fields,
 *  - prepareBaseData defaults being present on one side and absent on the other.
 * Real content edits (cost, rank, description text, …) still survive and diff.
 */
export function normalizeSystem(system) {
  const out = applyTechniqueSystemDefaults(foundry.utils.deepClone(system), {
    collectionType: "array",
  });
  delete out.tag;
  delete out.learning;
  delete out.mastery;
  out.descriptors = Array.from(new Set(out.descriptors ?? [])).sort();
  out.description.value = canonicalizeHtml(out.description.value);
  out.description.instructions = canonicalizeHtml(out.description.instructions);
  return stripIds(out);
}

/** True when the embedded technique's stored data already matches the source. */
export function diffTechnique(embeddedSystem, sourceSystem) {
  return deepEqual(normalizeSystem(embeddedSystem), normalizeSystem(sourceSystem));
}

function describe(item, status) {
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    rank: item.system?.rank ?? null,
    discipline: item.system?.discipline ?? "",
    status,
  };
}

/**
 * Classify every embedded technique on `actor` as up-to-date / out-of-date / orphan.
 * @returns {Promise<Array<{id,name,img,rank,discipline,status}>>}
 */
export async function analyzeActor(actor) {
  const techniques = embeddedTechniques(actor);
  const pack = getTechniqueCompendium();
  if (!pack || !techniques.length) {
    return techniques.map((it) => describe(it, STATUS.ORPHAN));
  }

  const index = await pack.getIndex();
  const matches = resolveMatches(actor, pack, index);

  const sourceIds = [...new Set([...matches.values()].filter(Boolean))];
  const docs = sourceIds.length ? await pack.getDocuments({ _id__in: sourceIds }) : [];
  const docById = new Map(docs.map((d) => [d.id, d]));

  return techniques.map((item) => {
    const sourceDoc = docById.get(matches.get(item.id));
    if (!sourceDoc) return describe(item, STATUS.ORPHAN);
    const same = diffTechnique(item.toObject().system, sourceDoc.toObject().system);
    return describe(item, same ? STATUS.UP_TO_DATE : STATUS.OUT_OF_DATE);
  });
}

/**
 * Overwrite an embedded technique's data with the compendium source, preserving
 * the embedded item's own `_id` and flags (mirrors chris-premades'
 * `ItemSynckit.update` with `{diff:false}`). Action `_id`s are re-normalized.
 */
export async function syncTechnique(item, sourceDoc) {
  const src = sourceDoc.toObject();
  const { actions, changed } = normalizeActionIds(src.system?.actions);
  if (changed) src.system.actions = actions;
  src.system.mastery = item.toObject().system?.mastery ?? item.system?.mastery ?? 0;
  src.system.learning = foundry.utils.deepClone(
    item.toObject().system?.learning ?? item.system?.learning ?? {},
  );
  await item.update(
    { name: src.name, img: src.img, system: src.system },
    { diff: false, recursive: false },
  );
}

/**
 * Re-sync the selected embedded techniques (by item id) from the compendium.
 * Recomputes matches (cheap) and batch-loads only the needed source docs.
 * @returns {Promise<number>} number of techniques actually updated
 */
export async function syncSelected(actor, itemIds) {
  const pack = getTechniqueCompendium();
  if (!pack) return 0;

  const index = await pack.getIndex();
  const matches = resolveMatches(actor, pack, index);

  const wanted = itemIds.filter((id) => matches.get(id));
  const sourceIds = [...new Set(wanted.map((id) => matches.get(id)))];
  if (!sourceIds.length) return 0;

  const docs = await pack.getDocuments({ _id__in: sourceIds });
  const docById = new Map(docs.map((d) => [d.id, d]));

  let count = 0;
  for (const id of wanted) {
    const item = actor.items.get(id);
    const sourceDoc = docById.get(matches.get(id));
    if (!item || !sourceDoc) continue;
    await syncTechnique(item, sourceDoc);
    count++;
  }
  return count;
}
