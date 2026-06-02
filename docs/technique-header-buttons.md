# Create and Browse buttons on technique Rank headers

> **Update:** the **Browse** button described here (which used to open the native
> pack window via `pack.render(true)`) was replaced by a custom Compendium Browser.
> See [`technique-compendium-browser.md`](./technique-compendium-browser.md). The rest
> of this document (Create button, placement, empty-state) is still accurate.

## Goal

Replicate, on the **Chakra** tab (technique list), the two buttons pf1 shows on each
level header of the **Spells** tab:

- **`+` (Create)** — creates an item directly on the actor's sheet and opens its sheet for editing.
- **Folder/book (Browse)** — opens a compendium the item can be added from.

Before this change, techniques could only be added via drag-and-drop.

## How pf1 does it (reference)

In `pf1/templates/actors/parts/actor-spellbook.hbs`, the level header has, inside `.item-controls`:

- `<a class="item-control item-create" data-create=… data-level=… data-book=…>` → the
  `_onItemCreate` handler runs `Item.create` on the actor and opens the sheet.
- `<a data-action="browse" data-source="spells.spell" data-level=…>` → opens
  `pf1.applications.compendiums.spells`.

**Limitation:** pf1's Compendium Browser selects packs/entries by `handledTypes` (derived
from each native browser's filters). The custom `naruto-d20.technique` type is not recognized
by any native browser, so `pf1.applications.compendiums.*` cannot be reused for techniques
without writing a custom browser.

## Design decisions

- **Browse** → opens the custom Technique Compendium Browser for
  `naruto-d20.techniques`, with the clicked rank pre-selected. It originally
  opened the native pack window via `pack.render(true)`, but that was superseded
  by [`technique-compendium-browser.md`](./technique-compendium-browser.md).
- **Button placement** → on **each Rank** header, mirroring the Spells tab (which puts the
  buttons on each level's row).
  - Since an empty tab has no rank header, the *empty-state* block also gets the button pair so
    a fresh actor can create the first technique / open the compendium.

## Implementation

### `templates/actor/chakra-tab.hbs`

Both rank headers (the "All" group and the per-discipline groups) had an empty
`<div class="item-controls"></div>`. Each one now contains:

```hbs
<div class="item-controls">
    <a class="technique-create item-control" data-tooltip="Create Technique" data-rank="{{rank}}"><i class="fa-solid fa-plus" inert></i></a>
    <a class="technique-browse item-control" data-tooltip="Browse Techniques"><i class="fa-solid fa-folder-plus" inert></i></a>
</div>
```

- `data-rank="{{rank}}"` — the group's rank, used as the initial value of the created technique.
- On the per-discipline group headers, the create button also carries `data-disc="{{../label}}"`
  (the tab `label` is the discipline, e.g. "Ninjutsu"). In the "All" group and the "Other" tab the
  handler validates the value against `MAIN_DISCIPLINES` and falls back to the model default
  (`"Ninjutsu"`) if it is invalid.

The empty-state block got the same button pair, without `data-rank` (→ rank 1 by default).

### `scripts/ui/technique-list.mjs`

Two handlers in `registerTechniqueListListeners()`, scoped to `.tab.chakra` and following the
`.off("click").on("click", …)` pattern already used by the tab's other buttons.

**Create** — mirrors pf1's `_onItemCreate`:

```js
chakraTab.find(".technique-create").off("click").on("click", async (ev) => {
    ev.preventDefault();
    const ds = ev.currentTarget.dataset;
    const rank = Number(ds.rank) || 1;
    const system = { rank };
    if (ds.disc && MAIN_DISCIPLINES.includes(ds.disc)) system.discipline = ds.disc;
    const [item] = await app.actor.createEmbeddedDocuments("Item", [{
        type: TECHNIQUE_ITEM_TYPE,
        name: "New Technique",
        system,
    }]);
    item?.sheet?.render(true);
});
```

**Browse** — *(originally)* opened the pack window. It now opens the custom browser; see
[`technique-compendium-browser.md`](./technique-compendium-browser.md).

## Notes

- Tooltips are hardcoded in English, like the rest of `chakra-tab.hbs` ("Open Sheet", "Remove").
  No `lang/` changes.
- No change to `TechniqueDataModel`: `rank` (min 1) and `discipline` (default "Ninjutsu") already existed.

## Manual verification

No build step (ESM loaded directly by Foundry). Reload with `Ctrl+R` in-world or `F5`.

1. Sheet **with** techniques → each Rank header shows `+` and the folder icon.
2. `+` on Rank 3 → creates a "New Technique" rank 3 and opens its sheet. In a discipline group
   (e.g. Taijutsu) the technique is born with `discipline = Taijutsu`.
3. Folder button → opens the custom Technique Browser; dragging onto the tab still works.
4. Sheet **without** techniques → the empty-state shows the button pair; `+` creates rank 1 and opens.
5. Discipline filters and per-row use/open/delete still work (no regression).
