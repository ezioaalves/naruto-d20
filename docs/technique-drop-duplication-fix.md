# Fix: dragging a technique onto the sheet created two copies

## Problem

Dragging a `naruto-d20.technique` item onto a character/NPC sheet added **two** copies
instead of one. It happened regardless of the drag source — the native compendium window,
the custom Technique Compendium Browser, or a world item folder in the sidebar.

## Root cause

Two `drop` handlers were acting on the same event:

1. **Our handler** in `scripts/ui/technique-list.mjs` listens for `drop` on the Chakra
   tab's `.techniques-body`, resolves the dropped item, and calls
   `app.actor.createEmbeddedDocuments("Item", [...])` — copy #1.

2. **pf1's native actor-sheet handler** registers its DragDrop with `dropSelector: null`,
   so the `drop` listener is bound on the **sheet root element** (an ancestor of
   `.techniques-body`). Its `_onDrop` handles `case "Item"` → `_onDropItem`, which also
   adds the item to the actor — copy #2.

Our handler called `ev.preventDefault()` but **not** `ev.stopPropagation()`. After our
handler ran, the event bubbled up to the sheet root, where pf1's handler fired the second
creation. Any technique is a valid `Item`, so pf1 accepts it from any source — which is
why every drag origin reproduced the bug.

Ruled out: duplicate hook registration and stacked listeners. The handler is attached once
per render and `.off("dragover drop")` clears prior bindings first.

## Fix

`scripts/ui/technique-list.mjs` — add `ev.stopPropagation()` in the `drop` handler,
synchronously, **before** the first `await`:

```js
.on("drop", async (ev) => {
    ev.preventDefault();
    // Stop the event reaching pf1's native sheet drop handler (bound on the
    // sheet root with dropSelector:null), which would add a second copy.
    ev.stopPropagation();
    const srcItem = await resolveDroppedItem(ev.originalEvent, { type: TECHNIQUE_ITEM_TYPE });
    ...
});
```

Event propagation is resolved synchronously during dispatch, so calling
`stopPropagation()` before any `await` guarantees the sheet root never receives the event
and pf1's `_onDrop` never runs for this drop.

Dropping a technique **outside** `.techniques-body` still uses pf1's native path
(unchanged, expected behavior).

## Manual verification

No build step (ESM loaded directly by Foundry). Reload with `F5`.

1. Open a character sheet → Chakra tab.
2. Drag a technique from the **native compendium window** onto the technique area →
   exactly **one** technique is added.
3. Repeat from the **custom Technique Compendium Browser**.
4. Repeat from a technique in a **world item folder** (sidebar).
5. Drag a **non-technique** item onto `.techniques-body` → shows
   "Only Technique items can be dropped here." and adds nothing (not via pf1 either).
6. Confirm the actor's item count increases by exactly 1 per drop.
