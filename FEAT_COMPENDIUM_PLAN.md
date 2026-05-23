# Naruto Feat Compendium — Implementation Plan

> **Status:** draft / pre-implementation
> **Pattern source:** mirrors the existing technique compendium pipeline
> (see `docs/technique-compendium-browser.md`, `docs/technique-header-buttons.md`,
> `scripts/ui/technique-browser.mjs`).
>
> **Scoping decisions (locked in with the user):**
> 1. Item type → **native PF1 `feat`** (subTypes: `feat`, `classFeat`, `trait`,
>    `racial`, `template`). No custom DataModel, no custom sheet.
> 2. Browse entry point → **second button next to PF1's** native Browse in the
>    Features tab. PF1's stock browser stays; ours opens beside it.
> 3. Automation scope → **auto-apply `changes` + auto-grant linked items**
>    (PF1's `supplements` mechanism). Prerequisite enforcement is out of scope.

---

## 1. Goal

Add a homebrew compendium of Naruto-flavored feats (`naruto-d20.feats`) shipped
inside this module, alongside a custom **NarutoFeatBrowser** that mirrors the
TechniqueCompendiumBrowser UX (Application V1, sidebar filters + searchable
list, draggable rows). The browser is opened from a new button injected into
the PF1e character-sheet Features tab, **without removing** PF1's own Browse
button.

When a feat from this pack is dropped onto an actor, two automation behaviors
should "just work" with **zero added wiring on our side**:

- **Changes** authored on the feat (`system.changes`) are applied by PF1's
  changes engine the moment the feat exists on the actor and isn't disabled.
- **Linked items** authored under `system.links.supplements` (e.g. a granted
  buff, a granted technique, a bonus skill item) are auto-created on the
  actor by PF1's `_createSupplements` pipeline (`pf1/module/documents/item.mjs`
  in the dev mirror; verified by name in the installed `pf1.js`).

The custom code we ship is therefore:
- pack metadata + pack source files
- the custom browser (UI only — same shape as the technique browser)
- the injected Browse button + its click handler

No new DataModel, no actor-sheet patch, no changes-engine wiring.

---

## 2. Why native PF1 `feat` (not a custom type)

Going native means we inherit, for free:

| Capability | Native `feat` | Custom `naruto-d20.feat` |
|---|---|---|
| Item sheet (5 tabs, changes editor, links editor, actions editor) | ✅ stock PF1 sheet | ❌ rebuild |
| Changes engine auto-application | ✅ on creation, on toggle, on `system.disabled` change | ❌ need `pf1GetChangeFlat` + per-feat target wiring |
| Linked-item grants (`supplements`) | ✅ PF1's `_createSupplements` runs on `_onCreate` | ❌ rebuild a preCreateItem hook + uuid resolver |
| Features tab grouping by `subType` | ✅ stock PF1 | ❌ rebuild the section/grouping |
| `pf1.applications.compendiumBrowser.FeatBrowser` recognizes our pack | ✅ — any pack containing `feat` items is browsable by the stock browser | ❌ FeatBrowser filters by `type === "feat"`, so a custom type is invisible |
| Compatibility with future PF1 versions | ✅ tracks PF1 schema | ❌ we own all the breakage |

The trade-off is that Naruto-only metadata can't sit in `system.*`. We park it
in module flags on each compendium feat:

```jsonc
{
  "type": "feat",
  "system": {
    "subType": "feat",
    "changes": { /* … see §6 — auto-applied */ },
    "links":   { "supplements": [ /* … see §7 — auto-granted */ ] }
  },
  "flags": {
    "naruto-d20": {
      "discipline": "Ninjutsu",     // optional, used by our browser only
      "source":     "Core Rulebook", // optional
      "tags":       ["Combat", "Stealth"]
    }
  }
}
```

Filtering on `flags.naruto-d20.*` in the browser requires asking the pack
index for those fields (see §5 — `getIndex({ fields: […] })`). We're already
doing the analogous pattern for techniques with `system.*`.

---

## 3. Pack registration

### `module.json`

Add a third entry to the `packs` array:

```jsonc
{
  "name":   "feats",
  "label":  "Naruto Feats",
  "path":   "packs/feats",
  "type":   "Item",
  "system": "pf1"
}
```

### Source folder

Mirror the technique layout:

```
packs/
  _source/
    feats/                # one JSON per feat, hand-edited
      iron-chakra.json
      hand-seal-mastery.json
      …
  feats/                  # compiled LevelDB, generated
```

Compile with PF1's tooling (the `pf1-source/` repo's `npm run packs:compile`
already understands `_source/<pack>/*.json` → `packs/<pack>` LevelDB; we use
it the same way techniques are currently compiled).

> Implementation note: confirm the existing technique workflow before
> first compile — if there's an in-repo script we use (e.g. an npm task at
> the module root), reuse it. If we currently run pf1-source's compiler
> against this module, document that in `docs/feat-compendium.md` on land.

### Single-document shape (authoring contract)

```jsonc
{
  "_id": "abcdef0123456789",          // 16-char Foundry id
  "name": "Iron Chakra",
  "type": "feat",
  "img":  "modules/naruto-d20/icons/feats/iron-chakra.webp",
  "system": {
    "subType": "feat",                 // feat | classFeat | trait | racial | template
    "abilityType": "ex",               // ex|su|sp|na — see pf1.config.abilityTypes
    "description": { "value": "<p>…</p>", "summary": "Boost chakra pool by 5." },
    "tags": ["chakra"],
    "changes": {                       // ← auto-applied; v11.11 record-form (see §6)
      "<changeId>": { "formula": "5", "target": "chakraPool", "type": "untyped", "operator": "add" }
    },
    "links": {
      "supplements": [],               // ← auto-granted; see §7
      "prerequisites": [],
      "children": []
    }
  },
  "flags": {
    "naruto-d20": { "discipline": "Ninjutsu", "source": "Core Rulebook" }
  },
  "effects": [],
  "ownership": { "default": 0 }
}
```

> **PF1 v11.11 vs dev divergence — verify before authoring:**
> `system.changes` is an **`ArrayField`** in v11.11 (per `naruto-d20/CLAUDE.md`)
> but the pf1-source mirror models it as a record. The technique source files
> already use `"changes": []` (see `packs/_source/techniques/*.json`), so we
> author feats the same way. **Run `pf1e-api-check` on `system.changes` shape
> before bulk-authoring** to avoid a costly rewrite.

---

## 4. Custom `NarutoFeatBrowser`

New file: `scripts/ui/feat-browser.mjs`.
New template: `templates/apps/feat-browser.hbs`.

Same architecture as `TechniqueCompendiumBrowser`:

- Extends **Foundry V1 `Application`** (per `CLAUDE.md` — PF1's own
  CompendiumBrowser is V1 in v11.11; AppV2 produces visual mismatch).
- `defaultOptions.classes = ["pf1", "app", "compendium-browser", "naruto-feat-browser"]`
  — inherits the sidebar/grid CSS for free.
- Private fields: `#query`, `#filters`, `#collapsed`, `#entries`, `#loading`,
  `#focusSearch` — same shape, same debounce, same focus-restore behavior.
- Constructor accepts `{ subType }` so we can pre-select e.g. `classFeat` when
  the user clicks the Browse button on the Class Features section.

### Filter groups

| Group | Index field | Choices |
|---|---|---|
| Sub-Type | `system.subType` | `Object.keys(pf1.config.featTypes)` — `feat`, `classFeat`, `trait`, `racial`, `template` |
| Discipline | `flags.naruto-d20.discipline` | `MAIN_DISCIPLINES` (from `scripts/constants.mjs`) |
| Class | `system.associations.classes` | union of all values across the pack index (OR within group, matching PF1's `FeatClassFilter.defaultBooleanOperator = OR`) |
| Ability Type | `system.abilityType` | `pf1.config.abilityTypes` keys (`na`, `ex`, `su`, `sp`) |
| Source | `flags.naruto-d20.source` | union of values across the pack |
| Tags | `flags.naruto-d20.tags` | union of values |

> Discipline / Source / Tags are flag-based. The index call must explicitly
> request them — Foundry's default index only carries `name`, `img`, `type`.

### Index loader

```js
const INDEX_FIELDS = [
  "system.subType",
  "system.abilityType",
  "system.associations.classes",
  "system.description.summary",     // displayed under the name in the row
  "flags.naruto-d20.discipline",
  "flags.naruto-d20.source",
  "flags.naruto-d20.tags",
];

const pack  = game.packs.get(`${MODULE_ID}.feats`);
const index = await pack.getIndex({ fields: INDEX_FIELDS });
```

Verify on first run that `flags.naruto-d20.*` populates on the index entries
in v11.11 (per the same caveat called out in the technique-browser doc). Fall
back to `pack.getDocuments()` if any field is missing — the pack is small
enough.

### Drag-and-drop

`<li class="directory-item" draggable="true" data-uuid="…">` + on `dragstart`
write `{ type: "Item", uuid }` to the dataTransfer. **No drop-zone code
required** — the PF1e character sheet's Features tab is already a valid drop
target for `Item`/`feat` documents (verified: stock PF1 supports dropping
feats from any compendium onto the sheet, which triggers `_createSupplements`
automatically via `Item._onCreate`).

### Clicking the entry name

Opens the compendium document's sheet (read-only). Same as TechniqueBrowser.

---

## 5. Browse-button injection (Features tab)

The PF1 v11.11 template `pf1/templates/actors/parts/actor-features.hbs` (line
34) already renders for each section:

```hbs
<a data-action="browse" data-source="{{path}}" data-tooltip="PF1.BrowseFeats">
  <i class="fa-solid fa-folder-plus" inert></i>
</a>
```

We inject a **sibling** anchor just after it, scoped to the Features tab:

```js
// scripts/ui/feat-list.mjs — runs on renderActorSheetPF
const featsBody = html[0].querySelector(".feats-body");
if (!featsBody) return;
for (const header of featsBody.querySelectorAll(".item-list-header .item-controls")) {
  if (header.querySelector(".naruto-feat-browse")) continue;        // idempotent
  const subType = header.closest("[data-subtype]")?.dataset.subtype; // pre-select
  header.insertAdjacentHTML("beforeend", `
    <a class="naruto-feat-browse item-control"
       data-tooltip="Browse Naruto Feats"
       data-subtype="${subType ?? ""}">
      <i class="fa-solid fa-scroll" inert></i>
    </a>
  `);
}
featsBody.querySelectorAll(".naruto-feat-browse").forEach((a) => {
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const subType = ev.currentTarget.dataset.subtype || undefined;
    new NarutoFeatBrowser({ subType }).render(true);
  });
});
```

A different Font Awesome icon (`fa-scroll`) keeps our button visually distinct
from PF1's `fa-folder-plus`. Tooltip is hardcoded in English for parity with
the rest of the module's UI strings.

**Why `renderActorSheetPF` and not a `_renderInner` patch:** the Chakra tab
needed the `_renderInner` patch because the tab `<a>` had to be in place
*before* the V1 Tabs binder ran. The Features tab is built by PF1, so the
controls already exist on first render — a post-render injection is enough,
and it's far less invasive than patching `_renderInner`.

> Hook idempotency: PF1 re-renders sheets frequently. The `if
> (header.querySelector(".naruto-feat-browse")) continue;` guard prevents
> the button from being appended N times across re-renders.

---

## 6. Auto-application of `changes` — viability analysis

**Verdict: fully viable with no new code.** PF1's changes engine already does
this for any item with `system.changes` that lives on an actor and isn't
disabled. The flow:

1. Feat dropped onto actor → `Item._onCreate` runs.
2. Actor data prep runs (`pf1PrepareBaseActorData` → `pf1PrepareDerivedActorData`).
3. Changes engine walks every active item, collects `system.changes`, looks
   each `target` up in `CONFIG.PF1.buffTargets` + the `pf1GetChangeFlat` hook,
   and writes the resulting value to the resolved path.
4. The Naruto module already participates in step 3 via `flag-paths.mjs` —
   `BUFF_TARGETS` maps `chakraPool`, `chakraReserve`, `learnCkc/gnj/nin/tai/fui`
   (and the perform/save-DC targets added later) to their flag paths.

So a feat carrying:

```jsonc
"changes": [
  { "formula": "5", "target": "chakraPool",  "type": "untyped", "operator": "add" },
  { "formula": "2", "target": "learnNin",    "type": "racial",  "operator": "add" }
]
```

…automatically grants +5 Chakra Pool and +2 Ninjutsu learn check the moment
it's on the actor, with **no module-side code change**.

### Edge cases — call out in `docs/feat-compendium.md`

1. **Toggle support.** PF1's feat row UI exposes a disable toggle
   (`system.disabled = true`). When disabled, the changes engine skips that
   item — so the player can switch feat effects off without removing the
   item. This is native behavior, just worth documenting.
2. **`isActive` & subType.** `FeatModel._activeStateChange` ties active state
   to `!system.disabled`. `prepareBaseData` defaults `disabled` to `false`, so
   a freshly-dropped feat is active out of the box.
3. **Targets that don't exist yet.** Any new Naruto buff target referenced
   from a feat must be present in `BUFF_TARGETS` (`flag-paths.mjs`) *before*
   the feat is loaded. Authoring discipline: keep the list of available
   targets in the compendium-feat authoring doc and update it when
   `BUFF_TARGETS` grows.
4. **Conditional changes.** If a feat needs a conditional bonus (e.g. "+1
   attack vs. flat-footed"), that goes in an `ItemAction`'s `conditionals`
   array, not in `system.changes`. The feat's `system.actions` array is the
   correct home for those — PF1's stock feat sheet has the "Actions" tab for
   editing them.

### Verification before bulk authoring

Run the `pf1e-api-check` skill on these symbols (per project rule in
`naruto-d20/CLAUDE.md`):

- `pf1.config.featTypes`
- `pf1.config.abilityTypes`
- `pf1.applications.compendiumBrowser.FeatBrowser` (we don't call it, but the
  grep hit in `pf1.js` suggested this is the v11.11 namespace; lock it in)
- `pf1.documents.item.ItemPF._onCreate` ↔ `_createSupplements` (for §7)
- `system.changes` schema shape on `feat` items (array vs record)

---

## 7. Auto-granting linked items — viability analysis

**Verdict: also viable with no new code, via PF1's `supplements` mechanism.**

PF1's dev mirror (`pf1-source/module/documents/item.mjs`, lines ~560–670)
defines `_createSupplements`: when an item is created on an actor, it reads
`system.links.supplements` (an array of `{ uuid, level? }`), resolves each
UUID via `fromUuid`, and creates the referenced items on the same actor in
the same operation. Recursive (up to depth 3, cap 100). The installed `pf1.js`
contains the string `supplements` — confirm the same code path is live in
v11.11 with `pf1e-api-check` before committing to this design.

### Authoring contract

To make "Hand Seal Mastery" auto-grant a buff toggle and a free technique:

```jsonc
"links": {
  "supplements": [
    { "uuid": "Compendium.naruto-d20.technique-buffs.Item.<buffId>" },
    { "uuid": "Compendium.naruto-d20.techniques.Item.<techniqueId>" }
  ]
}
```

The drop produces 3 items on the actor in one operation: the feat itself,
the buff, and the technique. Both inherit `flags.pf1.source = <originalUuid>`
so PF1 knows they came from this feat.

### Edge cases

1. **Removing the feat does not remove its supplements.** PF1 treats
   supplements as "grant once, manage manually." If we want feat-removal to
   cascade (likely desired for clean play), we need a thin `preDeleteItem`
   hook that finds embedded items whose `flags.pf1.source` matches the
   deleted feat's UUID and deletes them too. **This is one of two pieces of
   custom code worth writing** — call it `scripts/automation/feat-grants.mjs`.
2. **Level-gated grants.** `supplements` entries with `level` are reserved
   for classes (PF1 fires them from `_onLevelChange`). For feats, leave
   `level` off — the supplement creates immediately on drop.
3. **Same supplement granted by two feats.** PF1's collector keys by uuid
   and bumps `count` — for non-physical items this means N copies are
   created. Document this gotcha; if it bites us, the de-dup logic is also
   in `feat-grants.mjs`.
4. **Granted technique vs. drop-on-Chakra-tab path.** Techniques granted
   this way bypass `scripts/ui/technique-list.mjs` drop handler, so anything
   that handler does *beyond* the standard create-item call (currently:
   nothing) must move into the technique's own `_onCreate` or a hook to stay
   consistent. As of this writing, the drop handler is a thin wrapper around
   `actor.createEmbeddedDocuments` — so we're fine.

### What we don't get for free

- **Prerequisite enforcement** (e.g. "requires Str 13 + BAB +1"). PF1 stores
  prereqs in `system.links.prerequisites` for *display* only; nothing
  enforces them on drop. The user explicitly scoped this out — skipped.

---

## 8. File-by-file change list

New:

| File | Purpose |
|---|---|
| `packs/_source/feats/*.json` | Authored feat documents (one per file) |
| `packs/feats/` | Compiled LevelDB pack (generated, gitignored *except* CURRENT/LOCK/LOG?) — confirm what the technique pack does. |
| `scripts/ui/feat-browser.mjs` | `NarutoFeatBrowser` (Application V1) |
| `templates/apps/feat-browser.hbs` | Browser layout |
| `scripts/ui/feat-list.mjs` | `renderActorSheetPF` hook — inject the Browse button + listener |
| `scripts/automation/feat-grants.mjs` | `preDeleteItem` cascade — removes supplements when their parent feat is deleted (optional but recommended; see §7 edge case 1) |
| `docs/feat-compendium.md` | Per-feature doc summarising the above |

Edited:

| File | Change |
|---|---|
| `module.json` | Add the `feats` pack entry |
| `scripts/main.mjs` | Register the feat-browser template in `loadTemplates`; call `registerFeatListListeners()` from the `setup` hook |
| `lang/en.json`, `lang/pt-BR.json` | Optional — only if we move Browse-button tooltip / browser title strings out of hardcoded English |

---

## 9. Manual verification (post-implementation)

No build step (ESM loaded directly). `Ctrl+R` in-world or `F5` after edits.

1. `module.json` change → reload → `game.packs.get("naruto-d20.feats")`
   returns a `CompendiumCollection`.
2. Open a character sheet → Features tab → each section header shows
   **two** Browse buttons (PF1's `fa-folder-plus`, ours `fa-scroll`). PF1's
   still opens `pf1.applications.compendiumBrowser.FeatBrowser` with the full
   feat set; ours opens the `NarutoFeatBrowser`.
3. Ours opens pre-filtered to the section's `subType` (e.g. clicking from
   the Class Features section pre-selects `classFeat`).
4. Filter by Discipline (a flag-only field) returns the expected entries —
   confirms `getIndex({ fields: [...flags...] })` populates.
5. Drag a feat with `system.changes = [{ formula: "5", target: "chakraPool", … }]`
   onto the sheet → Chakra Pool max increases by 5, sourceInfo lists the
   feat by name. Toggle the feat off via PF1's row toggle → bonus disappears.
   Toggle on → bonus returns.
6. Drag a feat with two `supplements` (one buff, one technique) → the actor
   gains all 3 items, the buff is visible in Buffs, the technique appears on
   the Chakra tab. Each granted item carries `flags.pf1.source` pointing
   back to the originating feat's UUID.
7. Delete the feat → if `feat-grants.mjs` is enabled, the buff and technique
   are removed too. Without it, they remain (intended trade-off).
8. PF1's native feat compendium and FeatBrowser are unaffected (regression
   check).

---

## 10. Open questions

1. **Pack compilation pipeline.** Confirm whether this module currently
   compiles `packs/_source/techniques/*.json` via `pf1-source/`'s
   `npm run packs:compile` or via some module-root tooling. The feat pack
   needs to ride the same train. If undocumented, add a `docs/` note as
   part of this PR.
2. **`docs/feat-compendium.md` placement.** Match the existing convention:
   write the implementation doc into `docs/` after merge, keeping this
   `FEAT_COMPENDIUM_PLAN.md` at repo root only until the work lands (same
   lifecycle as `JUTSU_COMPENDIUM_PLAN.md` and `TABS_IMPLEMENTATION_PLAN.md`).
3. **Initial feat list.** What feats actually ship in v1 of the pack? The
   authoring effort dwarfs the engineering effort — recommend a short list
   (10–20 feats) for the first release, then expand.
4. **`flags.naruto-d20.tags` taxonomy.** Define the tag vocabulary up front
   (e.g. "Chakra", "Stealth", "Combat", "Genjutsu") so authors don't drift.
   Source the list from `MAIN_DISCIPLINES` + a small extension list, stored
   alongside `constants.mjs`.
