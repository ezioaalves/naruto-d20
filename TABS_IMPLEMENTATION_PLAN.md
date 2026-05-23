# Technique Sheet Tabs — Implementation Plan

> **Branch:** `damage-techniques`
> **Order of work:** This plan runs **before** `IMPLEMENTATION_PLAN.md`
> (actions + perform flow). The Description / Changes / Links / Advanced
> tabs depend on schema fields that come from `pf1.models.item.ActionItemModel`,
> so the model switch is a hard prerequisite for everything here.
> **Scope:** Make all five tabs functional. Details tab is already working
> and is unchanged in this plan; the actions / Use button work lives in
> `IMPLEMENTATION_PLAN.md` and follows this one.

---

## 1. Current state vs target

| Tab | Today | Target |
|---|---|---|
| **Description** | Single ProseMirror editor bound to `system.description` (top-level HTMLField string). | Summary + header info + main rich-text editor + GM instructions. Same shape PF1e spells use. |
| **Details** | Working: actions list (stub), derived stats, config fields, components grid. | **Unchanged in this plan.** Actions list gets rebuilt in `IMPLEMENTATION_PLAN.md`. |
| **Changes** | Static placeholder paragraph. | Real change-effect editor: create / edit / delete rows. Each row binds to a buff target with a formula and modifier type. Optional active-toggle on the technique itself. |
| **Links** | Static placeholder paragraph. | Drag-drop targets for prerequisites / supplements / children. Each link shows name + img + delete. |
| **Advanced** | One free-text tags input. | Identifier slug, tags set, quickbar/combat toggles, item flags (boolean + dictionary). |

---

## 2. Prerequisite — switch the data model to `pf1.models.item.ActionItemModel`

This is the same model switch §3 of `IMPLEMENTATION_PLAN.md` proposes,
pulled forward because the tabs need the fields it brings in:

- `description: SchemaField({value, summary, instructions})` — for the Description tab
- `changes` (via the BaseItemModel changes factory) — for the Changes tab
- `links: {children, supplements}` — for the Links tab
- `tag`, `tags`, `flags: {boolean, dictionary}`, `showInQuickbar`, `showInCombat` — for the Advanced tab
- `actions` — used later by `IMPLEMENTATION_PLAN.md`

Implementation is identical to `IMPLEMENTATION_PLAN.md §3` — same factory,
same `migrateData` (string → object description, drop legacy `activation`,
homebrew actions array → record). Re-described here only for ordering.

**Acceptance after this step:** All five tabs render without console
errors. Description tab still shows the editor (now pointed at
`system.description.value`). Other three tabs still show placeholders.

---

## 3. Description tab

### What it needs to do

Match PF1e's spell-description layout, three vertically stacked regions:

```
┌─────────────────────────────────────────────────┐
│ Summary  ┃ one-line text shown in chat cards    │ ← input bound to system.description.summary
├─────────────────────────────────────────────────┤
│                                                 │
│  [ rich-text ProseMirror editor              ]  │ ← bound to system.description.value
│  [ description body                          ]  │
│                                                 │
├─────────────────────────────────────────────────┤
│ ▾ GM Instructions (collapsible)                │ ← bound to system.description.instructions
│   [ rich-text editor, hidden from players    ]  │
└─────────────────────────────────────────────────┘
```

### Schema impact

Nothing new — comes from `BaseItemModel`:

```js
description: SchemaField({
    value:        HTMLField,
    summary:      StringField,
    instructions: HTMLField,
})
```

### Template changes (`templates/item/technique-sheet.hbs`)

Replace the current Description tab body with:

```hbs
<div class="tab description active" data-tab="description" data-group="primary">

  <div class="form-group">
    <label>{{localize "PF1.Summary"}}</label>
    <div class="form-fields">
      <input type="text"
             name="system.description.summary"
             value="{{system.description.summary}}"
             placeholder="{{localize 'PF1.NoSummary'}}"
             data-tooltip="PF1.SummaryTooltip">
    </div>
  </div>

  <h3 class="form-header">{{localize "PF1.Description"}}</h3>
  <div class="editor">
    {{editor enrichedDescription target="system.description.value"
             button=true owner=editable engine="prosemirror"}}
  </div>

  <details class="naruto-instructions {{#if system.description.instructions}}has-content{{/if}}">
    <summary>{{localize "PF1.Instructions"}}</summary>
    <div class="editor">
      {{editor enrichedInstructions target="system.description.instructions"
               button=true owner=editable engine="prosemirror"}}
    </div>
  </details>
</div>
```

### `getData` additions

```js
context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description?.value ?? "", { secrets: item.isOwner, relativeTo: item }
);
context.enrichedInstructions = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description?.instructions ?? "", { secrets: item.isOwner, relativeTo: item }
);
```

### Why instructions in a `<details>`

PF1e shows instructions in a separate fieldset with a yellow background.
For a V1 sheet we get the same affordance with a `<details>` element — no
JS needed for the collapse, sticks open if it has content.

### CSS additions (`styles/naruto-d20.css`)

```css
.naruto-technique-sheet .naruto-instructions {
    border: 1px solid #c0b89a;
    border-radius: 4px;
    padding: 4px 8px;
    margin-top: 8px;
    background: hsl(38deg 100% 50% / 8%);
}
.naruto-technique-sheet .naruto-instructions summary {
    cursor: pointer;
    font-weight: 600;
    color: #6b5020;
    user-select: none;
}
.naruto-technique-sheet .naruto-instructions[open] summary { margin-bottom: 6px; }
```

### Acceptance

- Summary input persists across re-renders.
- Main description editor still works (was working before; just retargeted to `.value`).
- Instructions collapsible: starts collapsed if empty, expanded if it has content.
- Chat cards that read `system.description.summary` now have something to pull.

---

## 4. Changes tab

### What it needs to do

Editable list of `pf1.models.components.Change` rows. Each row:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Target [select]   Operator [add/set]  Formula [input]  Type [select]  🗑  │
└──────────────────────────────────────────────────────────────────────────┘
```

Plus an `Active` toggle at the top of the tab — when off, changes don't
apply to the actor. (Same idea as PF1e buff items' `system.active`.)

### Schema impact

`changes` already exists in `BaseItemModel` via the changes factory — it's
a `TypedObjectField(EmbeddedDataField(pf1.models.components.Change))`.

Add **one** new field for the active state:

```js
// In TechniqueDataModel.defineSchema():
active: new BooleanField({ ...opt, initial: false }),
```

### Hook integration

PF1e's changes engine already picks up changes from items via the
`pf1PrepareDerivedActorData` hook chain. The relevant check is whether
the item is "active". For buffs that's `system.active`; for techniques
we need to teach PF1e about ours.

Easiest path: add a hook that excludes our technique's changes when
`!system.active`. PF1e's changes engine iterates `actor.changes` after
collecting from all items — we can filter at item collection time.

Concrete: hook `pf1GatherChanges` (PF1e fires this during actor data prep)
and short-circuit our items when inactive. If that hook doesn't exist,
fallback is to override `item.changes` on the document to be empty when
inactive.

Reference for the right hook to use: search `pf1-source/module/documents/actor.mjs` for `getChanges` / `gatherChanges` /
`pf1GatherChanges` before writing code.

### Template changes

```hbs
<div class="tab changes" data-tab="changes" data-group="primary">

  <div class="form-group stacked">
    <label class="checkbox">
      <input type="checkbox" name="system.active" {{checked system.active}}>
      {{localize "NarutoD20.Technique.Active"}}
    </label>
    <p class="hint">Changes below apply to the bearer only while this technique is Active.</p>
  </div>

  <ol class="technique-changes-list">
    {{#each changes}}
    <li class="change-row" data-change-id="{{id}}">
      <select class="change-target" data-field="target">
        {{selectOptions @root.buffTargetChoices selected=target}}
      </select>
      <select class="change-operator" data-field="operator">
        <option value="add" {{#if (eq operator "add")}}selected{{/if}}>+</option>
        <option value="set" {{#if (eq operator "set")}}selected{{/if}}>=</option>
      </select>
      <input type="text" class="change-formula" data-field="formula" value="{{formula}}" placeholder="0">
      <select class="change-type" data-field="type">
        {{selectOptions @root.bonusTypeChoices selected=type}}
      </select>
      <a class="change-control" data-action="deleteChange" title="Delete">
        <i class="fa-solid fa-trash"></i>
      </a>
    </li>
    {{else}}
    <li class="info placeholder">No changes defined.</li>
    {{/each}}
  </ol>

  <div class="form-group">
    <a class="action-control" data-action="createChange">
      <i class="fa-solid fa-plus"></i> Add Change
    </a>
  </div>
</div>
```

### `getData` additions

```js
context.changes = Array.from(item.changes ?? []).map((ch) => ({
    id:       ch.id,
    target:   ch.target,
    operator: ch.operator,
    formula:  ch.formula,
    type:     ch.type,
}));

context.buffTargetChoices = _flattenBuffTargets(pf1.config.buffTargets);
context.bonusTypeChoices  = pf1.config.bonusTypes;
```

`_flattenBuffTargets` produces a flat `{key: "Label"}` map (PF1e's targets
are categorized, but `<select>` wants a flat list — or use `<optgroup>`
if we want categories preserved).

### `activateListeners` additions

```js
html.on("click",  "[data-action='createChange']", this._onCreateChange.bind(this));
html.on("click",  "[data-action='deleteChange']", this._onDeleteChange.bind(this));
html.on("change", ".change-row [data-field]",    this._onChangeFieldEdit.bind(this));
```

Handlers follow the same `system.changes.<id>` update pattern as the actions
handlers in `IMPLEMENTATION_PLAN.md §6`.

### CSS additions

```css
.naruto-technique-sheet .technique-changes-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    border: 1px solid #c0b89a;
    border-radius: 4px;
    overflow: hidden;
}
.naruto-technique-sheet .change-row {
    display: grid;
    grid-template-columns: 2fr 0.5fr 1fr 1.2fr auto;
    gap: 6px;
    align-items: center;
    padding: 4px 6px;
    border-bottom: 1px solid #c0b89a;
}
.naruto-technique-sheet .change-row:last-child { border-bottom: none; }
.naruto-technique-sheet .change-row > * { min-width: 0; }
.naruto-technique-sheet .change-row .change-control { color: #5a4830; cursor: pointer; }
.naruto-technique-sheet .technique-changes-list .placeholder {
    padding: 8px; color: #6b6050; font-style: italic; text-align: center;
}
```

### Acceptance

- Toggling Active → off makes the change effects stop applying on the actor (verify by reading `actor.system.skills.<x>.total` or attack bonus before/after).
- Creating a change row persists across reload.
- Changing target/operator/formula/type via the dropdowns updates the source.
- Deleting removes the row.
- Empty state shows the placeholder.

### Defer

- Conditional modifiers (PF1e's `system.changes.<id>.conditional`). Too much UI for v1.
- Priority field. Defaults to 0.
- Per-change subTarget detail picker (the "skill" subtarget would need a second dropdown). Punt until needed.

---

## 5. Links tab

### What it needs to do

Three categorized drop zones:

```
┌─────────────────────────────────────────────────┐
│ Prerequisites                                   │
│ ⬇ Drop a technique/feat here                    │
│ • [img] Body Flicker         ✕                  │
│ • [img] Chakra Reserve I     ✕                  │
├─────────────────────────────────────────────────┤
│ Supplements                                     │
│ ⬇ Drop an item here                             │
│ • [img] Hand Seal Reference  ✕                  │
├─────────────────────────────────────────────────┤
│ Children                                        │
│ ⬇ Drop a technique here                         │
│ • (none)                                        │
└─────────────────────────────────────────────────┘
```

### Schema impact

- `links.{children, supplements}` already exists in BaseItemModel as
  `ArrayField(EmbeddedDataField(pf1.models.components.LinkModel))`.
- "Prerequisites" doesn't exist in PF1e — add a `links.prerequisites`
  sub-field via our own augmentation, or repurpose `links.supplements`
  and tag the link with a category. Simpler: extend our schema:

```js
// In TechniqueDataModel.defineSchema(), after the super spread:
const baseLinks = super.defineSchema({ subType: "technique" }).links;
// Replace links with augmented version
links: new fields.SchemaField({
    ...baseLinks.fields,
    prerequisites: new fields.ArrayField(
        new fields.EmbeddedDataField(pf1.models.components.LinkModel),
        { required: false }
    ),
}),
```

(Or: instead of forking the schema, encode prerequisite-ness as a tag on
each link entry. Less invasive but messier UI.)

### Template changes

```hbs
<div class="tab links" data-tab="links" data-group="primary">

  {{#each linkCategories}}
  <section class="link-category" data-category="{{key}}">
    <header>
      <h3 class="form-header">{{localize label}}</h3>
      <p class="hint">{{localize hint}}</p>
    </header>

    <ol class="technique-links-list" data-drop-category="{{key}}">
      {{#each entries}}
      <li class="link-row" data-link-id="{{id}}" data-uuid="{{uuid}}">
        <img class="link-img" src="{{img}}" width="24" height="24">
        <span class="link-name">{{name}}</span>
        <a class="link-control" data-action="deleteLink" data-category="{{../key}}" title="Remove">
          <i class="fa-solid fa-trash"></i>
        </a>
      </li>
      {{else}}
      <li class="info placeholder">Drop a document here.</li>
      {{/each}}
    </ol>
  </section>
  {{/each}}
</div>
```

### `getData` additions

```js
const linkCat = (key, label, hint) => ({
    key, label, hint,
    entries: (system.links?.[key] ?? []).map((l) => ({
        id:   l.id ?? l._id,
        uuid: l.uuid,
        name: l.name,
        img:  l.img,
    })),
});

context.linkCategories = [
    linkCat("prerequisites", "NarutoD20.Links.Prerequisites.Label", "NarutoD20.Links.Prerequisites.Hint"),
    linkCat("supplements",   "PF1.Links.supplements.Label",          "PF1.Links.supplements.Hint"),
    linkCat("children",      "PF1.Links.children.Label",             "PF1.Links.children.Hint"),
];
```

### Drag-drop wiring

V1 ItemSheet's `defaultOptions` already supports `dragDrop`. Add the drop
selector and implement `_onDrop`:

```js
// defaultOptions
dragDrop: [{ dragSelector: ".link-row", dropSelector: "[data-drop-category]" }],
```

```js
async _onDrop(event) {
    const category = event.target.closest("[data-drop-category]")?.dataset.dropCategory;
    if (!category) return;

    const data = TextEditor.getDragEventData(event);   // v13: foundry.applications.ux.TextEditor.implementation.getDragEventData
    const doc  = await fromUuid(data.uuid);
    if (!doc) return;
    if (!(doc instanceof Item)) return ui.notifications.warn("Only items can be linked.");

    const existing = this.item.system.links?.[category] ?? [];
    if (existing.some((e) => e.uuid === doc.uuid)) return;     // dedupe

    const newEntry = {
        _id:  foundry.utils.randomID(8),
        uuid: doc.uuid,
        name: doc.name,
        img:  doc.img,
    };
    await this.item.update({
        [`system.links.${category}`]: [...existing, newEntry],
    });
}
```

```js
async _onDeleteLink(ev) {
    ev.preventDefault();
    const row = ev.currentTarget.closest(".link-row");
    const category = ev.currentTarget.dataset.category;
    const id  = row?.dataset.linkId;
    const existing = this.item.system.links?.[category] ?? [];
    await this.item.update({
        [`system.links.${category}`]: existing.filter((e) => (e.id ?? e._id) !== id),
    });
}
```

Also bind `[data-action='deleteLink']` in `activateListeners`.

### Click-to-open behavior

```js
html.on("click", ".link-row .link-name", async (ev) => {
    const uuid = ev.currentTarget.closest(".link-row")?.dataset.uuid;
    const doc  = uuid ? await fromUuid(uuid) : null;
    doc?.sheet?.render(true);
});
```

### CSS additions

```css
.naruto-technique-sheet .link-category { margin-bottom: 12px; }
.naruto-technique-sheet .link-category header { margin-bottom: 4px; }
.naruto-technique-sheet .link-category .hint {
    font-size: 0.85em; color: #6b6050; margin: 0 0 6px; font-style: italic;
}
.naruto-technique-sheet .technique-links-list {
    list-style: none; margin: 0; padding: 0;
    border: 1px dashed #c0b89a; border-radius: 4px;
    min-height: 40px;
}
.naruto-technique-sheet .link-row {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 6px; border-bottom: 1px solid #c0b89a;
}
.naruto-technique-sheet .link-row:last-child { border-bottom: none; }
.naruto-technique-sheet .link-row .link-img { flex: 0 0 24px; border-radius: 3px; }
.naruto-technique-sheet .link-row .link-name { flex: 1; cursor: pointer; }
.naruto-technique-sheet .link-row .link-name:hover { text-decoration: underline; }
.naruto-technique-sheet .technique-links-list .placeholder {
    padding: 8px; color: #6b6050; font-style: italic; text-align: center;
}
```

### Acceptance

- Drag a feat from the items sidebar onto Prerequisites → row appears with name + img.
- Drag the same item twice → no duplicate.
- Click the name → that item's sheet opens.
- Trash icon → removes the link.
- Persists across reload.
- Drag a non-Item document (e.g. an Actor) → warning notification.

### Defer

- Cross-actor link resolution (e.g. on a character's copy of the technique, show the actor-local prerequisite item if owned). v1 just links by world UUID.
- Drag-to-reorder rows.
- "Apply on add" automatic application of supplements to the actor on equip.

---

## 6. Advanced tab

### What it needs to do

Five sections, each backed by a field already in our schema:

```
┌─────────────────────────────────────────────────┐
│ Identifier   [ slug-input          ]            │ ← system.tag
├─────────────────────────────────────────────────┤
│ Tags         [+] taijutsu  fire-style  ✕        │ ← system.tags (Set)
├─────────────────────────────────────────────────┤
│ Boolean flags [+]                               │ ← system.flags.boolean (Set)
│   ☑ ranged-attack  ☑ requires-line-of-sight     │
├─────────────────────────────────────────────────┤
│ Dictionary flags [+]                            │ ← system.flags.dictionary (Object)
│   chakraType = fire    ✕                        │
│   handSealCount = 4    ✕                        │
├─────────────────────────────────────────────────┤
│ ☑ Show in Quickbar      ☑ Show in Combat        │ ← system.showInQuickbar, system.showInCombat
└─────────────────────────────────────────────────┘
```

### Schema impact

Nothing new — all five fields come from `BaseItemModel` / `ActionItemModel`:

- `tag: StringField` — single identifier slug
- `tags: SetField(StringField)` — free-form labels
- `flags: SchemaField({boolean: SetField(StringField), dictionary: ObjectField})`
- `showInQuickbar: BooleanField`
- `showInCombat: BooleanField`

### Template changes

```hbs
<div class="tab advanced" data-tab="advanced" data-group="primary">

  <div class="form-group">
    <label>{{localize "PF1.Identifier"}}</label>
    <div class="form-fields">
      <input type="text" name="system.tag" value="{{system.tag}}"
             placeholder="auto-derived from name"
             pattern="[a-zA-Z0-9_-]+"
             data-tooltip="PF1.IdentifierTooltip">
    </div>
  </div>

  <div class="form-group stacked">
    <label>{{localize "PF1.Tags"}}</label>
    <ul class="naruto-tag-list" data-field="system.tags">
      {{#each tagList}}
      <li class="naruto-tag" data-tag="{{this}}">
        {{this}}
        <a class="tag-control" data-action="deleteTag" data-tag="{{this}}">
          <i class="fa-solid fa-times"></i>
        </a>
      </li>
      {{/each}}
      <li class="naruto-tag-add">
        <input type="text" class="naruto-tag-input" placeholder="add tag, enter to save">
      </li>
    </ul>
  </div>

  <div class="form-group stacked">
    <label>{{localize "PF1.BooleanFlags"}}</label>
    <ul class="naruto-bflag-list">
      {{#each booleanFlags}}
      <li class="naruto-bflag" data-flag="{{this}}">
        ☑ {{this}}
        <a class="tag-control" data-action="deleteBooleanFlag" data-flag="{{this}}">
          <i class="fa-solid fa-times"></i>
        </a>
      </li>
      {{/each}}
      <li class="naruto-bflag-add">
        <input type="text" class="naruto-bflag-input" placeholder="add flag">
      </li>
    </ul>
  </div>

  <div class="form-group stacked">
    <label>{{localize "PF1.DictionaryFlags"}}</label>
    <ul class="naruto-dflag-list">
      {{#each dictionaryFlags}}
      <li class="naruto-dflag" data-key="{{key}}">
        <input type="text" class="dflag-key"   value="{{key}}"   data-prev="{{key}}" data-field="key">
        <span>=</span>
        <input type="text" class="dflag-value" value="{{value}}" data-key="{{key}}" data-field="value">
        <a class="tag-control" data-action="deleteDictionaryFlag" data-key="{{key}}">
          <i class="fa-solid fa-times"></i>
        </a>
      </li>
      {{/each}}
      <li class="naruto-dflag-add">
        <a class="action-control" data-action="createDictionaryFlag"><i class="fa-solid fa-plus"></i> Add</a>
      </li>
    </ul>
  </div>

  <div class="form-group stacked">
    <label class="checkbox">
      <input type="checkbox" name="system.showInQuickbar" {{checked system.showInQuickbar}}>
      {{localize "PF1.Quickbar"}}
    </label>
    <label class="checkbox">
      <input type="checkbox" name="system.showInCombat" {{checked system.showInCombat}}>
      {{localize "PF1.QuickCombat"}}
    </label>
  </div>
</div>
```

### `getData` additions

```js
context.tagList         = Array.from(system.tags ?? []);
context.booleanFlags    = Array.from(system.flags?.boolean ?? []);
context.dictionaryFlags = Object.entries(system.flags?.dictionary ?? {})
                                .map(([key, value]) => ({ key, value }));
```

### `activateListeners` additions

```js
html.on("keydown", ".naruto-tag-input",   this._onAddTag.bind(this));
html.on("click",   "[data-action='deleteTag']", this._onDeleteTag.bind(this));

html.on("keydown", ".naruto-bflag-input", this._onAddBooleanFlag.bind(this));
html.on("click",   "[data-action='deleteBooleanFlag']", this._onDeleteBooleanFlag.bind(this));

html.on("click",   "[data-action='createDictionaryFlag']", this._onCreateDictionaryFlag.bind(this));
html.on("click",   "[data-action='deleteDictionaryFlag']", this._onDeleteDictionaryFlag.bind(this));
html.on("change",  ".dflag-key, .dflag-value",            this._onEditDictionaryFlag.bind(this));
```

Handler patterns are mechanical: read current source value, add/remove,
write back. Spelled-out implementations omitted from this plan — straight
SetField / ObjectField updates.

### CSS additions

```css
.naruto-tag-list, .naruto-bflag-list, .naruto-dflag-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-flow: row wrap; gap: 4px;
    border: 1px solid #c0b89a; border-radius: 4px; padding: 6px;
    min-height: 32px;
}
.naruto-tag, .naruto-bflag {
    display: inline-flex; align-items: center; gap: 4px;
    background: #5a4830; color: #f5e6c8;
    padding: 2px 6px; border-radius: 12px; font-size: 0.85em;
}
.naruto-tag .tag-control, .naruto-bflag .tag-control { color: #f5e6c8; cursor: pointer; }
.naruto-tag-input, .naruto-bflag-input { flex: 1 1 80px; min-width: 60px; }
.naruto-dflag-list { flex-flow: column nowrap; }
.naruto-dflag { display: flex; align-items: center; gap: 6px; }
.naruto-dflag .dflag-key   { flex: 0 0 30%; }
.naruto-dflag .dflag-value { flex: 1; }
```

### Acceptance

- Identifier saves on blur.
- Pressing Enter in the tag input adds a chip; empty / duplicate inputs are ignored.
- ✕ on a tag removes it.
- Boolean flags work the same way.
- Dictionary flag rows: changing the key renames the dictionary entry; changing the value persists.
- Quickbar / Combat toggles persist.

### Defer

- Script calls editor. PF1e's `scriptCalls` field is on our schema but the UI is a heavy app — defer.
- Source attribution editor (`system.sources`). Same reason.
- Predefined boolean-flag picker (PF1e config provides known flags). For v1 we just allow arbitrary strings.

---

## 7. Cross-cutting infrastructure

### New helpers in `scripts/ui/technique-sheet.mjs`

- `_actionId(ev)` — already in `IMPLEMENTATION_PLAN.md`. Generalize to a generic `_rowId(ev, attr)` shared by all four tabs (actions, changes, links, flags).
- `_flattenBuffTargets(targets)` — flatten PF1e's nested `pf1.config.buffTargets` for the Changes tab `<select>`. Use `<optgroup>` per category if possible.
- `_updateSetField(path, op, value)` — utility for adding/removing from a SetField via `item.update`.

### Localization keys to add (`lang/en.json`)

```
NarutoD20.Technique.Active               = "Active"
NarutoD20.Links.Prerequisites.Label      = "Prerequisites"
NarutoD20.Links.Prerequisites.Hint       = "Other techniques or feats that must be learned first."
NarutoD20.Tabs.Description               = (or reuse PF1.Description)
... etc
```

Where PF1e already has a key (`PF1.Description`, `PF1.Identifier`,
`PF1.Tags`, `PF1.Quickbar`, `PF1.QuickCombat`, `PF1.BooleanFlags`,
`PF1.DictionaryFlags`, `PF1.Summary`, `PF1.Instructions`,
`PF1.Links.supplements.Label`, `PF1.Links.children.Label`), reuse it.

---

## 8. Build sequence

Each step independently testable. Match the verification text to in-browser behavior before moving on.

### Step 1 — Model switch + Description tab rebind
- Switch `TechniqueDataModel` to extend `pf1.models.item.ActionItemModel`.
- Add `migrateData`.
- Update Description tab template to use `system.description.value`, add summary input + collapsible instructions.
- Add `enrichedDescription` / `enrichedInstructions` to `getData`.
- **Acceptance:** Sheet renders all 5 tabs. Description editor works, summary input persists, instructions collapsible toggles correctly.

### Step 2 — Advanced tab
- Wire identifier, tags chip-list, boolean flags chip-list, dictionary flags, quickbar/combat toggles.
- **Acceptance:** All five sections persist values; chip add/remove works; dictionary key rename works.

### Step 3 — Links tab
- Add `links.prerequisites` to the schema (if going the schema-fork path).
- Add three drop zones in the template + drop handler + delete + click-to-open.
- **Acceptance:** Drag any item onto Prerequisites/Supplements/Children — it appears with correct name/img, opens on click, deletes on trash icon, dedupes by UUID.

### Step 4 — Changes tab (data model only)
- Add `system.active` BooleanField.
- Render the changes list.
- Wire create / delete / per-field edit.
- **Acceptance:** Changes persist across reload. The data is structurally correct (verifiable via `item.system.changes` in console).

### Step 5 — Changes tab (engine integration)
- Find the right PF1e hook (`pf1GatherChanges` or alternative) to filter our changes when `!system.active`.
- Hook it.
- **Acceptance:** With Active=on and a change `+2 to attack`, the bearer's attack bonus increases by 2. Toggle Active=off → bonus disappears. Verify via `actor.system.attributes.bab` or relevant stat.

### Step 6 — Polish pass
- CSS spot-fixes after seeing all four tabs together.
- Localization keys.
- **Acceptance:** No raw `NarutoD20.*` keys visible in the rendered sheet; layout consistent across tabs.

---

## 9. Out of scope (cross-references)

- **Actions sub-list** in the Details tab — covered by `IMPLEMENTATION_PLAN.md`, scheduled after this plan completes.
- **Use button + perform pipeline + chakra deduction** — same plan, same ordering.
- **Compendium / starter techniques** — separate effort.

---

## 10. Open risks

1. **`pf1GatherChanges` (or whatever the correct hook is) may not exist
   under that exact name.** Need to verify against `pf1-source/module/documents/actor.mjs` before writing
   Step 5. If no equivalent hook exists, fall back to overriding
   `getChanges()` on a custom Item document class — but that's a heavier
   refactor (we'd need our own item document class instead of just a
   DataModel sub-type registration).
2. **`pf1.models.components.LinkModel` shape.** The schema augmentation
   for prerequisites assumes the LinkModel accepts `{uuid, name, img}`.
   Verify against `pf1-source/module/models/components/link-model.mjs`
   before writing Step 3.
3. **`system.tag` collision.** PF1e auto-derives `tag` from the item name
   when blank. Our migration sets it as optional; verify it doesn't
   collide with PF1e's auto-derive logic.
4. **`<details>` element form-data submission.** V1 `FormApplication`
   serializes inputs on change. Inputs inside `<details>` should
   serialize normally, but verify the instructions editor persists when
   it's collapsed.
