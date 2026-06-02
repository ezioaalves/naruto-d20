# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this module does

Foundry VTT module for a Naruto D20 homebrew expansion on top of Pathfinder 1e (PF1e). It adds:
- A custom `Technique` item type with its own sheet and data model
- Chakra Pool and Chakra Reserve resources tracked in actor flags
- 5 Naruto discipline "learn check" skills (ckc, gnj, nin, tai, fui) injected into PF1e's skill system
- A Chakra tab on the actor sheet, and Hero Statistics injected into the Summary tab
- 4 elemental damage types (Earth, Water, Wind, Holy)
- Buff targets for chakra resources and learn checks that plug into PF1e's changes engine
- Technique learning, Tap Reserves, Chakra conditions, custom Technique/Feat browsers, Synckit sync, and weapon-attack techniques
- Buff automation: on a successful technique perform, look up a same-named buff in the `naruto-d20.technique-buffs` compendium or configured custom packs and apply/refresh it on the resolved targets, inheriting the triggering action's duration

## Development cycle

No build step. Files are ESM loaded directly by Foundry VTT.

Foundry runs in Docker (`/home/ezioaalves/Documents/foundry/docker-compose.yml`) with `./foundrydata` bind-mounted — **do not restart Docker to pick up changes**. The container already reads files from your local disk.

1. Edit source files.
2. Reload in the browser: `F5` for a full page reload, or `Ctrl+R` in-world for a lighter module-only reload that re-fires all module hooks without reloading the whole page.

## PF1e version pinning — IMPORTANT

The installed system is **PF1e v11.11** at `/systems/pf1/`. There is also a
**`pf1-source/` filesystem mirror** symlinked as `pf1/` — that mirror is the
**dev branch** and uses API paths that don't exist in v11.11. Mixing them
ships broken code.

| Source | What it is | Trust for v11.11 |
|---|---|---|
| `/systems/pf1/pf1.js` + `lang/en.json` (installed system) | The bundle Foundry actually loads. | ✅ Ground truth. |
| context7 `/websites/foundryvtt_pathfinder1e_gitlab_io_foundryvtt-pathfinder1` | TypeDoc-generated API reference from the published docs site. Matches v11.11 class names (`pf1.components.ItemChange`, etc.). | ✅ Primary API reference. |
| context7 `/gitlab_foundryvtt_pathfinder1e/foundryvtt-pathfinder1` | Help pages + curated llms.txt from the master (stable) branch. | ✅ Complementary — usage patterns / cookbook. |
| `pf1/` → `../pf1-source/` (filesystem symlink) | **Dev branch source.** Used for editor autocomplete only. | ❌ Do NOT treat as API spec. Paths like `pf1.models.components.Change` only exist here. |

**Before referencing any `pf1.*` global, `CONFIG.PF1.*` key, `system.*` field,
or `"PF1.*"` i18n key, invoke the `pf1e-api-check` skill (`.claude/skills/`)
to verify it exists in v11.11.** Or delegate to the `pf1e-api-verifier`
subagent (`.claude/agents/`) for batch verification.

Known divergences are documented in the skill file. A few to keep in mind:
- `pf1.components.ItemChange` (NOT `pf1.models.components.Change` — that's the dev-only path)
- `system.changes` is an `ArrayField` in v11.11, not a `TypedObjectField` record
- i18n keys are mostly flat in v11.11 (e.g. `PF1.Changes`, not `PF1.Changes.many`)
- Actor sheet classes are `pf1.applications.ActorSheetPFCharacter` etc., not `pf1.applications.actor.CharacterSheetPF`

## Application class — V1 vs V2

**Default to `Application` (V1)** for any new Foundry application class.
PF1e's own apps (`CompendiumBrowser`, actor sheets, item sheets) all extend `Application` (V1).
Using `ApplicationV2` when the parent system uses V1 causes visual mismatches: different window
chrome HTML (title bar colour/font, close button, resize handle), Foundry v13's V2 base CSS
overrides checkbox `appearance` producing solid black checkboxes instead of OS-default white,
and V2 button colour resets produce unreadable white text on dark backgrounds.

**Before reaching for `HandlebarsApplicationMixin(ApplicationV2)`**, grep `pf1.js` for the
equivalent native PF1e class and confirm it uses V2. Only use V2 if:
- The equivalent pf1 class explicitly extends V2 (confirmed by grepping
  `/Users/joelfmjr/foundrydata/Data/modules/pf1/pf1.js`), **or**
- There is a concrete requirement (e.g. named PARTS partial re-rendering) that V1 cannot meet.

## Context7 docs

Library IDs (all v11.11-aligned unless noted):
- `foundryvtt_api_v13` — Foundry core API
- `foundryvtt_pathfinder1e_gitlab_io_foundryvtt-pathfinder1` — PF1e API class reference (primary)
- `gitlab_foundryvtt_pathfinder1e/foundryvtt-pathfinder1` — PF1e help guides & cookbook

## Hook lifecycle (execution order)

The numbered comments in `scripts/main.mjs` are authoritative. The sequence matters because PF1e's data pipeline has hard dependencies:

| Hook | What we do |
|------|-----------|
| `init` [1] | Register `TechniqueDataModel`, route techniques through `ItemPF`, register `TechniqueItemSheet`, preload templates, register settings |
| `pf1PostInit` [2] | Register buff targets in `CONFIG.PF1` (not available before this), register Naruto skills, script-call categories, Technique DC / `@cl` patches, Chakra conditions |
| `pf1PrepareBaseActorData` [3] | Init flag schema on actor, reset computed fields to 0 so the changes engine writes onto a clean slate; seed skill entries |
| `pf1GetChangeFlat` [4] | Map buff target keys (`chakraPool`, `learnCkc`, …) to their flag paths so the changes engine knows where to write |
| `pf1PrepareDerivedActorData` [5] | Compute all totals (chakra max, learn check totals, elemental resistance) after the changes engine has committed buff values |
| `pf1RegisterDamageTypes` [6] | Register Earth/Water/Wind/Holy elemental damage types |
| `setup` [7] | Install sheet/header patches, register Chakra tab/listeners, browsers, learn card menu, Summary stats, Tap Reserves, and automation hooks |
| `preCreateActor` [8] | Seed default flag values (`actionPoints`, `reputation`, `wealth`) on new actors |
| `ready` [9] | GM-only one-time migrations for actor flags, technique action IDs, and learned-state backfill |
| `pf1ActorRest` [10] | Recover chakra on rest and recalculate Chakra conditions |

## Architecture

### Source tree

```
scripts/
  main.mjs                    # Hook orchestrator
  constants.mjs               # MODULE_ID, TECHNIQUE_ITEM_TYPE, MAIN_DISCIPLINES
  flag-paths.mjs              # Flag-path builders + BUFF_TARGETS (single source of truth
                              # for pf1GetChangeFlat / CONFIG.PF1.buffTargets)
  use-technique.mjs           # Technique use orchestration, perform checks, chakra spend
  learn-technique.mjs         # Learning progression, training costs, Action Point flow
  data/
    action-ids.mjs            # PF1e action id normalization/migration helpers
    skills.mjs                # NARUTO_SKILLS (canonical), LEARN_KEYS, DISCIPLINE_SKILL_MAP
    derived-data.mjs          # prepareBase/Derived actor data
    rest-recovery.mjs         # Chakra recovery on pf1ActorRest
    chakra-conditions.mjs     # Low Reserves / Chakra Depletion registration + updates
    technique-defaults.mjs    # Shared Technique system defaults for model + sync
    technique-model.mjs       # TypeDataModel + COMPLEXITY_TABLE
    technique-rolldata.mjs    # @cl injection for technique actions
    technique-save-dc.mjs     # Technique action DC patch
    damage-types.mjs          # Earth/Water/Wind/Holy registration
    bonus-sources.mjs         # buildLearnCheckBreakdown — shared by roll + tooltip
  ui/
    browser-shared.mjs        # Shared listener helpers for custom browsers
    feat-browser.mjs          # Naruto feat browser (Application V1)
    feat-list.mjs             # Browse button on PF1e Features tab
    render-patch.mjs          # _renderInner wrap that injects the Chakra tab
    learn-checks.mjs          # .shinobi-roll + learn-tooltip listeners
    tap-reserves.mjs          # Tap Reserves dialog/listener
    technique-list.mjs        # Chakra-tab filter/drop-zone/CRUD listeners
    technique-browser.mjs     # Technique compendium browser (Application V1)
    technique-synckit-app.mjs # Per-actor technique sync/diagnostics UI
    technique-sheet.mjs       # Custom ItemSheet for technique items
    technique-weapon-attack.mjs # Selected weapon/attack item integration
    summary-stats.mjs         # Hero Statistics block on Summary tab
  automation/
    buff-application.mjs      # Compendium lookup + buff create/refresh on perform success
    buff-expiry.mjs           # Delete module-created automation buffs on PF1e expiry
    charge-defense.mjs        # Charge AC penalty buff for PF1e charge attacks
    feat-grants.mjs           # Cascade-delete granted feat supplements
    technique-sync.mjs        # Synckit sync/diff helpers
  utils/
    drag-drop.mjs             # resolveDroppedItem — v12/v13 TextEditor shim
templates/
  actor/{chakra-tab,summary-stats,tap-reserves-dialog,technique-synckit}.hbs
  apps/{technique-browser,feat-browser}.hbs
  chat/{technique-perform,learning-result}.hbs
  item/technique-sheet.hbs
styles/
  actor/ apps/ chat/ item/ settings/   # CSS split by UI area; listed in module.json
```

Anchor invariants:
- `NARUTO_SKILLS` (in `data/skills.mjs`) is the canonical map of discipline keys → `{label, ability, discipline}`. `LEARN_KEYS`, the Skills-tab fallback abilities, and the Buff Target labels all derive from it.
- `BUFF_TARGETS` (in `flag-paths.mjs`) is the canonical mapping `targetName → {label, path, sort}`. Adding a new buff-targetable resource means adding one entry there.
- Flag-path strings are only built in `flag-paths.mjs` — call sites import the builders/constants, never concatenate `"naruto-d20"` themselves.

### Data storage

All module data lives exclusively in actor flags under `flags["naruto-d20"].*`. Never in core document fields (`system.*`), except for `TechniqueDataModel` fields which live in `item.system.*` (Foundry's TypeDataModel mechanism).

Flag schema (on `character` and `npc` actors):
```
flags["naruto-d20"].chakra.pool.{value, max, maxBonus}
flags["naruto-d20"].chakra.reserve.{value, max, maxBonus}
flags["naruto-d20"].chakra.nature.{primary, secondary[]}
flags["naruto-d20"].learn.{ckc,gnj,nin,tai,fui}.{base, abilityMod, buffBonus, miscBonus, total, conditional}
flags["naruto-d20"].{actionPoints, reputation, wealth}
```

`maxBonus` and `buffBonus` fields are the write targets for PF1e's changes engine (mapped via `pf1GetChangeFlat`). They are reset to 0 in `prepareBaseActorData` and written by the engine, then read in `prepareDerivedActorData`.

### Technique item (`TechniqueDataModel`)

Defined in `scripts/data/technique-model.mjs`. Extends `foundry.abstract.TypeDataModel`. All stored fields are in `item.system.*`. Derived stats (`learnDC`, `performDC`, `successes`, `skillThreshold`) are computed via the `derived` getter from `rank + complexity` — never stored.

The item sheet (`TechniqueItemSheet`) extends Foundry's base `ItemSheet` directly, **not** `pf1.applications.item.ItemSheetPF`, because PF1e's sheet calls `item.getLabels()` which requires PF1e's full action machinery that technique items don't have.

### Chakra tab UI injection

The tab is injected by patching `ActorSheetPF.prototype._renderInner` (in `scripts/ui/render-patch.mjs`). This is intentional: if the nav `<a>` is injected via the later `renderActorSheetPF` hook, Foundry's V1 Tabs system has already bound and activated tabs, causing it to fall back to the Summary tab and corrupt `_tabs[0].active`. The patch runs before `_activateCoreListeners`, guaranteeing the chakra tab is present when tabs are bound.

Listeners are wired separately because they depend on the live DOM:
- `scripts/ui/learn-checks.mjs` — `.shinobi-roll` click + `[data-naruto-tooltip="learn.X"]` hover
- `scripts/ui/technique-list.mjs` — discipline filter chips, drop zone, synckit search, browse, open/use/learn/duplicate/delete
- `scripts/ui/tap-reserves.mjs` — Reserve header click opens the Tap Reserves dialog

Both consume `buildLearnCheckBreakdown` (from `data/bonus-sources.mjs`) so a single edit changes what the chat card and the tooltip show.

**Learn check rolls** use `pf1.dice.d20Roll()` (not a bare `Roll`) so the native PF1e skill check dialog appears (situational bonus, DC, roll mode, Take 10/20). Parts are labeled strings — `"5[Character Level]"`, `"3[Wis]"`, `"2[Iron Will Buff]"` — which produce the PF1e-style chat card breakdown. Buff source names come from `actor.sourceInfo[flagPath].positive`, falling back to a generic `"Buff Bonus"` label if sourceInfo has no entries for that path.

**Learn check tooltips** use `data-naruto-tooltip="learn.<key>"` (not `data-tooltip`) to avoid colliding with PF1e's own tooltip handler. On `pointerenter`, they render `systems/pf1/templates/extended-tooltip.hbs` via `game.tooltip.activate()`.

### Summary tab injection (`summary-stats.mjs`)

Rendered via `renderActorSheetPF`. Inserts the `#naruto-hero-statistics` block before PF1e's quick-actions section (or prepends to `.tab.summary` as a fallback).

### Buff automation (`automation/buff-application.mjs`)

Triggered at the tail of `performTechnique()` (`scripts/use-technique.mjs`) **only after** the perform check succeeds and chakra has been deducted — failures and cancellations never trigger a buff. The flow is:

1. Gate: skip unless the world setting `automaticBuffs` is on **and** the technique's `item.system.automation.enabled` flag is true. The `buffTargetFiltering = "off"` setting also short-circuits the whole pipeline.
2. Lookup: `findBuffByName(item.name)` scans `naruto-d20.technique-buffs` plus any pack IDs listed in the `customBuffCompendia` setting (comma-separated). It returns `{ exact, variants }` — exact name matches win; otherwise the first `"Name (..."` variant is used. If nothing matches, it logs a warning and exits silently.
3. Targets: `item.system.automation.targetMode` can override targeting. `"self"` applies to the caster and `"selected"` applies to `[...game.user.targets]`. The default `"auto"` keeps the existing heuristic: personal/you/stance techniques apply to the caster; other techniques apply to selected canvas targets. If selected targets are required but none are selected, the automation warns with `NarutoD20.Automation.NoTargets` and does not apply the buff. Each target must be owned by the current user — un-owned targets show a `NarutoD20.Automation.NoPermission` warning and are skipped.
4. Duration: copied from the triggering `ItemAction`'s `duration` (`{ units, value }`). `inst` / `perm` / `seeText` / missing → leave the compendium buff's own duration untouched.
5. Apply: `applyBuffToTarget` matches by `flags["naruto-d20"].sourceId === buffDoc.uuid`. Existing buff → `update({ "system.active": true, "system.duration.*": ... })`. New buff → `toObject()` + strip `_id`, stamp the `sourceId` flag, write duration if provided, set `system.active = true`, then `createEmbeddedDocuments("Item", [...])`.

The `sourceId` flag is the identity key — a target may carry one instance per source UUID. Re-perform refreshes the existing buff in place (resets duration) rather than stacking duplicates.

Related world settings (registered in `init`):
- `automaticBuffs` (Boolean, default `true`) — global on/off.
- `buffTargetFiltering` (`respectTechnique` | `manualAlways` | `off`) — `off` disables the pipeline entirely; the other modes are reserved for the targeting prompt UI.
- `customBuffCompendia` (String) — extra pack IDs to search.

And on the technique itself: `item.system.automation.enabled` (default `true`) and `item.system.automation.targetMode` (`"auto"` | `"self"` | `"selected"`), defined in `TechniqueDataModel.defineSchema` and exposed on the technique sheet's Automation tab.

### Skills

`registerNarutoSkills()` writes labels into `pf1.config.skills` during `pf1PostInit`. `ensureActorSkillEntries()` seeds `actor.system.skills[key]` with `{ ability, rank: 0 }` during `pf1PrepareBaseActorData` using `??=` so existing ranks are never overwritten. The governing ability per discipline can be changed on the PF1e Skills tab and is read back via `actor.system.skills[key].ability`.

## Docs

`docs/` holds contributor/dev reference only (English, kebab-case filenames):

| Doc | Purpose |
|---|---|
| [`docs/manual-qa.md`](docs/manual-qa.md) | Manual QA checklist by feature — run before a release or large PR |
| [`docs/compendium-source-packing.md`](docs/compendium-source-packing.md) | Source JSON ↔ packed LevelDB workflow (`npm run pack` / `unpack`) |
| [`docs/pf1-buff-changes-reference.md`](docs/pf1-buff-changes-reference.md) | PF1e buff *changes* reference for authoring technique automation |

Per-feature **implementation notes** (how each feature/refactor was built — technique header
buttons, compendium browser, synckit, DC buffs, mastery, learning, drop-dup fix, chakra
tooltips/conditions, auto-add-buffs performance, refactor backlog, etc.) now live in
`dev-notes/` at the repo root. That directory is **gitignored / local-only** — it is not in
fresh clones. Read the matching note there before changing a feature if you have it locally.

## Key references

- [Foundry API Docs](https://foundryvtt.com/api/)
- [PF1e API Docs](https://foundryvtt_pathfinder1e.gitlab.io/foundryvtt-pathfinder1/)
