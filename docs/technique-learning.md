# Technique Learning Progression

> **Status: partially implemented.** The core learning loop is shipped: unlearned
> drops, learn rolls against `learnDC`, standard and 4-hour-block progression,
> Failure Insight, learning gates, migration for existing embedded techniques,
> training-time/chakra tracking, interruption expiry, Action Point persistence,
> and Chakra-tab scroll preservation. Remaining gaps are tracked below as
> explicit backlog, not active implementation.

A **learning loop** for techniques. A technique dragged onto an actor starts
**unlearned**. The practitioner rolls learn checks for the technique's discipline
against the technique's `learnDC`; accumulated progress builds toward the
technique's required target. In standard mode this is the book's attempts and
successes loop. In 4-hour-block mode, each roll represents one training block and
margin of success controls how much progress is gained. Reaching the target
marks the technique **learned** and unlocks its **Perform** action.

This completes a loop that was already half-built: `TechniqueDataModel.derived`
already computed `learnDC` and `successes` (successful learn checks required,
including the Hijutsu/Kinjutsu/Combination adjustments). The shipped learning
flow now consumes those values and gates Perform when learning enforcement is
enabled.

## Canonical rules

Source: `learn_mechanics.md` (Naruto D20 rulebook transcription). The full
ruleset, summarized faithfully:

### Eligibility to learn

- You must meet all of the technique's **Requirements** (listed in italics after
  the subtype). Beyond "ranks in a skill", a requirement may be:
  - **(t)** a technique you must already know,
  - **(f)** a feat you must have,
  - **(a)** an ability (from class / template / bloodline),
  - **(1-5)** that many steps of Mastery in the named technique.
- A Chakra Pool requirement is checked against your **maximum** pool, not current.
- You must have **at least 1 rank** in the technique's associated skill
  (Ninjutsu for Ninjutsu techniques, etc.).
- The technique's **Rank must be ≤ your character level**.

### Learn check

- `1d20 + Character Level + Relevant Ability Modifier` vs the technique's **Learn DC**.
- **Cannot take 20.** **Can take 10** if not stressed and not concealing the training.
- **Action Point:** when spent to improve a learn check, it applies to *all*
  learn checks for that technique until you run out of attempts or succeed.

### Attempts and successes

- A technique lists a **Learn DC** and a number of **successes** required.
- **Attempts available = `1 + Relevant Ability Modifier + 1 per 2 ranks of the
  relevant skill`.**
- Get the required successes before attempts run out → **learned**. Run out of
  attempts first → **fail; all progress is lost and you start over.**
- **Failure Insight:** each failed attempt grants a cumulative **+1** to further
  learn checks for the *same* technique (**max +5**). It lasts until you learn
  the technique or until you attempt to learn a **different** technique.

### Learning time (narrative / manual)

- Each attempt (success or fail) takes **1 day per Rank** of the technique. A day
  is two 4-hour blocks; each hour drains **10% of max Chakra** (no *depleted*
  penalty while training). An incomplete block is wasted.
- Training may be interrupted for up to **1 month** before accrued progress is
  lost; one 4-hour block within that window refreshes the timer.
- **Exceptional roll → time change** (round up to the nearest 4-hour block):
  beat DC by 15+ → −75% time; beat by more than 5 → −50%; fail by more than 5
  → +50%. (The book wording is *more than 5* at the lower boundary; the
  `learnMarginInclusive` setting can switch that boundary to *5 or more* —
  see "Learning progression modes". The 15 boundary is *15 or more* either way.)

### Methods of learning (one at a time, narrative / manual)

- **Being Taught:** +1 per teacher level above you (min +1, max +5); group and
  mastery-teacher rules; a 5th-step-mastery teacher grants one free success.
- **Self-Teaching:** a scroll/item grants +1 per 5 of its Purchase DC (max +5).
- **Developing:** learn something witnessed & identified >once; −2 to checks and
  +1 required success.
- **Creating:** −2 to checks and +2 successes (+1 only if you are 5+ levels above
  its rank); an extra −4 if you only have hints to the effect.

## How it mirrors the rules

- The **learn check** is built from Character Level + the discipline's ability
  modifier (+ buffs/misc). This is exactly what the existing Chakra-tab
  `.shinobi-roll` learn checks already assemble per discipline
  (`learn.{ckc,gnj,nin,tai,fui}`), so learning reuses that roll and only changes
  the comparison target to the **technique's** `learnDC`. Learning uses the
  **full module breakdown (buff/misc/synergy rows included)** on purpose:
  bonuses can apply to technique learn checks, and the learn-check buff targets
  (`learnNin`, etc.) exist precisely so those bonuses feed the roll. The separate
  exception is **Mastery step checks**: they do not use the normal Being Taught /
  Self-Teaching bonuses, though they can still receive situational bonuses such
  as Ninja Lore synergy and Training Weights where applicable, especially for
  Training techniques tied to Strength and Speed ranks.
- Required successes come straight from `derived.successes` (E-Class 1 … Epic 8;
  +1 Hijutsu, +2 Kinjutsu, −2 Combination floored at 1), so the loop tracks
  complexity for free.
- The **attempts budget** and **Failure Insight** are the engine that makes
  failure meaningful — they are the core of this feature, not an afterthought.
- The **perform threshold / DC** (`skillThreshold`, `performDC`) are unchanged —
  they govern *performing* a learned technique, a gate separate from learning it.
- Mastery is a sibling system already shipped — see
  [`technique-mastery.md`](technique-mastery.md). Mastery steps are themselves
  acquired with the same successes mechanic (Mastery table: step → successes),
  but automating Mastery acquisition is **out of scope here**; this feature only
  handles the initial learn (`learned: false → true`).

## Learning progression modes

The module exposes a world setting `learningProgressionMode` so tables can choose
how a successful learn roll advances progress:

| Mode | Setting value | Roll unit | Target progress | Success award |
|---|---|---|---|---|
| Standard rules | `standard` | One learn attempt | `derived.successes` | `1` on any success |
| 4-hour blocks | `fourHourBlocks` | One 4-hour training block | `rank × derived.successes × 2` | `1`; `2` if margin clears the 5 boundary*; `4` if margin ≥ 15 |

\* The **5 boundary** operator (`≥ 5` vs `> 5`) is governed by the
`learnMarginInclusive` setting and applies to **both** modes — see "Settings and
migration". The **15 boundary** is always `≥ 15`.

The **standard** mode follows the book loop: `attemptsUsed / maxAttempts`
matters, a failed run resets progress, and each attempt narratively consumes the
normal training time.

The **4-hour block** mode is the table variant currently used by this group.
Each click/roll represents one 4-hour block instead of one full learn attempt.
It inflates the target progress to preserve the original time scale (`1 day =
two 4-hour blocks`, multiplied by technique rank and required successes) and
uses margin-based progress awards instead of exceptional-roll time reduction.
In this mode the standard attempts budget and "run out of attempts" reset do not
apply; progress is block-based and continues until the target is reached or the
GM resets it manually. Failure Insight still applies to failed block rolls and
still clears when the actor attempts to learn a different technique.

## Scope split

**Phase 1 — automated core (shipped):** unlearned state, progress tracking,
learn-check roll vs `learnDC`, standard-mode attempts budget and out-of-attempts
reset, 4-hour-block mode target/award calculation, Failure Insight bonus, the
Perform gate, eligibility checks (rank ≤ level and ≥1 skill rank),
unmapped-discipline handling, the `learningProgressionMode` setting, and a
one-time migration that marks existing embedded techniques learned.

**Known Phase 1 limitation:** PF1e v11.11's `pf1.dice.d20Roll` dialog exposes
Take 10 and Take 20 together and does not currently provide a clean option to
remove only Take 20. Learn rolls use the PF1e dialog for now; GMs must enforce
the no-Take-20 rule until a custom learn-roll dialog replaces it.

**Phase 2 — partially shipped / backlog:** learning time, chakra drain,
interruption timer, exceptional-roll time changes, and Action Point persistence
are shipped. The four learning Methods and structured `(t)/(f)/(a)/(1-5)`
requirements remain backlog.

### Phase 2 Action Point persistence

A practitioner may spend **one** Action Point per learn run, decided **after**
seeing the learn roll — the moment the player knows how far the roll fell from a
success / exceptional success.

- Each learn chat card carries a right-click context-menu entry **"Add Action
  Point"** (registered on both `getChatLogEntryContext` and
  `getChatMessageContextOptions`). It is offered only while the run is open, no AP
  is committed yet, the card still reflects the current run (freshness guard), the
  user owns the actor, and the actor has at least 1 Action Point.
- Choosing it rolls `1d6` **once**, spends 1 Action Point, and **re-evaluates the
  same attempt** with `total = originalRoll + 1d6` via `resolveLearnAttempt(...)`
  replayed from the card's pre-attempt snapshot. A failure can become a success or
  exceptional success; the attempt counter is not increased beyond the original.
  Any training chakra the superseded attempt deducted is refunded before the
  re-deduction (the boosted margin never costs more).
- The rolled value is stored in `system.learning.actionPointBonus` and
  **auto-applied** as a `N[Action Point]` part on every subsequent learn roll of
  that technique. While it is active the menu entry no longer appears (one AP per
  run, per the rule).
- It clears at run end — learned, standard-mode out-of-attempts reset, or 30-day
  interruption expiry — with **no refund** (that consumption is the spend). The GM
  "Reset Learning" control also clears it.

## Implementation status

| Area | Status | Notes |
|---|---|---|
| `system.learning` core state | Done | `learned`, `progress`, `attemptsUsed`, `failureInsight`; Phase 2 adds `trainingBlocks`, `chakraSpent`, `lastTrainingAt`. |
| Learn roll vs technique `learnDC` | Done | Uses the same learn-check breakdown as the Chakra tab and reads the returned PF1e chat message directly. |
| Standard progression | Done | Successes, attempts budget, out-of-attempts reset, Failure Insight. |
| 4-hour-block progression | Done | `rank × successes × 2` target and margin awards `1 / 2 / 4`. |
| Perform gate | Done | Controlled by `enforceLearning`. Unmapped disciplines are effectively learned for Phase 1. |
| Chakra tab UI | Done | Learn button, progress badge, attempts/blocks readout, disabled Use when enforced. |
| Technique sheet UI | Done | Learning badge, Learn button, GM learned toggle and reset. |
| Medkit preservation | Done | `system.learning` is ignored for diffs and preserved during sync. |
| Existing-world migration | Done | Migration v5 marks pre-existing embedded techniques as learned. |
| Take 20 blocking | Pending | Needs custom dialog or PF1e dialog override. |
| Manual Foundry verification | Pending | Static checks pass; in-world verification still needed. |
| Phase 2: training time | Started | Each learn roll now records training blocks; standard mode applies exceptional-roll time changes. |
| Phase 2: chakra drain | Started | Training chakra is computed from max pool; optional `deductLearningChakra` setting deducts Pool then Reserve and blocks learn rolls when the actor cannot pay. |
| Phase 2: interruption timer | Started | Progress expires if more than 30 days pass since the last training block. |
| Phase 2: learning Methods | Pending | Being Taught, Self-Teaching, Developing, Creating. |
| Phase 2: Action Point persistence | Done | `1d6` rolled once and reused for the run, committed post-roll via the learn chat card's right-click "Add Action Point", which re-evaluates the same attempt. Stored in `system.learning.actionPointBonus`, auto-applied to later rolls, cleared at run end (no refund). |
| Phase 2: structured requirements | Pending | `(t)`, `(f)`, `(a)`, mastery-step and max Chakra requirements. |

## Data model

`scripts/data/technique-model.mjs` — add a `learning` block to `defineSchema()`:

```js
learning: new fields.SchemaField({
    learned:        new fields.BooleanField({ ...opt, initial: false }),
    progress:       new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    attemptsUsed:   new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    failureInsight: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0, max: 5 }),
    trainingBlocks: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    chakraSpent:    new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    lastTrainingAt: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
}, opt),
```

- The state lives in `item.system.*` because it is **per embedded copy**: each
  actor tracks its own progress on the same technique. Compendium source
  techniques keep the schema default (`learned: false`).
- `prepareBaseData()` seeds defaults with the existing `??=` pattern.
- The **attempts budget** depends on actor state (ability mod + skill ranks), so
  it is *not* a pure `system.derived` value. Compute it where the actor is in
  hand (the learn function and the row view-model):
  ```js
  const ability    = resolveSkillAbility(actor, skillKey);
  const abilityMod = actor.system.abilities?.[ability]?.mod ?? 0;
  const ranks      = actor.system.skills?.[skillKey]?.rank ?? 0;
  const maxAttempts = Math.max(1, 1 + abilityMod + Math.floor(ranks / 2));
  ```
  Use `resolveSkillAbility()` rather than the canonical discipline ability so
  the calculation respects the PF1e Skills-tab ability selector. Clamp to at
  least `1` attempt so an eligible character with a negative ability modifier
  does not enter an impossible `0 / 0` run.
- The UI/helper layer computes target and remaining progress where settings are
  available:
  ```js
  targetProgress = getLearningTargetProgress(item, learningProgressionMode);
  learnRemaining = Math.max(0, targetProgress - (item.system.learning?.progress ?? 0));
  ```
  Keep `TechniqueDataModel.derived` focused on pure technique-derived values
  (`learnDC`, `successes`, `performDC`, etc.); `targetProgress` depends on a
  world setting and belongs in `learn-technique.mjs` / the Chakra-tab view-model.

### Medkit and sync preservation

`system.learning` is actor-owned state, not compendium-authored technique
content. The Technique Medkit must preserve it.

- `scripts/automation/technique-sync.mjs` should ignore `system.learning` in
  `normalizeSystem()` / `diffTechnique()` so learned progress does not make every
  embedded technique appear out-of-date relative to its compendium source.
- `syncTechnique()` must copy the current embedded `system.learning` block onto
  the source data before overwriting the embedded item. Otherwise a compendium
  sync can erase `learned`, `progress`, `attemptsUsed`, and `failureInsight`.
- If a source technique later gains a changed default `learning` shape, the
  embedded copy still wins; schema migration/default seeding handles missing
  keys on the actor copy.

## Learning logic

`scripts/learn-technique.mjs` (new) — `attemptLearnTechnique(item)`:

1. **Eligibility gate** (warn + abort on failure):
   - already `learned` → nothing to do;
   - `item.system.rank > characterLevel` → warn;
   - if the discipline has no mapped learn skill (`Hachimon Tonkou`, `Training`,
     blank/other), skip the learn-check loop and treat the technique as
     learned-by-default for this phase. These disciplines cannot satisfy the
     "at least 1 rank in the associated skill" rule because the module has no
     associated PF1e skill for them yet.
   - otherwise, `< 1` rank in `DISCIPLINE_SKILL_MAP[discipline]` → warn.
   (The `(t)/(f)/(a)/(1-5)` requirements are Phase 2 — not enforced yet.)
2. **Training chakra preflight:** when `deductLearningChakra` is enabled, verify
   the actor can pay the minimum possible training cost before opening the PF1e
   roll dialog or mutating learning state. The minimum is one block in
   `fourHourBlocks` mode; in `standard` mode it is the best possible exceptional
   time result for the attempt (`ceil(rank × 2 × 0.25)`, minimum 1 block). If the
   actor cannot pay Pool + Reserve for that minimum cost, warn and abort.
3. **Failure Insight reset across techniques:** track the actor's
   currently-training technique in a flag
   (`flags["naruto-d20"].learning.currentTechniqueId`). The path is exported by
   `scripts/flag-paths.mjs`; do not concatenate `"naruto-d20"` flag paths at
   call sites. If the player attempts a *different* technique, reset that
   technique's `failureInsight` to 0 and point the flag at the new one (per
   "lasts … until you attempt to learn a different technique").
4. **Build & roll** the discipline check the same way the Chakra-tab button does
   (`buildLearnCheckBreakdown(actor, key)` from `scripts/data/bonus-sources.mjs`),
   adding the current `failureInsight` as a labeled part
   (`"+N[Failure Insight]"`). Roll via
   `pf1.dice.d20Roll({ flavor: "Learn: <name>", parts, rollData, speaker })`,
   and read the returned roll/chat result directly. Avoid relying on
   `game.messages.contents.at(-1)` unless PF1e v11.11 verification shows there
   is no better return value; the current perform flow uses that pattern, but a
   new learning flow should be less fragile.
   Configure the dialog to allow Take 10 but **disallow Take 20** if the dialog
   options permit it; otherwise note the limitation (see open questions).
5. **Determine the attempt outcome** — after a paid/resolved attempt,
   increment `attemptsUsed` regardless of success or failure:
   - Compute `targetProgress` from `learningProgressionMode`:
     - `standard`: `derived.successes`
     - `fourHourBlocks`: `item.system.rank × derived.successes × 2`
   - **Success** (`total ≥ derived.learnDC`): increment `learning.progress`.
     The award is mode-dependent:
     - `standard`: always `+1`
     - `fourHourBlocks`: with `margin = total - learnDC`, `+4` if
       `margin >= 15`, else `+2` if the margin clears the 5 boundary
       (`margin >= 5` when `learnMarginInclusive`, else `margin > 5`),
       otherwise `+1`
     If progress reaches `targetProgress` → set `learned: true`, clear the
     training flag, post a "Technique learned!" card.
   - **Failure:** increment `failureInsight` (capped at 5); post a progress card.
   - In `standard` mode only, after incrementing attempts, if **not yet learned**
     and `attemptsUsed ≥ maxAttempts` → **reset the run**: `progress = 0`,
     `attemptsUsed = 0`, `failureInsight = 0`, and post a "failed to learn —
     start over" card.
   - In `fourHourBlocks` mode, `attemptsUsed` counts completed 4-hour training
     blocks for display/audit only; it does not create a failure threshold.
6. **Apply training chakra before persisting the outcome:** when
   `deductLearningChakra` is enabled, deduction is all-or-nothing. If the
   post-roll training cost is higher than the actor's remaining Pool + Reserve,
   warn and abort the resolution without partial chakra loss, progress gain,
   attempt count, or training-time bookkeeping.
7. All learning mutations use a single `item.update({...})` so the sheet
   re-renders once after a resolved attempt.

### Phase 2 training-time slice

The current Phase 2 implementation adds training-time bookkeeping to each learn
roll:

- `trainingBlocks` records completed 4-hour blocks.
- `chakraSpent` records the training chakra generated by those blocks.
- `lastTrainingAt` stores the world-time timestamp of the most recent training
  block, falling back to real time if world time is unavailable.
- If more than 30 days pass before the next learn attempt, progress, attempts,
  Failure Insight, training blocks, and training chakra are reset before the new
  roll.
- In `fourHourBlocks` mode, each roll is exactly one training block.
- In `standard` mode, each roll starts from `rank × 2` blocks and applies the
  exceptional-roll time modifiers:
  - margin `>= 15`: 25% of base time, rounded up to a block;
  - margin clearing the configured 5 boundary: 50% of base time, rounded up;
  - failure crossing the configured 5 boundary: 150% of base time, rounded up;
  - otherwise, base time.
- Training chakra is `ceil(chakra.pool.max × 0.4 × blocks)`, matching 10% of max
  Chakra per hour across 4-hour blocks.
- `deductLearningChakra` controls whether the calculated training chakra is also
  deducted from the actor. It is off by default. When enabled, deduction uses
  Pool first, then Reserve, blocks the learn roll before the dialog if the actor
  cannot afford the minimum possible training block cost, and resolves
  post-roll deduction as all-or-nothing. The deduction intentionally does not
  refresh depletion conditions because the rule says training ignores the
  depleted penalty.

## Perform gate

`scripts/use-technique.mjs` — at the top of `performTechnique`, before the
affordability check:

```js
if (game.settings.get(MODULE_ID, "enforceLearning")
    && !item.system.learning?.learned) {
    ui.notifications.warn(`${item.name}: not learned yet.`);
    return;
}
```

`canAffordTechnique` is unchanged. The gate is setting-controlled so a GM can run
games without enforced learning.

The same gate applies to every technique-use entry point because both the Chakra
tab row buttons and the technique sheet action buttons call `performTechnique()`.
The UI should still dim/disable Use buttons for clarity, but `performTechnique()`
is the authoritative enforcement point.

## UI — Chakra tab

`templates/actor/chakra-tab.hbs` + `scripts/ui/technique-list.mjs`:

- **Unlearned** row: a **Learn** button plus a progress badge
  `{{learning.progress}} / {{targetProgress}}`. In `standard` mode, also show
  an attempts readout `{{learning.attemptsUsed}} / {{maxAttempts}}`; in
  `fourHourBlocks` mode, show blocks completed instead (e.g. `6 blocks`) because
  there is no out-of-attempts failure threshold. Show the Failure Insight bonus
  if any (e.g. `+2`). The **Use** button is disabled / dimmed.
- **Learned** row: normal Use button, no badge (or a small ✓).
- New listener `.shinobi-technique-learn` → `attemptLearnTechnique(item)`, scoped
  to `.tab.chakra` like the existing open/use/delete handlers.
- The row view-model passes `learning`, `targetProgress`, `learningMode`, and
  the computed `maxAttempts` through to each row.
- The sheet patch registers `.techniques-body` in PF1/Foundry's inherited
  `defaultOptions.scrollY`, so re-renders caused by learn rolls, misc bonus
  edits, or technique use keep the technique list's current scroll position.

## UI — technique sheet (polish)

`scripts/ui/technique-sheet.mjs` + `templates/item/technique-sheet.hbs`:

- A "Learned" / "X of Y progress" badge near rank/complexity. In standard mode,
  include "A of B attempts"; in 4-hour-block mode, include completed block count.
- GM-only manual toggle to force `learned` true/false and to reset the run
  (covers retraining, imports, the four Methods, and adjudication).

## Settings and migration

`scripts/main.mjs`:

- Register `enforceLearning` (Boolean, default `true`) in `init`.
- Register `learningProgressionMode` (String, default `standard`) in `init`:
  - `standard` — book-style attempts and required successes.
  - `fourHourBlocks` — table variant: one roll per 4-hour block, target progress
    `rank × derived.successes × 2`, margin-based awards `1 / 2 / 4`.
- Register `learnMarginInclusive` (Boolean, default `true`) in `init`. Controls
  the **5** success-margin boundary, applied to **both** progression modes
  (the `fourHourBlocks` `+2` award, and the standard mode's exceptional-time rule
  when that Phase 2 piece is automated):
  - `true` (`≥ 5`) — a margin of exactly 5 counts toward the better result; this
    group's house rule ("5 ou mais"). This is why the default is `true`.
  - `false` (`> 5`) — only a margin strictly greater than 5 counts; book-faithful
    ("more than 5"). Book-strict standard play should use this.
  The **15** boundary is always `≥ 15` — the rulebook and the house rule agree.
- Register `deductLearningChakra` (Boolean, default `false`) in `init`. When on,
  learn attempts require enough current Pool + Reserve to pay training chakra;
  the pre-roll gate uses the minimum possible training time, and the actual
  post-roll deduction must be paid in full.
- **One-time `ready` migration (GM only)**, following the existing flag-backfill
  pattern: set `system.learning.learned = true` on every embedded technique that
  predates this feature, so existing games are not suddenly locked out. Guard it
  with a world setting / version flag so it runs once. New drops created after
  the feature ships start unlearned (schema default).

The drop handler in `scripts/ui/technique-list.mjs` needs no change — the schema
default (`learned: false`) applies to newly created embedded items.

## Files changed

| File | Change |
|---|---|
| `scripts/data/technique-model.mjs` | `learning` schema (`learned`, `progress`, `attemptsUsed`, `failureInsight`); `prepareBaseData` defaults |
| `scripts/learn-technique.mjs` | New — eligibility gate, progression-mode target/award calculation, attempts budget, roll vs `learnDC`, success/failure resolution, Failure Insight, out-of-attempts reset, chat cards |
| `scripts/use-technique.mjs` | Gate `performTechnique` on `learning.learned` (respects `enforceLearning`) |
| `scripts/flag-paths.mjs` | Export the actor flag path for `learning.currentTechniqueId` |
| `scripts/ui/technique-list.mjs` | `.shinobi-technique-learn` listener; disable Use when unlearned; pass `targetProgress`, `learningMode`, and `maxAttempts` to view-model |
| `scripts/ui/render-patch.mjs` | Add Chakra tab content and register `.techniques-body` in inherited sheet `scrollY` so technique-list scroll survives re-renders |
| `templates/actor/chakra-tab.hbs` | Learn button + progress/attempts-or-blocks badges per row; lock Use when unlearned |
| `scripts/ui/technique-sheet.mjs` | Learned/progress badge; GM force-learn + reset toggle |
| `templates/item/technique-sheet.hbs` | Learned/progress badge markup |
| `scripts/automation/technique-sync.mjs` | Preserve and ignore actor-owned `system.learning` during medkit diff/sync |
| `scripts/main.mjs` | Register `enforceLearning`, `learningProgressionMode`, `learnMarginInclusive`, and `deductLearningChakra`; one-time `ready` learned-backfill migration |
| `lang/en.json`, `lang/pt-BR.json` | `NarutoD20.Learning.*`, `NarutoD20.Settings.LearningProgressionMode.*`, `NarutoD20.Settings.LearnMarginInclusive.*`, and `NarutoD20.Settings.DeductLearningChakra.*` labels |

## Open questions

1. **Take 10 / Take 20 on the dialog** — `pf1.dice.d20Roll` exposes Take 10/20.
   The rules forbid Take 20 on learn checks; if the dialog can't be told to hide
   Take 20, do we accept it as a known limitation or roll without that dialog?
2. **Chakra preflight strictness** — the pre-roll gate uses the minimum possible
   training cost so the actor can still roll when a good result might make the
   attempt affordable. If the actual post-roll cost is higher than the remaining
   chakra, the current behavior aborts resolution after the roll instead of
   spending partial chakra or applying progress.
3. **Backlog ordering** — which manual rule to automate next: the four Methods,
   or structured `(t)/(f)/(a)/(1-5)` requirements tied into the existing
   `links.prerequisites`.

## Manual verification

1. Drag a technique from the compendium onto an actor → **unlearned**: Use is
   disabled, a **Learn** button, `0 / N` progress and the mode-appropriate
   attempts/blocks readout show.
2. With rank > character level (or 0 ranks in the discipline skill), **Learn**
   warns and does nothing.
3. Click **Learn**: the discipline learn-check dialog appears; the total is
   compared to the technique's `learnDC`. A success bumps progress; reaching
   target progress flips the technique to **learned**, posts a card, and unlocks
   **Use**.
4. A failed attempt bumps the attempts counter and adds **+1 Failure Insight**
   (visible on the next roll's breakdown, capped at +5).
5. In standard mode, running out of attempts before learning resets progress,
   attempts, and Failure Insight to 0 and posts a "start over" card.
6. Attempting to learn a *different* technique clears the previous technique's
   Failure Insight.
7. With `enforceLearning` on, Using an unlearned technique warns and spends no
   chakra; with the setting off, Use works regardless of learned state.
8. **Migration:** an actor that had techniques before the feature finds them all
   **learned** after the one-time `ready` migration; newly dropped techniques
   start unlearned.
9. **Complexity coupling:** a Kinjutsu/Combination technique requires the
   adjusted `successes`; in standard mode the badge denominator matches
   `derived.successes`.
10. **Medkit preservation:** learn progress on an embedded technique does not
    make the medkit mark it out-of-date; syncing an out-of-date technique
    preserves its `system.learning` state.
11. **Unmapped disciplines:** `Hachimon Tonkou` / `Training` techniques remain
    usable under `enforceLearning` according to the phase-1 policy above.
12. **4-hour-block mode:** set `learningProgressionMode = fourHourBlocks`.
    A rank 3 technique with `derived.successes = 2` shows target progress `12`.
    With `learnMarginInclusive = true`, a success by margin 0-4 grants `+1`,
    margin 5-14 grants `+2`, and margin 15+ grants `+4`; failed rolls grant no
    progress but can increase Failure Insight. The blocks counter increases
    without resetting progress at `maxAttempts`.
13. **Margin boundary setting:** with `learnMarginInclusive = false`, a success
    by exactly margin 5 drops to the `+1` award (book-strict `> 5`); flipping the
    setting back to `true` restores the `+2` award at margin 5. The 15 boundary
    is unaffected.
14. **Learning chakra block:** with `deductLearningChakra` on and current Pool +
    Reserve below the minimum training cost, clicking **Learn** warns and does
    not open the roll dialog.
15. **Learning chakra deduction:** with enough current Pool + Reserve, a resolved
    learn attempt deducts Pool first and Reserve second. If the post-roll cost is
    higher than the remaining chakra, no partial deduction or learning progress
    is applied.
16. **Chakra tab scroll:** scroll the technique list, then trigger a learn roll,
    edit a learn misc bonus, or use a technique. The sheet may re-render, but the
    `.techniques-body` scroll position should remain where it was.
17. **Action Point — add after roll:** with ≥1 Action Point, make a learn roll that
    falls short, right-click the card → **Add Action Point**. One `d6` is rolled,
    1 AP is spent, and the same attempt is re-evaluated with `roll + d6` (a near
    miss can flip to a success/exceptional). The attempt counter does not jump.
18. **Action Point — reuse + cap:** after committing an AP, the row shows
    `⚡ +N AP`; the next learn roll auto-includes `N[Action Point]` (same value, no
    new d6, no extra AP), and its card no longer offers **Add Action Point**.
19. **Action Point — clear at run end:** learning the technique (or a standard-mode
    out-of-attempts reset / 30-day expiry) clears `actionPointBonus`; Action Points
    are not refunded. GM **Reset Learning** also clears it.
20. **Action Point — guards:** with 0 Action Points the menu entry is hidden; on an
    older (superseded) card after a newer roll, it is hidden / warns and does not
    clobber the newer progress.
