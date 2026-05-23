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
| `scripts/ui/technique-browser.mjs` | `TechniqueCompendiumBrowser` class (Application V1). |
| `templates/apps/technique-browser.hbs` | Layout (filter sidebar + entry list). |
| `scripts/ui/technique-list.mjs` | The `.technique-browse` handler opens the custom browser, passing the clicked rank. |
| `templates/actor/chakra-tab.hbs` | Browse buttons carry `data-rank="{{rank}}"` so the browser knows which rank to pre-select. |
| `scripts/main.mjs` | Registers the template in `loadTemplates` (`init` hook). |

### `TechniqueCompendiumBrowser`

Extends `Application` (V1) — matching PF1e's own `CompendiumBrowser` architecture. This gives
identical window chrome (dark title bar, close button, resize handle), OS-default checkbox
appearance, and readable button text without any custom CSS.

Key points:

- **`defaultOptions.classes = ["pf1", "app", "compendium-browser", "naruto-technique-browser"]`** —
  inherits all PF1e compendium-browser CSS (sidebar layout, filter styles, entry grid).
- **`defaultOptions.template`** — single template, rendered via V1's `getData` / `activateListeners`.
- **Instance state** (private fields): `#query`, `#filters` (one `Set` per group: discipline,
  rank, complexity, special, components), `#collapsed` (Set of filter-group IDs currently
  collapsed), `#entries` (index cache), `#loading`, `#focusSearch`.
- **Constructor** accepts `options.rank`: seeds `#filters.rank` with the initial rank and
  initialises `#collapsed` with all groups except `"rank"` (Rank starts expanded, all others
  collapsed, matching the native browser's default state).
- **`#loadEntries()`** loads the `naruto-d20.techniques` pack index **once**, with the required
  `system.*` fields (see "Index" below), and maps it to `{ __uuid, __packLabel, name, img, system }`.
- **`getData()`** applies the search + filters and returns `{ filters, entries, query,
  itemCount, filteredItemCount, loading }`. Each filter object carries `collapsed` (`"collapsed"`
  or `""`) so the template can apply the CSS class directly.
- **`activateListeners(html)`** wires all listeners (search, checkboxes, filter-header toggle,
  name click, `dragstart`, buttons).

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

### Collapsible filter groups

Clicking a filter group header toggles the `collapsed` CSS class on its `.filter-content` child
**directly in the DOM** (no re-render). The PF1e CSS rule
`.app.pf1.compendium-browser … .filter-content.collapsed { display: none }` handles
the visual hide. The `#collapsed` Set is kept in sync so the correct state is written
to context on the next real re-render (checkbox change, search, reload).

Not calling `this.render()` on collapse is intentional: a full V1 re-render would reset the
entry-list scroll position, which is jarring when the user is just toggling a sidebar section.

### Search UX

The search input re-renders the entry list with a 200 ms debounce. Because V1 Application
replaces the entire template DOM on each render, focus and cursor position would otherwise reset.
The browser tracks `#focusSearch`; after each debounced render `activateListeners` restores
focus and calls `setSelectionRange(len, len)` to keep the cursor at the end of the typed text.

### Initial rank pre-selection

Each rank-header's Browse button in `chakra-tab.hbs` carries `data-rank="{{rank}}"`. The
`.technique-browse` handler in `technique-list.mjs` reads it:

```js
const rank = ev.currentTarget.dataset.rank;
new TechniqueCompendiumBrowser({ rank }).render(true);
```

The constructor seeds `#filters.rank` with that value and leaves the Rank group expanded, so the
browser opens already filtered to the clicked rank.

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

No custom CSS. PF1e styles everything under the selector
`.app.pf1.compendium-browser .window-content > div …` (verified in `pf1/pf1.css`, ~line 1363).
Because the class list includes `"pf1"`, `"app"`, and `"compendium-browser"`, and the template
root is a `<div class="compendium-browser-content">` that is a direct child of `.window-content`,
the two-column layout, filter sidebar, and list rows inherit the native look.

Using `Application` (V1) rather than `ApplicationV2` is what makes the visual match possible:
PF1e's own `CompendiumBrowser` extends `Application`, so the window chrome HTML structure
(title bar element, close button, resize handle) is identical, and the standard OS checkbox
appearance is preserved.

## Index fields — per-call vs global registration

The pf1 docs describe a global pattern: each native browser filter implements
`registerIndexFields()`, which adds fields to `CONFIG.Item.compendiumIndexFields` so
`CompendiumCollection#getIndex()` includes them without arguments.

This implementation takes the **per-call** alternative: passing `{ fields: [...] }` directly to
`getIndex()`. Advantages: self-contained, does not pollute `CONFIG`, no filter-class layer needed.
Both forms are supported by the same `getIndex` API.

> Runtime note: confirm on first run that `getIndex({ fields })` populates `entry.system.*` on
> v11.11. If any field comes back empty, the trivial fallback is `pack.getDocuments()` (the
> pack is small, ~400 items).

## Manual verification

No build step (ESM loaded directly). Reload with `F5` (or `Ctrl+R` in-world).

1. Chakra tab → folder (Browse) button on a Rank N header → browser opens with the Rank filter
   expanded and Rank N pre-checked; all other groups (Discipline, Complexity, Special, Components)
   are collapsed.
2. The entry list shows every technique matching Rank N with icon, name, and "Rank N · Discipline".
   The "Total / Filtered" counters are correct.
3. Click any filter group header → choices collapse/expand without resetting the entry-list
   scroll position.
4. Discipline = Taijutsu filters to Taijutsu only; adding Rank = 9 narrows further (AND);
   checking two ranks = OR within the group. Complexity / Special / Components likewise.
5. The search box filters by name, combined with active checkboxes (~200 ms debounce). Typing
   keeps the cursor at the end; focus is not lost between keystrokes.
6. `Clear Filters` resets everything; `Reload Packs` reloads the index.
7. Dragging a row onto the tab's `.techniques-body` adds the technique to the actor (existing
   drop zone). No regression dragging from the Foundry sidebar.
8. Clicking an entry's name opens the technique's sheet.
9. Window chrome (title bar colour, font, close button, resize handle) matches the native
   PF1e Spell Browser.
