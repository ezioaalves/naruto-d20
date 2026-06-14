# Turn-Maintenance Engine — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Start-of-turn maintenance is currently split across two near-duplicate pipelines,
both triggered from `buff-expiry.mjs` when a 1-round maintenance buff expires:

1. `rank-buff-maintenance.mjs` — Speed/Strength ranks: pay chakra / use free mastery use / deactivate.
2. `stance-buff-maintenance.mjs` — everything else, framed entirely as "stance":
   - **mode** kind (Champuru): keep/switch/break a Dex/Str mode choice.
   - **upkeep** kind (Amatsu = `prompt`, Kai-Mon = `forced`): pay HP or break.

The "stance" framing was generalized once (commit `5278fb5`, Amatsu) and again
(commit `d52fd2c`, Kai-Mon), but Kai-Mon Kai (Initial Gate Release) **is not a
stance** — it is a forced HP upkeep. Because it rides the stance machinery, the
chat reads "Stance upkeep: 2 HP lost" and the code treats it as a stance
(`stanceUpkeep` schema flag, `stanceBuff` flag, `NarutoD20.StanceBuff.*` strings).

The conflation of "has a per-turn upkeep" with "is a stance" is the root cause.

## Goal

Unify all start-of-turn maintenance into **one generic engine**, and **dissolve
"stance" as a named concept in the maintenance layer**. The technique *subtype*
`"stance"` and its self-targeting heuristic (`isStanceTechnique`,
`buff-application.mjs`) are game taxonomy and stay untouched — out of scope.

## Concept model

The umbrella concept is **turn maintenance** (a.k.a. *upkeep*): at the start of
the owner's turn, an active technique buff requires maintenance or it ends.
Maintenance is composed of three **independent, optional facets**:

| Facet | Fields | Behaviour | Used by |
|---|---|---|---|
| **Cost** | `resource` (`""` \| `chakra` \| `hp`), `cost` (formula/amount), `policy` (`prompt` \| `forced`), `interval` (rounds the refresh lasts) | `prompt`: dialog to pay-or-end. `forced`: auto-pay with a guard — end if it would drop HP below 1 or chakra cannot be paid. | Ranks (chakra/prompt), Amatsu (hp/prompt), Kai-Mon (hp/forced) |
| **Waiver** | `waiver` (`""` \| `step` \| `freeUse`), `waiverStep`, `freeRounds` | `step`: at mastery ≥ `waiverStep` the cost is waived and the buff auto-maintains silently. `freeUse`: at mastery ≥ `waiverStep` a daily charge grants `freeRounds` free rounds, **offered as a prompt button** (not silent). | Amatsu (step), Ranks (freeUse) |
| **Choice** | `choice` (`""` \| `mode`) | `mode`: per-turn keep/switch/break between named variant buffs (`<name> (Dexterity)` / `<name> (Strength)`). | Champuru (Dex/Str) |

Element selection (Amatsu) is an **entry-time** prompt (in `use-technique.mjs`),
not a turn-start facet, so it is modelled separately (`element` / `elementCount`)
and only renamed off "stance".

### Classification of existing techniques

| Technique | Cost | Waiver | Choice | Element | Stance subtype? |
|---|---|---|---|---|---|
| Champuru | — | — | mode | — | yes (unchanged) |
| Amatsu no Karada | hp `1d4`, prompt, interval 1 | step (≥2) | — | yes (1, →2 at mastery) | yes (unchanged) |
| Kai-Mon Kai | hp `2`, forced, interval 1 | — | — | — | **no** |
| Speed/Strength ranks | chakra (level table), prompt, interval 5/2/1 | freeUse (≥5, 5 rounds) | — | — | no |

## Unified schema (`scripts/data/technique-model.mjs`)

Replace `automation.{stanceMode, stanceUpkeep, elementChoice, upkeepFormula,
upkeepMode, upkeepWaiverStep}` with a single block (existing `enabled` /
`targetMode` siblings stay):

```js
automation.maintenance: {
  enabled:      Boolean,                      // turn-start maintenance on/off
  resource:     "" | "chakra" | "hp",         // "" = no cost (Champuru)
  cost:         String,                       // "1d4" (hp formula) or "1" (chakra amount)
  policy:       "prompt" | "forced",
  interval:     Number,                       // refresh duration in rounds (rank: 5/2/1)
  waiver:       "" | "step" | "freeUse",
  waiverStep:   Number,                       // mastery threshold for the waiver
  freeRounds:   Number,                       // rounds granted by a freeUse waiver
  choice:       "" | "mode",                  // per-turn mode swap
  element:      Boolean,                       // entry-time element pick (Amatsu)
  elementCount: Number,
}
```

**Grant type** (paid / temp / bonus — whether a rank buff was self-cast or granted
for free by another technique) is *not* technique config; it stays on the runtime
buff flag.

## Runtime architecture

One engine file replaces three.

### New / renamed files

- **`scripts/automation/turn-maintenance.mjs`** *(new — the engine)*
  - `registerTurnMaintenance()` — the single `updateItem` duration-expiry listener
    (moved verbatim in spirit from `buff-expiry.mjs`: only the client that made the
    update acts; only `options.pf1.reason === "duration"` + `system.active === false`
    + `type === "buff"` + a module `sourceId` flag). For each qualifying buff: resolve
    a **maintenance descriptor**; if none → the generic deferred-delete fallback
    (today's behaviour); if present → dedup-queue via a `pendingMaintenance` set keyed
    `actor.uuid:itemId`, then `setTimeout(…, 0)` → `runMaintenance`.
  - `runMaintenance(actor, itemId)` — one generic flow over the descriptor facets:
    1. Re-fetch item; bail if gone or already `system.active`.
    2. Resolve source technique; if gone → delete the buff.
    3. **Waiver:** `step` and the threshold is met → refresh silently and return.
       `freeUse` availability is computed and passed to the prompt (a "use free" button).
    4. **Cost:**
       - `forced` → compute amount (roll hp formula / read chakra cost), guard
         (hp would drop below 1, or chakra unaffordable) → pay & refresh, else
         delete + notify "ended".
       - `prompt` → dialog with buttons: pay-cost / [use-free if available] /
         [switch-mode if `choice === "mode"`] / break. Pay → pay & refresh.
         Free → consume daily charge & refresh for `freeRounds`. Break/close → delete.
    5. **Choice (mode, no cost — Champuru):** prompt keep/switch/break →
       re-apply chosen variant buff (dropping the old variant) or delete.
  - shared helpers: `pendingMaintenance` set, `refreshMaintenanceBuff(actor, itemId,
    interval, { variant } = {})`, `deleteMaintenanceBuff(actor, itemId)`.

- **`scripts/automation/maintenance-buffs.mjs`** *(renames `stance-buffs.mjs`)*
  - One **unified buff flag** `flags.naruto-d20.maintenanceBuff` replacing both
    `stanceBuff` and `rankBuff`. Payload `{ sourceTechniqueId, grantType?, modeId?,
    elements? }`. Cost/interval/waiver are read from the technique schema, not the
    flag. `grantType` of `temp` / `bonus` ⇒ no maintenance (free grants from other
    techniques) and the engine returns "no descriptor" → generic delete.
  - Mode-variant constants (`STANCE_MODES` → `MAINTENANCE_MODES`), `modeById`,
    `maintenanceBuffName`, `maintenanceBuffDuration`, flag-data builder, kind/flag
    resolvers (`getMaintenanceBuffFlag`, `findMaintenanceBuffForTechnique`).

- **`scripts/automation/maintenance-element-damage.mjs`** *(renames
  `stance-element-damage.mjs`)* — entry-time element pick + `pf1PreDamageRoll`
  damage typing; identifiers degreased of "stance".

- **`scripts/data/hp-cost.mjs`** — unchanged logic (`rollHpCost` / `commitHpCost` /
  `applyHpCost`); only the chat-flavor i18n key changes.

### Edited files

- **`scripts/automation/buff-application.mjs`** — `applyStanceModeBuff` →
  `applyModeBuff`; `applyUpkeepStanceBuff` → `applyUpkeepBuff`; `promptStanceMode` →
  `promptModeChoice`. Perform-time apply dispatch reads `automation.maintenance.*`
  (`choice === "mode"` → mode buff; `resource === "hp"` and/or `element` → upkeep
  buff). Rank-apply path stamps the unified `maintenanceBuff` flag. The
  `normalizeBuffApplyOptions` / `refreshExistingBuff` / create paths swap the
  `rankBuff` + `stanceBuff` option pair for a single `maintenanceBuff`.

- **`scripts/use-technique.mjs`** — `stanceFree` → `upkeepFree` (re-using an active
  hp-upkeep technique is free; only entry pays chakra). `isUpkeepStance` /
  `isElementStance` / `findStanceBuffForTechnique` → maintenance-named equivalents.
  Card-footer string key updated.

- **`scripts/data/technique-model.mjs`** — schema swap described above.

- **`scripts/ui/technique-sheet.mjs`** + **`templates/item/technique-sheet.hbs`** —
  replace the stance/upkeep checkboxes & selects with the unified maintenance
  controls (resource, cost, policy, interval, waiver + step/freeRounds, choice,
  element + count), shown conditionally on `enabled` / `resource` / `waiver`.

- **`scripts/main.mjs`** — swap the `registerExpiredBuffCleanup()` call for
  `registerTurnMaintenance()` (same `setup`-phase slot).

- **`lang/en.json`**, **`lang/pt-BR.json`** — `NarutoD20.StanceBuff.*` →
  `NarutoD20.Maintenance.*`; chat flavor becomes `"Upkeep: {amount} HP lost"`
  (fixes the screenshot); technique-sheet field labels updated; rank-maintenance
  strings folded under the unified namespace where they overlap.

### Deleted files

- `scripts/automation/buff-expiry.mjs` (listener absorbed into `turn-maintenance.mjs`).
- `scripts/automation/stance-buff-maintenance.mjs`.
- `scripts/automation/rank-buff-maintenance.mjs`.
- `scripts/automation/rank-buffs.mjs` slims to the name→config table retained only
  for migration/repack seeding (or that table moves into the migration module).

## Migration & data

Two kinds of "old data", handled differently:

- **Buff flags** (ephemeral, ≤ a few rounds): **clean break, no compat reads.**
  Active 1-round buffs orphan harmlessly and expire on their own turn. A longer
  in-flight rank buff (interval 5) in the live test world could orphan mid-combat;
  accepted.
- **Technique-item config** (persistent `system.automation` on compendium items
  **and** actor-owned technique copies): a **one-shot translation**, not a dual-read
  compat layer:
  - **Repack** the `techniques` compendium with the new `maintenance` block:
    Amatsu (hp `1d4`/prompt/interval 1/step ≥2/element 1), Kai-Mon (hp `2`/forced/
    interval 1), Champuru (no cost/choice mode/interval 1), and **seed the 10 rank
    techniques** from the level cost/interval table (chakra/prompt/freeUse ≥5/5 rounds).
  - **GM-only `ready` migration** that maps any owned technique item's legacy
    `automation.{stanceMode,stanceUpkeep,elementChoice,upkeep*}` fields → the new
    `maintenance` block. Synckit also re-syncs owned techniques from the compendium,
    so this is belt-and-suspenders.

## Phasing

One spec, staged implementation plan:

- **Phase 1 — engine + de-stance + HP/mode paths.** Build `turn-maintenance.mjs`,
  the unified `maintenanceBuff` flag, the new schema/sheet/i18n, and rewire
  Amatsu / Kai-Mon / Champuru. Ranks are **routed through the new engine** but keep
  reading their existing name-driven config (a rank cost-provider plugged into the
  engine). Ships the core fix: Kai-Mon is no longer a stance, one engine drives all
  maintenance, the screenshot text is corrected.
- **Phase 2 — rank config into the schema.** Seed/repack the 10 rank techniques with
  `automation.maintenance`, migrate owned rank techniques, and retire the
  name-driven cost lookup (kept only as migration seed if still needed).

## Testing

- Existing manual-QA checklist (`docs/manual-qa.md`) entries for stances/ranks,
  updated to the new vocabulary.
- E2E world `kaihou` (GM Chicó, actor Dattoumaru Ikazuchi): verify each facet —
  Champuru mode swap, Amatsu HP prompt + step waiver + element pick, Kai-Mon forced
  HP with lethal guard (ends instead of killing), rank chakra prompt + free-use.
- Regression: a non-maintenance module buff still gets the generic deferred-delete
  on natural expiry; manual toggle-off still leaves the buff inactive on the sheet.

## Out of scope

- The technique `"stance"` subtype and `isStanceTechnique` self-target heuristic.
- The Kai-Mon buff's fatigued-on-end (Fort DC 15) follow-up (already deferred in `d52fd2c`).
- Any new techniques; this is a refactor of existing behaviour only.
