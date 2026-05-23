# Technique Sheet — Spell-Sheet Alignment Plan

**Goal**: rework the Technique item sheet so it looks and behaves like PF1e v11.11's spell sheet (`/systems/pf1/templates/items/spell.hbs`), and fix the broken Action button as part of the same pass.

**Pre-reqs read first**: `PF1E_SHEET_PATTERN.md` (the style guide).

**Files involved**:
- `templates/item/technique-sheet.hbs`
- `styles/naruto-d20.css`
- `scripts/ui/technique-sheet.mjs`

**Strategy**: adopt PF1e's HTML class vocabulary so we inherit PF1e's CSS automatically. Keep the homebrew data model (`system.actions` array, `system.tags`, `system.flags.*`, link arrays). Do not extend `ItemSheetPF` — bare `ItemSheet` continues to be the V1 baseline.

Each phase ends with a verification step. **Reload Foundry (F5) and confirm the verification passes before moving to the next phase.**

---

## Phase 1 — Sidebar parity

### 1.1 Template — replace the sidebar block

**File**: `templates/item/technique-sheet.hbs`

**Delete** lines 33-89 (the current `<section class="sidebar">` block).

**Insert** in its place:

```hbs
{{!-- ── Sidebar ─────────────────────────────────────────────────────── --}}
<section class="sidebar">
  <header>
    <h3 class="item-type">{{itemType}}</h3>
    <h4 class="discipline">{{system.discipline}}</h4>
    <h4 class="rank-line">{{localize "NarutoD20.Technique.Rank.Label"}} {{system.rank}} · {{system.complexity}}</h4>
  </header>

  <ul class="property-list stats tags">
    <h5>{{localize "NarutoD20.Technique.Type.Label"}}</h5>
    <li class="property generic-tag">Learn DC {{derived.learnDC}}</li>
    <li class="property generic-tag">Perform DC {{derived.performDC}}</li>
    <li class="property generic-tag">Threshold {{derived.skillThreshold}}</li>
    <li class="property generic-tag">Successes {{derived.successes}}</li>
  </ul>

  <label class="descriptor number">
    <span>{{localize "NarutoD20.Technique.ChakraCost.Label"}}</span>
    <input type="number" name="system.chakraCost" value="{{system.chakraCost}}" min="0">
  </label>

  {{#if hasComponents}}
  <ul class="property-list components tags">
    <h5>{{localize "NarutoD20.Technique.Components.Legend"}}</h5>
    {{#if system.compHandSeals}}    <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.HandSeals.Label"}}</li>{{/if}}
    {{#if system.compHalfSeals}}    <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.HalfSeals.Label"}}</li>{{/if}}
    {{#if system.compConcentration}}<li class="property generic-tag">{{localize "NarutoD20.Technique.Components.Concentration.Label"}}</li>{{/if}}
    {{#if system.compMobility}}     <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.Mobility.Label"}}</li>{{/if}}
    {{#if system.compFocus}}        <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.MaterialFocus.Label"}}</li>{{/if}}
    {{#if system.compEmpower}}      <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.Empower.Label"}}</li>{{/if}}
    {{#if system.compMastery}}      <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.Mastery.Label"}}</li>{{/if}}
    {{#if system.compExpendable}}   <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.Expendable.Label"}}</li>{{/if}}
    {{#if system.compPhysical}}     <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.PhysicalHealth.Label"}}</li>{{/if}}
    {{#if system.compXpCost}}       <li class="property generic-tag">{{localize "NarutoD20.Technique.Components.XpCost.Label"}}</li>{{/if}}
  </ul>
  {{/if}}
</section>
```

### 1.2 No CSS changes in this phase

The new markup uses only PF1e classes (`item-type`, `property-list`, `property generic-tag`, `descriptor number`). PF1e's own CSS at `pf1.css:4868-5046` handles all sidebar styling.

### 1.3 Verification

1. Reload Foundry.
2. Open any Technique item.
3. The sidebar shows: large "Technique" item-type heading, discipline + rank line, four derived-stat chips, an editable Chakra Cost field, optional Components chip row.
4. Chips wrap and have rounded-square shape matching the spell sheet.
5. The Chakra Cost input is editable; the four stat chips are read-only.

---

## Phase 2 — Action list parity (fixes the broken Add button)

### 2.1 Template — replace the Details-tab actions block

**File**: `templates/item/technique-sheet.hbs`

**Delete** the current actions block in the Details tab (currently `<h3 class="form-header">{{localize "PF1.ActionPlural"}}</h3>` through the `</div>` that closes the "Add Action" form-group, roughly lines 74-96 after Phase 1).

**Insert** in its place:

```hbs
{{!-- Actions list — uses PF1e's standard item-list shape --}}
<div class="actions">
  <ol class="item-list action-parts">
    <li class="item-list-header flexrow">
      <div class="item-name"><h3>{{localize "PF1.ActionPlural"}}</h3></div>
      <div class="action-controls item-controls">
        <a class="action-control add-action" data-tooltip="PF1.Add">
          <i class="fa-solid fa-plus" inert></i>
        </a>
      </div>
    </li>
    <ol class="item-list">
      {{#each actions}}
      <li class="action-part item flexrow" data-action-id="{{id}}">
        <div class="item-name">
          <div class="item-image no-hover" style='background-image: url("{{img}}")'></div>
          <input type="text" name="system.actions.{{@index}}.name" value="{{name}}">
        </div>
        <div class="item-detail item-notes">
          <input type="text" name="system.actions.{{@index}}.notes" value="{{notes}}" placeholder="Notes / formula…">
        </div>
        <div class="action-controls item-controls">
          <a class="delete-action" data-tooltip="PF1.Delete"><i class="fa-solid fa-trash" inert></i></a>
        </div>
      </li>
      {{/each}}
    </ol>
  </ol>
</div>
```

### 2.2 JS — rebind listeners to class selectors

**File**: `scripts/ui/technique-sheet.mjs`

In `activateListeners(html)` (currently lines ~111-135), **replace**:

```js
html.on("click", "[data-action='createAction']", this._onCreateAction.bind(this));
html.on("click", "[data-action='deleteAction']", this._onDeleteAction.bind(this));
```

**with**:

```js
html.on("click", ".add-action",    this._onCreateAction.bind(this));
html.on("click", ".delete-action", this._onDeleteAction.bind(this));
```

`_onCreateAction` and `_onDeleteAction` themselves do not need changes — `_onDeleteAction` already reads `event.currentTarget.closest("[data-action-id]")`, and the new row carries `data-action-id="{{id}}"`.

### 2.3 CSS — drop the homebrew action-list rules

**File**: `styles/naruto-d20.css`

**Delete** the entire block starting at the comment `Technique Sheet — Actions list` and including all `.naruto-technique-sheet .technique-actions-list*` rules (currently lines ~170-216).

PF1e's CSS at `pf1.css:2865-2967` styles `.item-list-header`, `.item-list`, `.action-part`, `.item-name`, `.action-controls` for free because our form already carries `pf1 sheet item` classes.

### 2.4 Verification

1. Reload Foundry.
2. Open a Technique. Go to Details tab.
3. The actions list has a bordered header bar reading "Actions" with a `+` icon on the right.
4. **Click the `+` icon — a new "New Action" row appears.** This is the bug fix.
5. The new row has an image, an editable name input, an editable notes input, and a trash icon on the right.
6. Clicking the trash icon removes the row.
7. Hovering the controls shows the "Add" / "Delete" tooltips.

---

## Phase 3 — Details tab cleanup

### 3.1 Template — remove the duplicate components fieldset

**File**: `templates/item/technique-sheet.hbs`

**Delete** the entire `<fieldset class="technique-components-fieldset">…</fieldset>` block in the Details tab (the block containing the 10 component checkboxes wrapped in a custom fieldset).

**Insert** in its place a PF1e-style form-group:

```hbs
<h3 class="form-header">{{localize "NarutoD20.Technique.Components.Legend"}}</h3>

<div class="form-group stacked">
  <label class="checkbox">
    <input type="checkbox" name="system.compHandSeals" {{checked system.compHandSeals}}>
    {{localize "NarutoD20.Technique.Components.HandSeals.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compHalfSeals" {{checked system.compHalfSeals}}>
    {{localize "NarutoD20.Technique.Components.HalfSeals.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compConcentration" {{checked system.compConcentration}}>
    {{localize "NarutoD20.Technique.Components.Concentration.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compMobility" {{checked system.compMobility}}>
    {{localize "NarutoD20.Technique.Components.Mobility.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compFocus" {{checked system.compFocus}}>
    {{localize "NarutoD20.Technique.Components.MaterialFocus.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compEmpower" {{checked system.compEmpower}}>
    {{localize "NarutoD20.Technique.Components.Empower.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compMastery" {{checked system.compMastery}}>
    {{localize "NarutoD20.Technique.Components.Mastery.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compExpendable" {{checked system.compExpendable}}>
    {{localize "NarutoD20.Technique.Components.Expendable.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compPhysical" {{checked system.compPhysical}}>
    {{localize "NarutoD20.Technique.Components.PhysicalHealth.Label"}}
  </label>
  <label class="checkbox">
    <input type="checkbox" name="system.compXpCost" {{checked system.compXpCost}}>
    {{localize "NarutoD20.Technique.Components.XpCost.Label"}}
  </label>
</div>
```

### 3.2 Template — add the Active toggle in the Details tab

**Insert** at the top of the Details tab (just after the opening `<div class="tab details" …>`):

```hbs
<div class="form-group stacked">
  <label class="checkbox">
    <input type="checkbox" name="system.active" {{checked system.active}}>
    {{localize "NarutoD20.Technique.Active"}}
  </label>
  <p class="hint">{{localize "NarutoD20.Technique.ActiveHint"}}</p>
</div>
```

This is the toggle previously removed when the Changes tab was deleted.

### 3.3 CSS — drop the custom components-fieldset rules

**File**: `styles/naruto-d20.css`

**Delete** the entire block under the comment `Technique Sheet — Components fieldset`:
- `.technique-components-fieldset`
- `.technique-components-fieldset legend`
- `.technique-components-grid`
- `.component-entry`
- `.component-entry input[type="checkbox"]`
- `.component-entry label`
- `.comp-abbrev`

### 3.4 Verification

1. Reload Foundry. Open a Technique. Go to Details tab.
2. The components section now uses standard PF1e checkbox labels, one per line.
3. Toggling a component checkbox in the Details tab updates the chip in the sidebar live (after re-render).
4. The "Active" toggle appears at the top of the Details tab and persists across reloads.

---

## Phase 4 — Description tab parity

### 4.1 Template — replace `<details>` with PF1e's `<fieldset class="instructions">`

**File**: `templates/item/technique-sheet.hbs`

**Find** the `<details class="naruto-instructions">…</details>` block in the Description tab.

**Replace** with:

```hbs
<fieldset class="instructions{{#unless system.description.instructions}} placeholder{{/unless}}">
  <legend><i class="icon fa-solid fa-circle-info fa-fw"></i> {{localize "PF1.Instructions"}}</legend>
  <div class="instruction-content">
    {{editor system.description.instructions target="system.description.instructions" button=true owner=editable editable=editable}}
  </div>
</fieldset>
```

### 4.2 CSS — drop the homebrew instructions rules

**File**: `styles/naruto-d20.css`

**Delete** the block under the comment `Technique Sheet — Description tab`:
- `.naruto-technique-sheet .naruto-instructions`
- `.naruto-technique-sheet .naruto-instructions summary`
- `.naruto-technique-sheet .naruto-instructions[open] summary`

PF1e's `pf1.css:4822-4861` provides the beige border, icon legend, max-height with overflow scroll, and the orange tint when there is content.

### 4.3 Verification

1. Reload Foundry. Open a Technique. Go to Description tab.
2. The Instructions block has a beige border with a `<legend>` showing the info icon + "Instructions" label.
3. Adding content tints the background light orange.

---

## Phase 5 — Links tab parity

### 5.1 Template — add `inert` to icon children

**File**: `templates/item/technique-sheet.hbs`

In the Links tab, the link-row delete button is:
```hbs
<a class="control delete-link" data-action="deleteLink" data-category="{{../key}}" data-tooltip="PF1.Delete">
  <i class="fa-solid fa-trash fa-fw" inert></i>
</a>
```

This already has `inert` — leave as-is.

### 5.2 JS — rebind to class selector

**File**: `scripts/ui/technique-sheet.mjs`

In `activateListeners(html)`, **replace**:
```js
html.on("click", "[data-action='deleteLink']", this._onDeleteLink.bind(this));
```
**with**:
```js
html.on("click", ".delete-link", this._onDeleteLink.bind(this));
```

`_onDeleteLink` reads `event.currentTarget.dataset.category` — keep the `data-category` attribute on the `<a>` in the template.

### 5.3 Verification

1. Reload Foundry. Open a Technique. Go to Links tab.
2. Drag any item from a compendium or sidebar into a link category — the entry appears.
3. Click the trash icon — the entry is removed.
4. Click the entry name — the linked item's sheet opens.

---

## Phase 6 — Advanced tab parity

### 6.1 Template — wrap tag chips in PF1e's `item-properties` shape

**File**: `templates/item/technique-sheet.hbs`

For the **Tags** block, **replace** the existing `<ul class="naruto-tag-list">…</ul>` with:

```hbs
<ul class="item-properties tags-list">
  {{#each tagList}}
  <li class="property generic-tag" data-tag="{{this}}">
    <span>{{this}}</span>
    <a class="delete-tag" data-tag="{{this}}" data-tooltip="PF1.Delete">
      <i class="fa-solid fa-times" inert></i>
    </a>
  </li>
  {{/each}}
  <li class="property add-tag">
    <input type="text" class="add-tag-input" placeholder="{{localize 'NarutoD20.Technique.AddTagPlaceholder'}}">
  </li>
</ul>
```

Do the same for **Boolean Flags** (class names `bflags-list`, `delete-bflag`, `add-bflag-input`) and **Dictionary Flags** (class names `dflags-list`, `delete-dflag`, `add-dflag`).

### 6.2 JS — rebind handlers

**File**: `scripts/ui/technique-sheet.mjs`

In `activateListeners(html)`, **replace** the `data-action` selectors with class selectors:

```js
// Tags
html.on("keydown", ".add-tag-input", this._onAddTag.bind(this));
html.on("click",   ".delete-tag",    this._onDeleteTag.bind(this));

// Boolean flags
html.on("keydown", ".add-bflag-input",        this._onAddBooleanFlag.bind(this));
html.on("click",   ".delete-bflag",           this._onDeleteBooleanFlag.bind(this));

// Dictionary flags
html.on("click",   ".add-dflag",              this._onCreateDictionaryFlag.bind(this));
html.on("click",   ".delete-dflag",           this._onDeleteDictionaryFlag.bind(this));
html.on("change",  ".dflag-key, .dflag-value", this._onEditDictionaryFlag.bind(this));
```

Update the inner CSS class on inputs in `_onAddTag` / `_onAddBooleanFlag`: they currently read `.naruto-tag-input` / `.naruto-bflag-input`. The new selectors above match — no body change needed beyond the listener selector.

### 6.3 CSS — drop the homebrew tag/flag rules

**File**: `styles/naruto-d20.css`

**Delete** the entire block under the comment `Technique Sheet — Advanced tab`:
- `.naruto-technique-sheet .naruto-tag-list, .naruto-bflag-list, .naruto-dflag-list`
- `.naruto-technique-sheet .naruto-tag, .naruto-bflag`
- `.naruto-technique-sheet .naruto-tag .tag-control, .naruto-bflag .tag-control`
- `.naruto-technique-sheet .naruto-tag-input, .naruto-bflag-input`
- `.naruto-technique-sheet .naruto-dflag-list`
- `.naruto-technique-sheet .naruto-dflag`
- `.naruto-technique-sheet .naruto-dflag .dflag-key`
- `.naruto-technique-sheet .naruto-dflag .dflag-value`
- `.naruto-technique-sheet .naruto-dflag .tag-control`

PF1e's `pf1.css:4601-4605` styles `.item-properties` and chips.

### 6.4 Verification

1. Reload Foundry. Open a Technique. Go to Advanced tab.
2. Tags / Boolean flags / Dictionary flags render as PF1e-styled chips.
3. Typing a tag and pressing Enter adds it; clicking the × removes it.
4. The Dictionary Flag `+` link adds a new key/value pair.

---

## Phase 7 — Form-level cleanup

### 7.1 Template — drop the `naruto-technique-sheet` class, add the PF1e tooltip hint

**File**: `templates/item/technique-sheet.hbs`

**Replace** the opening form tag:
```hbs
<form class="{{cssClass}} naruto-technique-sheet" autocomplete="off">
```
**with**:
```hbs
<form class="{{cssClass}} flexcol" autocomplete="off" data-tooltip-class="pf1">
```

The `flexcol` is kept for parity with `spell.hbs:1` (it's harmless under PF1e's grid). `data-tooltip-class="pf1"` makes PF1e style its tooltips consistently with the spell sheet.

### 7.2 CSS — final pass

**File**: `styles/naruto-d20.css`

After Phases 2-6 there should no longer be any selector beginning with `.naruto-technique-sheet`. **Search the file for `.naruto-technique-sheet` and remove any remaining rule.** Verify the file now contains only:
- `.naruto-tai-setting` (settings tab)
- `#naruto-hero-statistics`, `.naruto-summary-stats*` (summary tab)
- `.tab.chakra`, `.chakra .*` (chakra tab)

### 7.3 JS — confirm tab selectors still match

**File**: `scripts/ui/technique-sheet.mjs`

Confirm `defaultOptions.tabs[0]` still reads:
```js
navSelector:     "nav.sheet-navigation[data-group='primary']",
contentSelector: "section.primary-body",
```
Both already match the template. No change needed.

### 7.4 Verification

1. Reload Foundry. Open a Technique.
2. Sheet layout, sidebar, action list, links, advanced tab all match the spell sheet's visual style.
3. No `naruto-technique-sheet` class on the form (inspect with DevTools).
4. Tabs switch correctly. Description / Details / Links / Advanced all render.
5. Action `+` button creates a new action. Action `🗑` button deletes one.
6. Link `🗑`, tag `×`, dictionary `+`/`×` all work.
7. Hover tooltips on `Add` / `Delete` / etc. render in PF1e's tooltip style.

---

## Rollback

Each phase touches at most three files and is independent. To revert a phase:
- `git diff -- templates/item/technique-sheet.hbs styles/naruto-d20.css scripts/ui/technique-sheet.mjs`
- `git checkout -- <file>` for the file(s) you want to revert.

No data migration is performed in any phase — schema is unchanged. Existing technique items continue to work after every phase.

---

## Known non-goals

- **Not** adopting PF1e `ItemAction` instances. Our `system.actions` stays a plain array of `{id, name, img, notes}` rows.
- **Not** extending `ItemSheetPF`. The bare V1 `ItemSheet` is the deliberate baseline.
- **Not** changing the data model. All schema fields stay where they are; the only effect is presentation and listener wiring.
