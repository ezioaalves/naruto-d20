# Adding Custom Tabs to pf1 Actor Sheets

Reference notes for anyone (human or agent) extending the pf1 actor sheet with
a new top-level tab on this project. Documents the runtime environment, the
trap that the chakra-tab bug fell into three times, and the working approach.

## Runtime environment (verify before assuming anything)

- **Foundry source of truth:** `~/Documents/Foundry13/public/scripts/foundry.mjs`
- **Installed pf1 system:** `Data/systems/pf1/system.json` — currently **11.11**, which is **V1 ApplicationV1**, not ApplicationV2.
  - Sheet class chain at runtime: `ActorSheetPFCharacter → ActorSheetPF → ActorSheet → DocumentSheet → FormApplication → Application` (all V1).
  - Actor sheet classes are under `pf1.applications.actor.*` — e.g. `pf1.applications.actor.ActorSheetPF`. **Not** `pf1.applications.ActorSheetPF` (that key does not exist).
- **Reference repo:** `Data/modules/foundryvtt-pathfinder1/` is the **upstream dev tip migrated to V2**. Its API does **not** match what is loaded at runtime. Use only for cross-checking that a method exists by name; never for reasoning about behavior.

If you ever see `new Application (foundry.mjs:...)` / `new FormApplication (foundry.mjs:...)` / `new ActorSheet (foundry.mjs:...)` deprecation traces in the console, that confirms V1 is in use.

## How pf1 11.11 renders the character sheet

Template at `Data/systems/pf1/templates/actors/character-sheet.hbs`:

- Nav `<a>` list is **hard-coded** (no `{{#each tabs.primary}}` iteration).
- Content `<div class="tab X" data-group="primary" data-tab="X">` blocks are **hard-coded**.
- Therefore: **pushing to `cls.TABS.primary.tabs` is a no-op.** That's a V2 mechanism and the template doesn't read it.

`ActorSheetPF._renderInner` (overridden by pf1, calls `super._renderInner`) returns the full new inner HTML as jQuery on every render. `_replaceHTML` (`foundry.mjs:37552`) then wipes the window-content and inserts the new HTML — anything injected via `renderActorSheetPF` from a previous render is gone.

## V1 render flow (foundry.mjs:37369–37406, read these line numbers)

```
1. inner = await this._renderInner(data)         // returns jQuery of full inner HTML
2. this._replaceHTML(element, html)              // jQuery .html() swap — wipes old DOM
3. this._activateCoreListeners(inner)            // runs this._tabs.forEach(t => t.bind(content))
4.   → Tabs.bind                                  // foundry.mjs:36867
5.     → this.activate(this.active)               // foundry.mjs:36879
6.       → Tabs.activate(tabName)                 // foundry.mjs:36892
7.         valid = items.some(i => i.dataset.tab === tabName)
8.         if (!valid) tabName = items[0].dataset.tab    // ← FALLBACK to "summary"
9.         this.active = tabName                         // ← state overwritten
10. this.activateListeners(inner)                // pf1 subclass listeners
11. this._callHooks("render", html, data)        // renderActorSheetPF fires HERE
```

**The trap:** if your custom tab `<a>` is missing from the nav at step 3, step 8 silently rewrites `_tabs[0].active` to `"summary"`. By the time `renderActorSheetPF` fires at step 11 you cannot un-do the corruption without fighting the framework's own state.

This is why the user reports "I edit a chakra field, the sheet snaps back to Summary." The form change triggers a re-render; `_tabs[0].active` was `"chakra"` going in, but step 8 rewrites it to `"summary"` before our hook ever gets a chance to react.

## What does not work (verified by commits 31e6d12, c20e8c9, 055cb0b)

| Approach | Why it fails |
|---|---|
| Inject the `<a>` + content `<div>` in a `renderActorSheetPF` hook | Hook fires at step 11. By then `_tabs[0].active` has already been overwritten by step 8. |
| Track active state in a `WeakSet`, then `app._tabs[0].active = "chakra"` post-render + manually toggle `.active` classes | "Fixes" the immediate render but the WeakSet stays out of sync with click intent; previous renders' click handlers race with the framework, and forcing `.active` on nav buttons makes other tabs feel locked. |
| `cls.TABS.primary.tabs.push({ id: "chakra", … })` in the `setup` hook | No-op on V1 — the template doesn't iterate `tabs.primary`. The setup hook in `scripts/main.mjs:103-107` is harmless dead code under V1 (kept in case pf1 upgrades). |
| `app._tabs[0].activate("chakra")` after our render-hook injection | Works, but you've already had one frame where Summary briefly flashed, and you're now mutating framework state in a hook — fragile. |

## What does work — patch `_renderInner`

Inject the chakra nav and content **inside `_renderInner`**, so the framework's own tab-binding step (step 3 above) sees a valid chakra entry and `Tabs.activate("chakra")` succeeds normally — no fallback, no state corruption.

Reference implementation: `scripts/ui/chakra-tab.mjs`. Shape of the patch:

```javascript
const original = pf1.applications.actor.ActorSheetPF.prototype._renderInner;
pf1.applications.actor.ActorSheetPF.prototype._renderInner = async function (...args) {
    const $html = await original.apply(this, args);
    if (!["character", "npc"].includes(this.actor.type)) return $html;

    const nav = $html.find("nav.sheet-navigation.tabs[data-group='primary']");
    if (nav.length && !nav.find('[data-tab="chakra"]').length) {
        nav.append('<a class="item" data-tab="chakra" data-group="primary">Chakra</a>');
    }

    const body = $html.find("section.primary-body");
    if (body.length && !body.find('[data-tab="chakra"]').length) {
        const tplData = { ...args[0], flags: this.actor.flags || {} };
        const tplHtml = await foundry.applications.handlebars.renderTemplate(
            "modules/naruto-d20/templates/actor/chakra-tab.hbs",
            tplData
        );
        body.append(tplHtml);
    }

    return $html;
};
```

Key details:

- Patch `pf1.applications.actor.ActorSheetPF.prototype`, **not** the concrete subclasses (Character, NPC, NPCLite). Subclasses' `_renderInner` calls `super._renderInner(...e)`, so wrapping the parent covers them all.
- Install the patch **once** during `Hooks.once("setup", …)` — `pf1.applications.ActorSheetPF` is set by then. Track installation with a module-level boolean to be idempotent against hot reloads.
- Don't add `data-action="tab"` on the nav `<a>`. That's V2 attribute syntax. V1's `Tabs._onClickNav` (`foundry.mjs:36929`) finds the click target via `closest("[data-tab]")` — `data-tab` alone is sufficient.
- Don't add `.active` to your nav `<a>` or content `<div>` manually. The framework's `Tabs.activate` (step 5 above) toggles `.active` based on `this.active`. Just provide valid DOM and let it work.
- Content visibility comes from Foundry's CSS `foundry2.css:5390` — `.tab[data-tab]:not(.active) { display: none }`. As long as the framework sets `.active` correctly, your tab shows.
- The render hook (`renderActorSheetPF`) is still the right place for **listeners that need a live, in-DOM sheet** — e.g. attaching click handlers to roll buttons in the chakra content. Just don't do DOM injection there.

## Buff/flag wiring (orthogonal but adjacent)

The chakra tab is a flag-backed feature, not a system-data feature:

- Reads: `actor.flags["naruto-d20"].*` (initialized in `pf1PrepareBaseActorData`).
- Buff targets: registered in `pf1PostInit` (`CONFIG.PF1.buffTargets`), mapped to flag paths in `pf1GetChangeFlat`. Bonuses land at flag paths between base and derived prep.
- See `scripts/main.mjs` and `scripts/data/derived-data.mjs` for the full hook pipeline.

The tab patch is purely a presentation-layer fix and doesn't touch any of that.

## Debugging tips

- Console default filter hides `console.debug`. Switch the DevTools console level to **Verbose** to see debug logs, or use `console.log` for one-off diagnostics.
- To inspect the current tab state: `game.actors.getName("…").sheet._tabs[0].active`. This is the V1 source of truth.
- To force a render in the console: `game.actors.getName("…").sheet.render(true)`.

## If pf1 upgrades to V2 in the future

The V2 tip in `Data/modules/foundryvtt-pathfinder1/` already iterates `@root.tabs.primary` in its character-sheet template and routes clicks via `data-action="tab"`. Migration steps would be:

1. Replace the `_renderInner` patch with a `setup`-time push to `cls.TABS.primary.tabs` for each character/npc sheet class (the dead code currently in `scripts/main.mjs:96–107` is already this).
2. Replace the `renderActorSheetPF` hook with one that injects only the chakra content `<div>` (the V2 template still hard-codes content divs; only nav iterates). Set `.active` iff `app.tabGroups.primary === "chakra"`.

Don't pre-emptively write code for this — wait until the system actually ships V2.
