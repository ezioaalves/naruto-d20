# Feat Changes & Buff Automation — Implementation Plan

> **Status:** draft / pre-implementation
> **Goal:** Populate `system.changes` on all 476 feat source files and create
> linked buff items for feats with duration-based active effects.
>
> **Scale snapshot (from data analysis):**
> | Category | Count |
> |---|---|
> | Has extractable numeric bonus | 210 |
> | No numeric bonus (unlock/narrative) | 286 |
> | Has active/duration trigger (needs buff item) | 44 |
> | Affects Naruto learn checks | 15 |
> | Mentions Chakra Pool / Reserve | 35 |

---

## 1. Three categories of effect — different handling per category

### 1a. Passive numeric changes → `system.changes`

A feat like *Fuinjutsu Adept* gives "+2 to Fuinjutsu checks, +1 save DC." These
map directly to change entries that the PF1e changes engine applies the moment
the feat is on the actor. No extra code required — just populate the array.

### 1b. Active / toggle effects → `feat-buffs` compendium + supplement link

A feat like *Chakra Presence* says "spend a move action… For 1 minute…
3 times/day." This is a toggleable stance/buff:
- The feat itself gets a `system.actions` entry (activation, uses/day).
- A **Buff** item lives in a new `naruto-d20.feat-buffs` compendium, carrying
  the actual changes (the -2 penalty aura, etc.).
- The feat links to that Buff via `system.links.supplements` — the Buff is
  auto-created on the actor when the feat is dropped.
- The player activates the Buff from the Buffs tab to toggle the effect on/off.

These are the **44 active-trigger feats** identified by the analysis.

### 1c. Narrative / unlock effects → description only

Feats like *Advanced Seal Proficiency* ("you can learn Advanced Seal techniques
without penalty") grant a capability, not a number. Nothing goes in
`system.changes` — the description is the full mechanical expression. Mark
these with a JSON flag `flags["naruto-d20"].hasChanges = false` so future
automation passes can skip them confidently.

---

## 2. Skill mapping table — D20 Modern names → PF1e target keys

The feat text uses D20 Modern skill names. The PF1e changes engine uses the
keys that exist in `CONFIG.PF1.skills`. Verify each key against the running
game (`Object.keys(CONFIG.PF1.skills)` in the browser console) before
committing.

**Draft mapping — confirm in Foundry before wiring:**

| D20 Modern skill | PF1e skill key | Notes |
|---|---|---|
| Bluff | `skill.blf` | |
| Climb | `skill.clm` | |
| Concentration | `skill.csc` | PF1e adds this back; verify |
| Diplomacy | `skill.dip` | |
| Disguise | `skill.dis` | |
| Escape Artist | `skill.esc` | |
| Gather Information | `skill.dip` | Folded into Diplomacy in PF1e |
| Handle Animal | `skill.han` | |
| Heal / Treat Injury | `skill.hea` | |
| Hide | `skill.ste` | PF1e = Stealth |
| Intimidate | `skill.itm` | |
| Jump | `skill.acr` | PF1e = Acrobatics |
| Knowledge (any) | `skill.kno` | PF1e has sub-keys; use parent |
| Listen | `skill.per` | PF1e = Perception |
| Move Silently | `skill.ste` | PF1e = Stealth |
| Perform | `skill.prf` | |
| Ride | `skill.rid` | |
| Search | `skill.per` | PF1e = Perception |
| Sense Motive | `skill.sen` | |
| Sleight of Hand | `skill.slt` | |
| Spot | `skill.per` | PF1e = Perception |
| Survival | `skill.sur` | |
| Swim | `skill.swm` | |
| Tumble / Balance | `skill.acr` | PF1e = Acrobatics |
| Chakra Control (learn) | `learnCkc` | Naruto module target |
| Fuinjutsu (learn) | `learnFui` | Naruto module target |
| Genjutsu (learn) | `learnGnj` | Naruto module target |
| Ninjutsu (learn) | `learnNin` | Naruto module target |
| Taijutsu (learn) | `learnTai` | Naruto module target |

**Special Naruto targets:**

| Stat | PF1e target key | Bonus type |
|---|---|---|
| Chakra Pool max | `chakraPool` | untyped |
| Chakra Reserve max | `chakraReserve` | untyped |
| All technique save DCs | `techDcAll` | untyped |
| Fuinjutsu technique DC | `techDcFui` | untyped |
| Genjutsu technique DC | `techDcGnj` | untyped |
| Ninjutsu technique DC | `techDcNin` | untyped |
| Taijutsu technique DC | `techDcTai` | untyped |
| Initiative | `init` | feat |
| Max HP | `mhp` | feat |
| BAB | `bab` | feat |
| Fortitude | `sav.fort` | feat |
| Reflex | `sav.ref` | feat |
| Will | `sav.will` | feat |
| All saves | `sav` | feat |

**Bonus type rules (PF1e):**
- `"feat"` — named bonus type; two feats giving feat bonuses to the same thing
  don't stack. This matches PF1e's printed rules.
- `"untyped"` — always stacks; use for Naruto-specific targets where no named
  bonus type is specified in the source text.
- Preserve the explicit type when the feat text names one (morale, competence,
  circumstance, resistance, sacred, luck, insight, deflection).

---

## 3. Phase 1 — Claude API batch extraction

This is the core of the plan. Write `tools/extract-feat-changes.mjs` that
pipes all 476 feat descriptions through Claude's API in batches and outputs a
JSON mapping `featName → { changes: [...], activeEffect: bool, hasChanges: bool }`.

### Script architecture

```
tools/
  extract-feat-changes.mjs  ← calls Claude API, writes output
  apply-feat-changes.mjs    ← reads output, patches packs/_source/feats/*.json
```

### Prompt design for `extract-feat-changes.mjs`

Send batches of ~20 feats per API call to stay within the context window and
control cost. The system prompt establishes the skill mapping table (§2) and
the output schema. The user prompt contains the feat array.

**System prompt (outline):**

```
You are converting Naruto D20 feat benefits into PF1e change entries.
For each feat, output a JSON object with:
  - changes: array of { formula, target, type, operator }
    using only the allowed target keys listed below.
  - activeEffect: true if the benefit requires an action to activate
    or has a duration/per-day limit.
  - hasChanges: true if any changes were extracted.

Allowed targets: [full table from §2 above]
Rules:
  - Flaws give negative (operator "add", negative formula).
  - If a bonus type is named in the text, use it; otherwise "untyped" for
    Naruto targets and "feat" for standard PF1e targets.
  - If the effect can't be expressed as a change (unlock, new ability,
    conditional narrative), set hasChanges: false and changes: [].
  - Do NOT invent targets not in the allowed list.
```

**Output schema per feat:**

```jsonc
{
  "FUINJUTSU ADEPT": {
    "hasChanges": true,
    "activeEffect": false,
    "changes": [
      { "formula": "2", "target": "learnFui", "type": "feat", "operator": "add" },
      { "formula": "1", "target": "techDcFui", "type": "feat", "operator": "add" }
    ]
  },
  "CHAKRA PRESENCE": {
    "hasChanges": false,
    "activeEffect": true,
    "changes": []
  },
  "IMPROVED CHAKRA POOL": {
    "hasChanges": true,
    "activeEffect": false,
    "changes": [
      { "formula": "3", "target": "chakraPool",    "type": "untyped", "operator": "add" },
      { "formula": "1", "target": "chakraReserve", "type": "untyped", "operator": "add" }
    ]
  }
}
```

### Cost and batching

476 feats ÷ 20 per call = ~24 API calls.
Using `claude-haiku-4-5` (cheapest, fast enough for structured extraction):
~1 000 input tokens + 400 output tokens per call × 24 calls ≈ $0.02 total.
Use `claude-sonnet-4-6` for a second pass on the `hasChanges: false` cases to
catch anything Haiku missed.

### Implementation notes

- Use `@anthropic-ai/sdk` (already available in the project or `npm i`).
- Wrap each batch in a try/catch; log failures; don't halt the whole run.
- Write the merged output to `tools/feat-changes-output.json` (one file).
- Include a `_meta` key with timestamp + model used for audit.

---

## 4. Phase 2 — Apply changes to source JSONs

`tools/apply-feat-changes.mjs` reads `feat-changes-output.json` and patches
each matching file in `packs/_source/feats/`:

1. Match by `name` (case-insensitive, after stripping brackets like `[META-CHAKRA]`).
2. Write `system.changes = [...]` with generated `_id` per change entry
   (deterministic: `deterministicId(feat.name + JSON.stringify(change))`).
3. Set `flags["naruto-d20"].hasChanges = result.hasChanges`.
4. Set `flags["naruto-d20"].activeEffect = result.activeEffect` (used in Phase 3).
5. Leave files whose name wasn't matched untouched; log misses.

After running, recompile:

```bash
npm run pack:feats
```

---

## 5. Phase 3 — Buff compendium for active effects

### 5a. New pack

Register `naruto-d20.feat-buffs` in `module.json`:

```jsonc
{
  "name":   "feat-buffs",
  "label":  "Feat Buffs",
  "path":   "packs/feat-buffs",
  "type":   "Item",
  "system": "pf1"
}
```

### 5b. Generate buff source JSONs

`tools/generate-feat-buffs.mjs` reads all `packs/_source/feats/*.json` where
`flags["naruto-d20"].activeEffect === true`, and for each one:

1. Creates a companion Buff item in `packs/_source/feat-buffs/<slug>.json`.
   - `type: "buff"` — PF1e's native Buff item type.
   - `system.buffType: "temp"` — toggleable from the Buffs tab.
   - `system.active: false` — starts inactive.
   - `system.changes: []` — to be filled manually (the active-effect changes
     are complex; automated extraction is low-confidence here).
   - `system.duration: { value: "", units: "min" }` — placeholder.
   - `flags["naruto-d20"].sourceId: <feat uuid>`.

2. Stamps the buff's compendium UUID back into the feat's
   `system.links.supplements` array so PF1e auto-creates it when the feat
   is dropped.

> **Why leave buff changes empty for now?**
> The 44 active feats have highly varied mechanics (per-day limits, aura
> effects, action costs, conditional durations). Scripting their changes is
> error-prone without gameplay testing. The buff item gives the GM a container
> to fill in manually, and the supplement link means it auto-appears on the
> actor when the feat is granted — exactly like the technique-buffs flow.

### 5c. Pack compiler

`tools/pack-feat-buffs.mjs` — mirrors `pack-feats.mjs` but reads from
`packs/_source/feat-buffs/`. Organizes by a single folder (no hierarchy needed).

Add to `package.json`:
```jsonc
"pack:feat-buffs": "node tools/pack-feat-buffs.mjs"
```

---

## 6. File change list

New files:

| File | Purpose |
|---|---|
| `tools/extract-feat-changes.mjs` | Claude API batch extractor → `feat-changes-output.json` |
| `tools/apply-feat-changes.mjs` | Patches `packs/_source/feats/*.json` with extracted changes |
| `tools/generate-feat-buffs.mjs` | Creates `packs/_source/feat-buffs/*.json` for the 44 active feats |
| `tools/pack-feat-buffs.mjs` | Compiles feat-buff source JSONs → LevelDB |
| `tools/feat-changes-output.json` | Claude API output (generated, committed for audit) |
| `packs/_source/feat-buffs/` | Source JSONs for active-effect buff items |
| `packs/feat-buffs/` | Compiled LevelDB (generated) |

Edited files:

| File | Change |
|---|---|
| `module.json` | Add `feat-buffs` pack entry |
| `package.json` | Add `pack:feat-buffs` and `generate:feat-buffs` scripts |
| `packs/_source/feats/*.json` | `system.changes` populated, `flags["naruto-d20"].hasChanges` + `activeEffect` set |

---

## 7. Execution sequence

```
1.  Verify skill target keys in Foundry console (§2 mapping table).
2.  node tools/extract-feat-changes.mjs     → tools/feat-changes-output.json
3.  Review output (spot-check ~20 feats; fix prompt if needed, re-run).
4.  node tools/apply-feat-changes.mjs       → patches packs/_source/feats/*.json
5.  [Stop Foundry] npm run pack:feats [Start Foundry] — compile changes.
6.  In Foundry: drop a few feats, verify changes apply (chakra pool, learn checks).
7.  node tools/generate-feat-buffs.mjs      → packs/_source/feat-buffs/*.json
8.  [Stop Foundry] npm run pack:feat-buffs  [Start Foundry]
9.  In Foundry: drop an active feat; verify buff appears in Buffs tab.
10. Fill in system.changes on buff items (manual — 44 items).
```

---

## 8. Validation checks

After step 6:
- Drop **Iron Chakra** (should be: +10 chakraPool, +10 chakraReserve) →
  Chakra tab shows correct max.
- Drop **Fuinjutsu Adept** → Fuinjutsu learn check total increases by 2.
- Drop a flaw (e.g. **Anxious**) → relevant skill totals decrease.
- Toggle the dropped feat off (PF1e's disable toggle) → bonus disappears.

After step 9:
- Drop **Chakra Presence** → feat appears in Feats tab, Buff appears in Buffs tab
  (inactive). Activating the buff applies its changes.

---

## 9. Open questions

1. **Concentration skill key** — PF1e removed Concentration as a standalone
   skill; it may be re-added by a module or handled differently. Check
   `CONFIG.PF1.skills` in the running game before running the extractor.
2. **D20 Modern-only skills** (Gather Information, Investigate, Treat Injury,
   Computer Use…) — verify whether these are registered in `CONFIG.PF1.skills`
   or mapped to PF1e equivalents.
3. **Flaws as negative-bonus feats vs. as disabilities** — some flaws (Blind,
   Amputee) have no numeric expression. The `hasChanges: false` path handles
   them, but they might warrant a visual tag on the Feats tab.
4. **BLOOD PACT** — has a 24-row table of variants. A single change per variant
   isn't practical; it's better modelled as 24 separate feat items or as a
   single item with a script call. Flag for manual review in the extractor
   output.
5. **Meta-Chakra cost reduction feats** (Efficient Technique, Concealed
   Technique) — these modify technique costs at use-time, not as standing
   changes. They have no `system.changes` expression; they require a
   `scriptCalls` entry or `use` hook. Document them as `hasChanges: false` and
   track separately.
