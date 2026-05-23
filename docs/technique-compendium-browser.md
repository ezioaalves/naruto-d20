# Custom Compendium Browser for techniques

## Goal

Replace the native pack window (opened by the Chakra tab's **Browse** button) with a **custom
browser** that mirrors pf1's *spell* Compendium Browser: a filter sidebar on the left and a
searchable entry list on the right. The user filters/searches techniques and drags them onto the
tab (the drop zone already existed).

Context: the previous feature (see [`technique-header-buttons.md`](./technique-header-buttons.md))
made Browse open just `game.packs.get("naruto-d20.techniques").render(true)`, because pf1's
Compendium Browser selects packs/entries by `handledTypes` and **does not recognize** the custom
`naruto-d20.technique` type. Since `pf1.applications.compendiums.*` cannot be reused, a custom
browser was written.

## Architecture

| File | Role |
|---|---|
| `scripts/ui/technique-browser.mjs` | **NEW.** `TechniqueCompendiumBrowser` class (AppV2). |
| `templates/apps/technique-browser.hbs` | **NEW.** Layout (filter sidebar + entry list). |
| `scripts/ui/technique-list.mjs` | The `.technique-browse` handler now opens the custom browser. |
| `scripts/main.mjs` | Registers the new template in `loadTemplates` (`init` hook). |

### `TechniqueCompendiumBrowser`

Extends `HandlebarsApplicationMixin(ApplicationV2)`. Key points:

- **`DEFAULT_OPTIONS.classes = ["pf1", "app", "compendium-browser", "naruto-technique-browser"]`** —
  reuses the native pf1 browser CSS (see "Styling" below).
- **`PARTS = { main: { template: ".../technique-browser.hbs" } }`** — single part.
- **Instance state** (private fields): `#query`, `#filters` (one `Set` per group: discipline,
  rank, complexity, special, components), `#entries` (index cache), `#loading`.
- **`#loadEntries()`** loads the `naruto-d20.techniques` pack index **once**, with the required
  `system.*` fields (see "Index" below), and maps it to `{ __uuid, __packLabel, name, img, system }`.
- **`_prepareContext()`** applies the search + filters and returns `{ filters, entries, query,
  itemCount, filteredItemCount, loading }`.
- **`_onRender()`** wires the listeners (debounced search, checkboxes, name click, `dragstart`).
- **Actions** `clearFilters` / `reload` declared in `DEFAULT_OPTIONS.actions`.

### Filters

Name search (always) + 5 checkbox groups. **AND across groups, OR within a group:**

| Group | Field | Choices |
|---|---|---|
| Discipline | `system.discipline` | `MAIN_DISCIPLINES` (constants.mjs) |
| Rank | `system.rank` | 1–15 |
| Complexity | `system.complexity` | `Object.keys(COMPLEXITY_TABLE)` (technique-model.mjs) |
| Special | `system.isHijutsu` / `isKinjutsu` / `isCombination` | Hijutsu, Kinjutsu, Combination |
| Components | `system.compHandSeals` … `compXpCost` (10 flags) | Hand Seals, Half Seals, … XP Cost |

Special and Components are boolean-flag groups: an entry passes if **any** selected flag is true.

### Index (loading `system.*` into getIndex)

A pack's default index only carries `name`, `img`, `type`. To filter by `system.discipline`,
`system.rank`, etc. **without loading the full documents**, the browser passes the fields
explicitly:

```js
const index = await pack.getIndex({ fields: [
  "system.discipline", "system.rank", "system.complexity",
  "system.isHijutsu", "system.isKinjutsu", "system.isCombination",
  "system.compHandSeals", /* … all 10 component flags … */
] });
```

### Drag-and-drop

Each `<li class="directory-item" draggable="true" data-uuid="…">`; on `dragstart` the browser
writes `event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }))`. This
matches `resolveDroppedItem` (`scripts/utils/drag-drop.mjs`) exactly, which resolves by
`data.uuid` via `fromUuid()` and validates `doc.type === TECHNIQUE_ITEM_TYPE`. **The tab's
existing drop zone (`.techniques-body`) needed no changes.** Clicking an entry's name opens the
technique's sheet (read-only from the compendium).

### Styling

No new CSS was written. pf1 styles everything under the selector
`.app.pf1.compendium-browser .window-content > div …` (verified in `pf1/pf1.css`, ~line 1363).
Because (a) the `app` class is included in `DEFAULT_OPTIONS.classes` — pf1 itself uses
`["pf1","app","compendium-browser"]` — and (b) the template root is a `<div>` that is a direct
child of `.window-content` (`<div class="compendium-browser-content">`), the two-column layout,
the filter sidebar and the list rows inherit the native look.

## Context7 verification

Verification of the API used against the official docs, and whether it matches the installed pf1
system (`/Users/joelfmjr/foundrydata/Data/modules/pf1`, v11.11):

| Item | Context7 source | Result |
|---|---|---|
| **AppV2 actions** (`actions` in `DEFAULT_OPTIONS`, static functions bound to `data-action`, `this` = instance, signature `(event, target)`) | `/websites/foundryvtt_wiki_en_development` (api/applicationv2) | ✅ **Matches.** Implemented exactly this way (`clearFilters`/`reload`). pf1 also uses this pattern in its native browser (e.g. `data-action="browse"` / `clear-filter`). |
| **`static PARTS = { id: { template } }`** + `_prepareContext` / `_preparePartContext` | wiki (Tabs-and-Templates) | ✅ **Matches.** For a single part, `_prepareContext` is enough; `_preparePartContext` is only needed with multiple parts/tabs. |
| **`CompendiumCollection#getIndex` with extra fields** | PF1e API (`pf1.applications.compendiumBrowser.filters.*.registerIndexFields`) | ✅ **Mechanism confirmed**, with **one approach divergence** (see below). |

### Relevant divergence: how pf1 adds fields to the index

The pf1 docs show that **each native browser filter** implements `registerIndexFields()`, which
*"adds the index fields checked by this filter to the document's `CONFIG` object, so that
`CompendiumCollection#getIndex` will include them."* That is, pf1 registers the fields
**globally** (in `CONFIG.Item.compendiumIndexFields`) and then calls `getIndex()` with no arguments.

This implementation took the **per-call** alternative: passing `{ fields: [...] }` directly to
`getIndex()`. Advantages for our case: it is self-contained, does not pollute Foundry's global
`CONFIG`, and does not require a filter-class layer like pf1's. Both forms are supported by the
same `getIndex` API; the only difference is *where* the field list lives.

> Runtime note: confirm on first run that `getIndex({ fields })` actually populates
> `entry.system.*` on v11.11. If any field comes back empty, the trivial fallback is to swap
> `getIndex` for `pack.getDocuments()` (the pack is small, ~400 items).

## Manual verification

No build step (ESM loaded directly). Reload with `F5` (or `Ctrl+R` in-world).

1. Chakra tab → folder (Browse) button on any Rank → opens the custom browser with a look
   identical to the spell browser (sidebar + list).
2. The list shows every technique in the pack with icon, name and "Rank N · Discipline". The
   "Total / Filtered" counters are correct.
3. Discipline = Taijutsu filters to Taijutsu only; adding Rank = 9 narrows further (AND); checking
   two ranks = OR within the group. Complexity / Special / Components likewise.
4. The search box filters by name, combined with the active checkboxes (~200ms debounce).
5. `Clear Filters` resets everything; `Reload Packs` reloads the index.
6. Dragging a row onto the tab's `.techniques-body` adds the technique to the actor (existing drop
   zone). No regression dragging from the Foundry sidebar.
7. Clicking an entry's name opens the technique's sheet.
