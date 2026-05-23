# PF1e Item-Sheet Pattern Guide

A reference for building Naruto D20 item sheets that look and feel native to PF1e v11.11. Follow this guide and most of the styling is free — PF1e's `pf1.css` already covers it.

**This module's truth-table for v11.11**:
| Source | What it is | Trust |
|---|---|---|
| `/systems/pf1/pf1.css` + `pf1.js` | Installed bundle Foundry actually loads. | ✅ Ground truth. |
| `/systems/pf1/templates/items/spell.hbs` | Reference template — the spell sheet is the gold standard. | ✅ Copy structurally. |
| `pf1-source/` (symlinked as `pf1/`) | Dev-branch source. Used for editor autocomplete only. | ❌ Do NOT treat as runtime. |

---

## 1. The non-negotiable form skeleton

Every PF1e-aligned item sheet uses this exact outer structure:

```hbs
<form class="{{cssClass}} flexcol" autocomplete="off" data-tooltip-class="pf1">
  <header class="sheet-header flexrow"> … </header>
  <section class="sidebar"> … </section>
  <nav class="sheet-navigation tabs" data-group="primary"> … </nav>
  <section class="primary-body"> … </section>
</form>
```

**Why each piece matters**:
- `{{cssClass}}` resolves to `editable` or `locked`. PF1e gates "is this input writable" on `form.editable > .sidebar input`. Don't omit it.
- `flexcol` is harmless under PF1e's grid (the grid wins) — keep it for parity with the spell sheet.
- `data-tooltip-class="pf1"` opts every tooltip in this sheet into PF1e's tooltip theme.
- The form has no extra outer wrapper. The `header / sidebar / nav / primary-body` children **must be direct children** of the `<form>`, because PF1e's grid rule is `.pf1.sheet.item form > .sidebar { grid-row: span 2 }`. A wrapper breaks the grid silently.

**The form's classes are set in JS, not in the template.** In `defaultOptions`:
```js
classes: ["pf1", "sheet", "item"]
```
That gives the form `class="pf1 sheet item …"` and unlocks every `.pf1.sheet.item form …` rule in `pf1.css`.

### Grid contract (read-only — don't fight it)

`pf1.css:4767-4787`:
```css
.pf1.sheet.item form {
  display: grid;
  grid-template-columns: 2fr 6fr;
  grid-template-rows: min-content min-content 1fr;
}
.pf1.sheet.item form > header   { grid-column: span 2; }
.pf1.sheet.item form > .sidebar { grid-row: span 2; }
```

So the layout is:

```
┌────────────────────────────────────────────────┐
│                  sheet-header                  │  row 1, cols 1+2
├──────────────┬─────────────────────────────────┤
│              │  sheet-navigation               │  row 2, col 2
│   sidebar    ├─────────────────────────────────┤
│              │  primary-body                   │  row 3, col 2
└──────────────┴─────────────────────────────────┘
```

**Do not** add `display: flex !important` or `flex-direction: column` to the form or its direct children. This was the bug that motivated `SPELL_SHEET_ALIGNMENT_PLAN.md`.

---

## 2. The sidebar vocabulary

The sidebar is a read-only summary by convention. Its job is to surface derived/computed values; editing happens in the Details tab.

### Sidebar building blocks

```hbs
<section class="sidebar">

  <header>
    <h3 class="item-type">{{itemType}}</h3>      {{!-- localized type label --}}
    <h4 class="level">…</h4>                      {{!-- short subtitle --}}
    <h4 class="school">…</h4>                     {{!-- another short subtitle --}}
  </header>

  <ul class="property-list descriptors tags">     {{!-- tag chip group --}}
    <h5>{{localize "PF1.DescriptorPlural"}}</h5>
    <li class="property generic-tag">value</li>
  </ul>

  <label class="descriptor number">               {{!-- single number input --}}
    <span>Label</span>
    <input type="number" name="system.field" value="{{system.field}}">
  </label>

  <label class="descriptor checkbox">             {{!-- single checkbox --}}
    <input type="checkbox" name="system.flag" {{checked system.flag}}>
    <span>Label</span>
  </label>

  <div class="descriptor wrap-value">             {{!-- label + read-only value --}}
    <label>Field</label>
    <span class="value">{{system.field}}</span>
  </div>

  <div class="descriptor range-value">            {{!-- current / max input pair --}}
    <label><span>Label</span><input type="text" value="{{cur}}"></label>
    <span class="separator">/</span>
    <input type="text" value="{{max}}">
  </div>

</section>
```

### CSS that's already wired (don't redefine these)

- `pf1.css:4868-4877` — sidebar is `display: flex; flex-flow: column`, scrollable.
- `pf1.css:4899-4906` — `.item-type` gets a large small-caps heading.
- `pf1.css:4910-4928` — `label.number` and `label.checkbox` get the correct flex layout.
- `pf1.css:4944-4983` — `h5` headings, `property-list`, and `.property` chips.
- `pf1.css:4985-4992` — `.wrap-value` for label+value rows.
- `pf1.css:5029-5046` — sidebar inputs become editable only when `form.editable`.

### Sidebar rules of thumb

1. **One label per row.** Every direct child of `.sidebar` should be its own block: `<header>`, `<ul class="property-list">`, `<label class="descriptor …">`, or `<div class="descriptor …">`.
2. **Use `property-list` for groups of small read-only chips.** Use `descriptor number` / `descriptor checkbox` only for things the user can edit. (PF1e flips editability via `form.editable`.)
3. **`<h5>` inside `<ul class="property-list">` is the section heading.** It's styled into a banded mini-header automatically.
4. **Never put a clickable button (`<a>`, `<button>`) in the sidebar.** The sidebar is summary-only.

---

## 3. The action-list vocabulary

PF1e uses one canonical shape for any list of editable child entries (actions, changes, links, script-calls). It's defined in `templates/items/parts/item-actions.hbs`.

### Action-list building blocks

```hbs
<div class="actions">                              {{!-- semantic wrapper --}}
  <ol class="item-list action-parts">              {{!-- outer ol --}}

    <li class="item-list-header flexrow">          {{!-- the header bar --}}
      <div class="item-name"><h3>Title</h3></div>
      <div class="action-controls item-controls">
        <a class="action-control add-action" data-tooltip="PF1.Add">
          <i class="fa-solid fa-plus" inert></i>
        </a>
      </div>
    </li>

    <ol class="item-list">                         {{!-- inner ol holds the rows --}}
      {{#each entries}}
      <li class="item flexrow" data-entry-id="{{id}}">
        <div class="item-name">
          <div class="item-image no-hover" style='background-image: url("{{img}}")'></div>
          <h4>{{name}}</h4>
        </div>
        <div class="item-detail …">…</div>
        <div class="action-controls item-controls">
          <a class="edit-entry"   data-tooltip="PF1.Edit">  <i class="fa-solid fa-edit"   inert></i></a>
          <a class="delete-entry" data-tooltip="PF1.Delete"><i class="fa-solid fa-trash"  inert></i></a>
        </div>
      </li>
      {{/each}}
    </ol>

  </ol>
</div>
```

### CSS that's already wired

- `pf1.css:2865-2967` — `.item-list`, `.item-list-header`, `.item-name`, `.item-detail`, `.item-controls`. Header gets the bordered banner; rows get the row separators.
- `pf1.css:4868` and surrounding rules don't affect this — the action-list lives in `primary-body`, not the sidebar.

### The `inert` rule (this is what fixes the broken Add button)

Every icon inside a clickable `<a>` must have `inert`:

```hbs
<a class="add-action" data-tooltip="PF1.Add">
  <i class="fa-solid fa-plus" inert></i>     ← REQUIRED
</a>
```

Without `inert`, the inner `<i>` can capture the click (especially in some browser/theme combinations) and the `<a>`'s delegated handler never fires. **PF1e adds `inert` to every icon in `item-actions.hbs`**. Match that.

### Listener wiring — use class selectors, not `data-action`

PF1e binds by class:
```js
html.on("click", ".add-action",    this._onCreateEntry.bind(this));
html.on("click", ".delete-entry",  this._onDeleteEntry.bind(this));
html.on("click", ".edit-entry",    this._onEditEntry.bind(this));
```

**Do not use `data-action="…"` attributes** for click delegation in V1 sheets. Foundry V2 ApplicationV2 routes `data-action` clicks via its own action dispatch; mixing the V2 attribute pattern into a V1 sheet causes confusion (and on some Foundry builds the V2 dispatcher swallows the click first).

When the handler needs an id, put it on the row:
```hbs
<li class="item" data-entry-id="{{id}}">
```
Then in the handler:
```js
const id = event.currentTarget.closest("[data-entry-id]")?.dataset.entryId;
```

---

## 4. The form-body vocabulary

Inside `<section class="primary-body">`, each `<div class="tab …">` follows PF1e's form conventions:

```hbs
<div class="tab details" data-group="primary" data-tab="details">

  <h3 class="form-header">{{localize "PF1.SectionTitle"}}</h3>

  <div class="form-group">
    <label>{{localize "Field.Label"}}</label>
    <div class="form-fields">
      <input type="text" name="system.field" value="{{system.field}}">
    </div>
  </div>

  <div class="form-group select">
    <label>Choice</label>
    <div class="form-fields">
      <select name="system.choice">{{selectOptions choices selected=system.choice}}</select>
    </div>
  </div>

  <div class="form-group stacked">
    <label class="checkbox">
      <input type="checkbox" name="system.flag" {{checked system.flag}}>
      Flag label
    </label>
    <p class="hint">Optional hint text.</p>
  </div>

</div>
```

**Rules**:
- `<h3 class="form-header">` is the section divider. Don't use bare `<h3>` or `<h2>`.
- Every editable field goes inside `<div class="form-group">` with a `<label>` and `<div class="form-fields">`.
- Use `form-group stacked` for groups of checkboxes (one label per line).
- Use `form-group` (no modifier) for one row of input(s).
- `<p class="hint">` after a control is the standard helper text.

---

## 5. Instructions block (Description tab)

For "GM/runtime notes" content (different from the main description), use PF1e's `<fieldset class="instructions">`:

```hbs
<fieldset class="instructions{{#unless system.description.instructions}} placeholder{{/unless}}">
  <legend><i class="icon fa-solid fa-circle-info fa-fw"></i> {{localize "PF1.Instructions"}}</legend>
  <div class="instruction-content">
    {{editor system.description.instructions target="system.description.instructions" button=true owner=editable editable=editable}}
  </div>
</fieldset>
```

PF1e styles this at `pf1.css:4822-4861`:
- Beige border, rounded corners, max-height 8rem with overflow.
- The light-orange tint appears automatically when the fieldset contains an `.instruction-content` element with text.

---

## 6. Tabs and tab-binding (V1 sheets)

Tabs are configured in `defaultOptions`:

```js
static get defaultOptions() {
  return foundry.utils.mergeObject(super.defaultOptions, {
    classes: ["pf1", "sheet", "item"],
    width: 620,
    height: 600,
    tabs: [{
      navSelector:     "nav.sheet-navigation[data-group='primary']",
      contentSelector: "section.primary-body",
      initial:         "description",
      group:           "primary",
    }],
    scrollY:  [".tab"],
    dragDrop: [{ dragSelector: ".link-row", dropSelector: "[data-drop-category]" }],
    resizable: true,
  });
}
```

**Rules**:
- `navSelector` must point to the `<nav class="sheet-navigation tabs" data-group="primary">`.
- `contentSelector` must point to `<section class="primary-body">`.
- Each `<a>` in the nav: `<a class="item" data-tab="…" data-group="primary">Label</a>`.
- Each tab body: `<div class="tab <slug>" data-group="primary" data-tab="<slug>">…</div>`.
- The default-active tab gets `class="tab <slug> active"` AND `<a class="item active" data-tab="<slug>">`. Foundry's V1 tab binding reads the initial active state from the markup if `initial` is omitted; if `initial` is set, that wins.
- `scrollY: [".tab"]` makes each tab body remember its scroll position across re-renders.

---

## 7. Editable vs locked

The `{{cssClass}}` in the form's class resolves to either `editable` or `locked`. PF1e's selectors fan out from there:

```css
.pf1.sheet.item form.editable > .sidebar input:not(:disabled) {
  pointer-events: all;
  cursor: text;
}
```

So **don't manually add `disabled` to inputs based on permissions**. Let PF1e's `.editable` selector handle it. Just provide the same DOM regardless of permission state; PF1e renders read-only when needed.

---

## 8. Anti-patterns (the things this guide exists to prevent)

| Anti-pattern | Why it's wrong | Correct |
|---|---|---|
| `display: flex !important` on the form | Breaks PF1e's grid; sidebar collapses | Remove the override; let the grid apply |
| `class="naruto-X-sheet"` on the form for layout scope | Couples our CSS to a layout that fights PF1e | Use PF1e classes; scope by `data-type` if needed |
| `data-action="createX"` for click delegation | V2 attribute mixed into V1 — fragile | Class selector: `.add-x`, `.delete-x` |
| Icon `<i>` without `inert` inside a clickable `<a>` | Inner icon can swallow the click | Always `<i class="…" inert>` |
| Custom `.derived-stats` flex bar in the details tab | Duplicates the sidebar's job | Move derived stats to sidebar as `property-list` chips |
| Custom `<fieldset>` for checkbox grids | Reinvents `form-group stacked` | Use PF1e form-group conventions |
| Hardcoded English in templates | Won't localize | Always `{{localize "Key.Path"}}` |
| Direct child wrapper around sidebar/nav/body | Breaks the grid contract | Sidebar/nav/body are direct children of `<form>` |
| Sidebar contains clickable controls | Violates "summary-only" convention | Put controls in the Details tab |

---

## 9. Quick reference — class vocabulary cheat sheet

```
Layout
  .pf1 .sheet .item                       form classes (set in defaultOptions)
  form > header.sheet-header              top header bar
  form > section.sidebar                  left column summary
  form > nav.sheet-navigation.tabs        tab nav
  form > section.primary-body             tab content host

Sidebar
  .sidebar > header                       inner title block
  .sidebar h3.item-type                   large item-type heading
  .sidebar h5                             section heading inside list/group
  .sidebar ul.property-list.tags          chip group
  .sidebar li.property.generic-tag        single chip
  .sidebar label.descriptor.number        labeled number input
  .sidebar label.descriptor.checkbox      labeled checkbox
  .sidebar div.descriptor.wrap-value      label + read-only value
  .sidebar div.descriptor.range-value     current / max pair

Body
  div.tab                                 each tab body
  h3.form-header                          section divider
  div.form-group                          one row of form fields
  div.form-group.stacked                  vertical group (often checkboxes)
  div.form-fields                         wraps the input(s) in a form-group
  label.checkbox                          checkbox label
  fieldset.instructions                   beige instructions block

Lists
  div.actions                             semantic wrapper
  ol.item-list.action-parts               outer list
  li.item-list-header.flexrow             header bar inside an item-list
  ol.item-list                            inner row container
  li.item.flexrow                         a row
  div.item-name                           name cell (with .item-image)
  div.item-detail                         middle cell
  div.action-controls.item-controls       trailing controls cell
  a.action-control.add-action             "+" button (header)
  a.edit-action / .delete-action          row controls

Tooltips & icons
  data-tooltip-class="pf1"                opt the sheet into PF1e tooltip theme
  data-tooltip="PF1.Add"                  localized tooltip on hover
  <i class="fa-solid fa-… fa-fw" inert>   font-awesome icon — ALWAYS `inert` inside clickable parents
```

---

## 10. When in doubt

Open `/systems/pf1/templates/items/spell.hbs` and copy the structure. If the spell sheet does it that way, do it that way. If you find yourself writing CSS to override PF1e's `pf1.css`, stop and ask why — almost always the answer is "I used the wrong class".
