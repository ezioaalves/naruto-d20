# Technique Medkit

A per-actor tool, inspired by the **medkit** in `chris-premades`, that checks
which embedded techniques on a sheet are out of date relative to the
`naruto-d20.techniques` compendium and re-syncs the ones you select — preserving
the embedded item's `_id` and the actor's own flags.

It exists because techniques are **copied** onto actors at drop time (they keep
no live link to the compendium). When you edit a technique in the compendium —
which happens constantly during authoring — every copy already on a sheet goes
stale, and the old workflow was to delete them all and re-import by hand.

- **Button:** title bar of the actor sheet **and** the Techniques header on the
  Chakra tab (both open the same window).
- **Detection:** content diff (no version field, zero per-technique maintenance).
- **Scope:** only re-syncs techniques already on the sheet. It does **not**
  import new techniques or wipe-and-reimport.

---

## How the chris-premades medkit works (and why we can't copy it directly)

### Button injection

CPR adds a medkit control to the window header of item sheets, actor sheets and
the compendium browser via `appendHeaderControl`
(`scripts/extensions/titlebar.js`). After render it colors the icon by status
(red = out of date, green = up to date, etc.).

### Detection — by **version number**, not content

The whole thing hinges on two flags stored **on the item that lives on the
sheet** (`scripts/lib/utilities/itemUtils.js:66-119`):

```js
function getVersion(item) {
    return item?.flags['chris-premades']?.info?.version ?? item?._stats?.modifiedTime;
}
function getSource(item) {
    return item?.flags['chris-premades']?.info?.source;
}
// -1 none · 0 out of date · 1 up to date · 2 generic
async function isUpToDate(item) {
    let version = getVersion(item);
    let source  = getSource(item);
    if (!version || !source) return (item.flags['chris-premades']?.config?.generic ? 2 : -1);
    let sourceVersion;
    switch (source) {
        // ...CPR macro version, gambits, MISC...
        default: {
            let sourceObj = await compendiumUtils.getItemFromCompendium(source, item.name, {ignoreNotFound:true, object:true});
            sourceVersion = getVersion(sourceObj);
        }
    }
    if (!sourceVersion) return -1;
    let compare = genericUtils.isNewerVersion(sourceVersion, version);
    return compare ? 0 : 1;
}
```

It **never compares the contents** of the two items. It only asks *"is the
source's version number greater than the number stamped on the sheet item?"*.
That works because every CPR automation carries a `version` field the author
**bumps by hand** on every behavior change (their CLAUDE.md: *"Bump the
automation object's `version` when you change its behavior"*).

### Update — overwrite, keep user customizations

`ItemMedkit.update` (`scripts/applications/medkit-item.js:765-839`) takes the
source item, copies a `keepPaths` allow-list of fields off the old item
(equipped state, quantity, user config, etc.), then replaces in place:

```js
await item.update(sourceItemData, { diff: false, recursive: false });
```

`{diff:false}` forces a full overwrite; the embedded `_id` is preserved because
it's the same document being updated.

### Why it doesn't port to naruto-d20

- Techniques have **no `version` field** on `TechniqueDataModel`.
- `_stats.modifiedTime` is **`null`** in the pack source files, so CPR's version
  fallback wouldn't help either.
- There are **~1366 technique files**, edited constantly — manually versioning
  each one on every edit is not viable.

So the version-flag model is the wrong fit. We use content diff instead.

---

## The three detection options that were considered

| | How it detects | Maintenance | Schema change | Scan cost |
|---|---|---|---|---|
| **A — content diff** *(chosen)* | deep-equal of normalized `system` (sheet vs compendium) | **none** — edits detected automatically | none | N source docs of *this actor* loaded, batched (tens of ms on click) |
| **B — version field** (like chris) | compare `version` flag vs source `version` | bump version by hand on every edit (×1366) | add `version` to `TechniqueDataModel`, index it | index only (cached, ~0 ms) |
| **C — A + indexed content hash** | compare a `system` hash stored in the pack index | none (hash generated at pack time) | extra step in `npm run pack` | index only (cached, ~0 ms) |

### Cost note (why A is cheap, despite the instinct)

The scan runs **on a button click**, only over the techniques on **one actor**
(~10-50), never the whole 1366-item pack. Matching is by `_stats.compendiumSource`
(a UUID already on the sheet item — zero reads) with an exact-name fallback
against the index. The matched source docs are batch-loaded in a single
`pack.getDocuments({ _id__in })`, and the comparison itself (a small recursive
`deepEqual`) is sub-millisecond. Total: tens of ms, once.

> **Gotcha:** do **not** use `foundry.utils.objectsEqual` for this — it compares
> arrays by reference (`v0 === v1`), so any object holding a non-empty array
> (every technique has `system.actions`) always reports "different". The module
> ships its own array-aware `deepEqual`.

### Future upgrade path (A → C)

If a sheet ever carries enough techniques that loading their source docs on the
scan feels slow, switch to **C** without touching the UI:

1. Add a build step to `npm run pack` (a `tools/*.mjs` script) that writes a hash
   of each technique's normalized `system` into a field included in the pack
   index (e.g. `flags["naruto-d20"].contentHash`).
2. Stamp the same hash onto the embedded item at sync time (in `syncTechnique`).
3. Change `analyzeActor` to compare the item's stored hash against the index hash
   (read from `pack.getIndex({ fields })`) instead of calling `diffTechnique`.
   Only load full source docs for the items being synced.

`diffTechnique` / `normalizeSystem` stay as the canonical "are these equal"
definition and as the hash input, so A and C never disagree.

---

## Architecture (current — option A)

### `scripts/automation/technique-sync.mjs` — detection & sync core (no UI)

| Export | Role |
|---|---|
| `STATUS` | `up-to-date` / `out-of-date` / `orphan` enum |
| `getTechniqueCompendium()` | `game.packs.get("naruto-d20.techniques")` |
| `normalizeSystem(system)` | strips comparison noise: `_id`s (randomized on import), `system.tag` (pf1 auto-derives it), HTML-serialization differences in description fields, and fills `prepareBaseData` defaults so present-vs-absent doesn't diff |
| `diffTechnique(a, b)` | array-aware `deepEqual(normalizeSystem(a), normalizeSystem(b))` |
| `analyzeActor(actor)` | classify every embedded technique; batch-loads matched source docs |
| `syncTechnique(item, sourceDoc)` | overwrite `name`/`img`/`system` with `{diff:false}`, re-normalizing action ids — mirrors CPR's `ItemMedkit.update` |
| `syncSelected(actor, ids)` | re-resolve matches + batch-load + sync the selected items |

**Matching** (`resolveMatches`, private): primary key is
`_stats.compendiumSource` (Foundry v13 sets it to `Compendium.<packId>.Item.<id>`
when a compendium item is dropped on an actor; older items used
`flags.core.sourceId`). If absent or stale (source deleted), it falls back to an
exact name match against the pack index. Techniques with neither are `orphan`.

**Comparison inputs** use `doc.toObject().system` on both sides — *not*
`item.system.toObject()`, which throws on a mistyped item (e.g. a technique whose
stored `system` is spell-shaped). `toObject()` returns `_source`, which omits the
defaults that `prepareBaseData` fills on the live model (`automation`, empty
arrays, blank description fields) — so `normalizeSystem` re-applies those same
defaults to both sides. `applyTechniqueDefaults` is a hand-kept mirror of
`TechniqueDataModel.prepareBaseData`; **if the schema's defaults change, update
both.**

Three noise sources, all found and fixed during live verification:
- **Arrays:** `foundry.utils.objectsEqual` compares arrays by reference → use the
  module's `deepEqual`.
- **HTML serialization:** embedding rewrites `<br>`→`<br />`, `<hr>`→`<hr />` →
  `canonicalizeHtml` round-trips description fields through `innerHTML`.
- **Auto-derived / default fields:** `system.tag` (dropped) and `prepareBaseData`
  defaults (re-applied).

Reuses: `normalizeActionIds` (`scripts/data/action-ids.mjs`),
`TECHNIQUE_ITEM_TYPE` (`scripts/constants.mjs`).

Verified live against three party sheets (Ikazuchi 17, Dan 14, Suigin 21): all
matched techniques report up-to-date, 4 genuinely-homebrew Suigin techniques
report orphan, and a dirtied `chakraCost` correctly flips to out-of-date and back
after sync.

### `scripts/ui/technique-medkit-app.mjs` + `templates/actor/technique-medkit.hbs`

`TechniqueMedkitApp extends Application` (V1, matching pf1 chrome — see CLAUDE.md,
same base as `NarutoFeatBrowser`). `getData()` calls `analyzeActor`, decorates
each row with a localized label/icon/css and a `syncable` flag, sorts
out-of-date → orphan → up-to-date, and computes counts. The template renders a
summary bar, a checklist (only out-of-date rows get a checkbox, checked by
default), and footer buttons "Select all outdated" / "Sync selected". On sync it
calls `syncSelected`, notifies, re-renders itself and the actor sheet.

### Buttons

- **Window title bar** — `installMedkitHeaderButton()` in
  `scripts/ui/render-patch.mjs` wraps `ActorSheetPF.prototype._getHeaderButtons`
  once (same one-patch-covers-all-subclasses approach as the chakra-tab
  `_renderInner` patch), unshifting a `fa-kit-medical` button for character/npc.
  Wired in `main.mjs` `setup` [7].
- **Chakra tab** — `registerTechniqueListListeners` (`scripts/ui/technique-list.mjs`)
  injects a `.naruto-technique-medkit-btn` into `.techniques-header` via
  `insertAdjacentHTML` (idempotent), same pattern as `feat-list.mjs`.

### i18n & styles

`NarutoD20.Medkit.*` in `lang/en.json` and `lang/pt-BR.json`. Window styling
under `.naruto-technique-medkit` in `styles/apps/technique-medkit.css`.

---

## Manual verification

1. `F5` / `Ctrl+R` to reload the module.
2. Open a sheet with embedded techniques → confirm the medkit button on the
   **title bar** and in the **Chakra tab** Techniques header.
3. Edit a technique in the compendium (e.g. change `chakraCost`), `npm run pack`,
   reload → open the medkit → that technique shows **Out of date**, the rest
   **Up to date**.
4. Add a technique to the sheet whose name doesn't exist in the compendium →
   shows **Not in compendium** (no checkbox, not syncable).
5. Check the out-of-date one → **Sync selected** → its `system` is updated, the
   embedded `_id` is unchanged, status flips to **Up to date**.
6. Remove a technique's `_stats.compendiumSource` (or use one created via the
   "+" button) → confirm it still matches by name.
7. With ~30 techniques on a sheet, the scan should feel instant (sub-100 ms).
