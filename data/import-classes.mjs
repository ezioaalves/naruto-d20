/**
 * Import Classes DB macro — paste this into a Foundry Macro (script type) and run as GM.
 *
 * Prerequisites: this is a local-only workflow. The following packs must exist in your
 * working copy and be declared in module.json before you run the macro:
 *   { "name": "classes",         "label": "Naruto Classes",          "type": "Item", "system": "pf1" }
 *   { "name": "class-abilities", "label": "Naruto Class Abilities",  "type": "Item", "system": "pf1" }
 *
 * What this macro does:
 *   1. Fetches data/classes-db.json from the naruto-d20 module
 *   2. Creates (or updates) class feature items in naruto-d20.class-abilities
 *   3. Creates (or updates) class items in naruto-d20.classes
 *   4. Builds system.links.classAssociations on each class (level → feature entries)
 *   5. Back-fills system.associations.classes[] on each feature with the class UUID
 */

const MODULE_ID  = "naruto-d20";
const PACK_CLASS = `${MODULE_ID}.classes`;
const PACK_FEAT  = `${MODULE_ID}.class-abilities`;

// ---------------------------------------------------------------------------
// Guard: GM only, packs must exist
// ---------------------------------------------------------------------------
if (!game.user.isGM) {
    ui.notifications.warn("[import-classes] GM permission required.");
    return;
}

const classPack = game.packs.get(PACK_CLASS);
const featPack  = game.packs.get(PACK_FEAT);

if (!classPack || !featPack) {
    ui.notifications.error(
        `[import-classes] Missing packs. Add 'classes' and 'class-abilities' to module.json first. ` +
        `Expected: ${PACK_CLASS}, ${PACK_FEAT}`
    );
    return;
}

// ---------------------------------------------------------------------------
// 1. Load the database JSON
// ---------------------------------------------------------------------------
const dbUrl  = `modules/${MODULE_ID}/data/classes-db.json`;
const dbResp = await fetch(dbUrl);
if (!dbResp.ok) {
    ui.notifications.error(`[import-classes] Could not fetch ${dbUrl} (${dbResp.status})`);
    return;
}
const db = await dbResp.json();

// ---------------------------------------------------------------------------
// 2. Helper — upsert a document into a pack (match by name, overwrite on hit)
// ---------------------------------------------------------------------------
async function upsert(pack, itemData) {
    await pack.getIndex();
    const existing = pack.index.find(e => e.name === itemData.name);
    if (existing) {
        const doc = await pack.getDocument(existing._id);
        const merged = foundry.utils.mergeObject(doc.toObject(), itemData, { inplace: false });
        await doc.update(merged);
        return doc;
    }
    const [doc] = await pack.documentClass.createDocuments([itemData], { pack: pack.collection });
    return doc;
}

// ---------------------------------------------------------------------------
// 3. Import class features — must go first so we have their UUIDs
// ---------------------------------------------------------------------------
const featureByKey = {};  // _key → { uuid, name, level }

for (const feat of db.classFeatures) {
    const itemData = foundry.utils.deepClone(feat);
    const key   = itemData._key;
    const level = itemData._level ?? 1;
    delete itemData._key;
    delete itemData._classes;
    delete itemData._level;

    const doc = await upsert(featPack, itemData);
    featureByKey[key] = { uuid: doc.uuid, name: feat.name, level };
    console.log(`[import-classes] Feature upserted: ${feat.name} → ${doc.uuid}`);
}

// ---------------------------------------------------------------------------
// 4. Import classes — build classAssociations from the progression table
// ---------------------------------------------------------------------------
for (const cls of db.classes) {
    const itemData   = foundry.utils.deepClone(cls);
    const classKey   = itemData._key;
    const progression = itemData.progression ?? [];
    delete itemData._key;
    delete itemData.progression;

    // Build classAssociations: one entry per (level, feature) pair
    const associations = [];
    for (const row of progression) {
        for (const featKey of row.features) {
            const info = featureByKey[featKey];
            if (!info) {
                console.warn(`[import-classes] Unknown feature key '${featKey}' in class '${cls.name}'`);
                continue;
            }
            // PF1e classAssociations entry format (v11.11)
            associations.push({
                id:    info.uuid.split(".").at(-1),
                uuid:  info.uuid,
                name:  info.name,
                level: row.level,
                extra: "",
            });
        }
    }
    itemData.system.links.classAssociations = associations;

    const clsDoc = await upsert(classPack, itemData);
    console.log(`[import-classes] Class upserted: ${cls.name} → ${clsDoc.uuid}`);

    // 5. Back-fill each linked feature's system.associations.classes[]
    for (const row of progression) {
        for (const featKey of row.features) {
            const info = featureByKey[featKey];
            if (!info) continue;

            await featPack.getIndex();
            const featIndex = featPack.index.find(e => e.name === info.name);
            if (!featIndex) continue;

            const featDoc = await featPack.getDocument(featIndex._id);
            const currentClasses = featDoc.system?.associations?.classes ?? [];
            if (!currentClasses.includes(clsDoc.uuid)) {
                await featDoc.update({
                    "system.associations.classes": [...currentClasses, clsDoc.uuid],
                });
            }
        }
    }
}

ui.notifications.info(
    "[import-classes] Import complete. " +
    `Classes → ${PACK_CLASS} | Features → ${PACK_FEAT}`
);
console.log("[import-classes] All done.");
