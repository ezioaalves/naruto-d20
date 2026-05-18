/**
 * Resolve an Item document from a drag event.
 *
 * Centralizes the v12→v13 TextEditor shim and uuid → Item lookup that the
 * chakra-tab technique drop (ui/technique-list.mjs) and the technique-sheet
 * links drop (ui/technique-sheet.mjs) both need.
 *
 * @param {DragEvent} event       Native drag event (use event.originalEvent if jQuery-wrapped).
 * @param {object}    [opts]
 * @param {string}    [opts.type] If set, only returns the doc when `doc.type === type`.
 * @returns {Promise<Item|null>}  The dropped Item, or null if invalid/wrong type.
 */
export async function resolveDroppedItem(event, { type } = {}) {
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let data;
    try { data = TE.getDragEventData(event); } catch { return null; }
    if (!data?.uuid) return null;

    const doc = await fromUuid(data.uuid);
    if (!(doc instanceof Item)) return null;
    if (type && doc.type !== type) return null;
    return doc;
}
