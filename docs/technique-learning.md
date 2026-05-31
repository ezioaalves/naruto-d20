# Technique Learning Progression

> **Status: planned.** This document is the implementation plan, not a record of
> shipped code. File/line references describe the intended changes.

A **learning loop** for techniques. A technique dragged onto an actor starts
**unlearned**. The practitioner spends *attempts*, each one a learn check for the
technique's discipline against the technique's `learnDC`; accumulated successes
build toward the technique's required `successes`. Reaching the required
successes **before running out of attempts** marks the technique **learned** and
unlocks its **Perform** action. Running out of attempts first resets all progress.

This completes a loop that is already half-built: `TechniqueDataModel.derived`
already computes `learnDC` and `successes` (successful learn checks required,
including the Hijutsu/Kinjutsu/Combination adjustments), but nothing currently
consumes them — a dropped technique can be performed immediately.

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
  beat DC by 15+ → −75% time; beat by >=5 → −50%; fail by >=5 → +50%.

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

## Scope split

**Phase 1 — automated core (this feature):** unlearned state, attempts budget,
learn-check roll vs `learnDC`, success accumulation, Failure Insight bonus,
out-of-attempts reset, the Perform gate, eligibility checks (rank ≤ level and
≥1 skill rank), unmapped-discipline handling, and take-10/no-take-20 on the
roll dialog.

**Phase 2 — manual / future:** learning time & chakra drain, interruption timer,
exceptional-roll time changes, the four learning Methods, Action Point
persistence, and the `(t)/(f)/(a)/(1-5)` structured requirements. These are
documented above so GMs adjudicate them by hand; automation can follow later.

## Data model

`scripts/data/technique-model.mjs` — add a `learning` block to `defineSchema()`:

```js
learning: new fields.SchemaField({
    learned:        new fields.BooleanField({ ...opt, initial: false }),
    successes:      new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    attemptsUsed:   new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0 }),
    failureInsight: new fields.NumberField({ ...opt, integer: true, initial: 0, min: 0, max: 5 }),
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
- The `derived` getter still exposes a UI remainder for required successes:
  ```js
  learnRemaining: Math.max(0, successes - (this.learning?.successes ?? 0)),
  ```

### Medkit and sync preservation

`system.learning` is actor-owned state, not compendium-authored technique
content. The Technique Medkit must preserve it.

- `scripts/automation/technique-sync.mjs` should ignore `system.learning` in
  `normalizeSystem()` / `diffTechnique()` so learned progress does not make every
  embedded technique appear out-of-date relative to its compendium source.
- `syncTechnique()` must copy the current embedded `system.learning` block onto
  the source data before overwriting the embedded item. Otherwise a compendium
  sync can erase `learned`, `successes`, `attemptsUsed`, and `failureInsight`.
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
2. **Failure Insight reset across techniques:** track the actor's
   currently-training technique in a flag
   (`flags["naruto-d20"].learning.currentTechniqueId`). Add this path through
   `scripts/flag-paths.mjs`; do not concatenate `"naruto-d20"` flag paths at
   call sites. If the player attempts a *different* technique, reset that
   technique's `failureInsight` to 0 and point the flag at the new one (per
   "lasts … until you attempt to learn a different technique").
3. **Build & roll** the discipline check the same way the Chakra-tab button does
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
4. **Resolve the attempt** — increment `attemptsUsed` regardless of outcome:
   - **Success** (`total ≥ derived.learnDC`): increment `learning.successes`. If
     it reaches `derived.successes` → set `learned: true`, clear the
     training flag, post a "Technique learned!" card.
   - **Failure:** increment `failureInsight` (capped at 5); post a progress card.
   - After incrementing attempts, if **not yet learned** and
     `attemptsUsed ≥ maxAttempts` → **reset the run**: `successes = 0`,
     `attemptsUsed = 0`, `failureInsight = 0`, and post a "failed to learn —
     start over" card.
5. All mutations via a single `item.update({...})` so the sheet re-renders once.

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
  `{{learning.successes}} / {{derived.successes}}` and an attempts readout
  `{{learning.attemptsUsed}} / {{maxAttempts}}` (with the Failure Insight bonus,
  if any, e.g. `+2`). The **Use** button is disabled / dimmed.
- **Learned** row: normal Use button, no badge (or a small ✓).
- New listener `.shinobi-technique-learn` → `attemptLearnTechnique(item)`, scoped
  to `.tab.chakra` like the existing open/use/delete handlers.
- The row view-model passes `learning`, `derived.successes`, and the computed
  `maxAttempts` through to each row.

## UI — technique sheet (polish)

`scripts/ui/technique-sheet.mjs` + `templates/item/technique-sheet.hbs`:

- A "Learned" / "X of Y successes — A of B attempts" badge near rank/complexity.
- GM-only manual toggle to force `learned` true/false and to reset the run
  (covers retraining, imports, the four Methods, and adjudication).

## Settings and migration

`scripts/main.mjs`:

- Register `enforceLearning` (Boolean, default `true`) in `init`.
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
| `scripts/data/technique-model.mjs` | `learning` schema (`learned`, `successes`, `attemptsUsed`, `failureInsight`); `prepareBaseData` defaults; `derived.learnRemaining` |
| `scripts/learn-technique.mjs` | New — eligibility gate, attempts budget, roll vs `learnDC`, success/failure resolution, Failure Insight, out-of-attempts reset, chat cards |
| `scripts/use-technique.mjs` | Gate `performTechnique` on `learning.learned` (respects `enforceLearning`) |
| `scripts/flag-paths.mjs` | Export the actor flag path for `learning.currentTechniqueId` |
| `scripts/ui/technique-list.mjs` | `.shinobi-technique-learn` listener; disable Use when unlearned; pass `maxAttempts` to view-model |
| `templates/actor/chakra-tab.hbs` | Learn button + successes/attempts badges per row; lock Use when unlearned |
| `scripts/ui/technique-sheet.mjs` | Learned/progress badge; GM force-learn + reset toggle |
| `templates/item/technique-sheet.hbs` | Learned/progress badge markup |
| `scripts/automation/technique-sync.mjs` | Preserve and ignore actor-owned `system.learning` during medkit diff/sync |
| `scripts/main.mjs` | Register `enforceLearning`; one-time `ready` learned-backfill migration |
| `lang/en.json`, `lang/pt-BR.json` | `NarutoD20.Learning.*` (Learn, Learned, Progress, Attempts, FailureInsight, NotLearned, RankTooHigh, NoSkillRank, LearnedCard, ProgressCard, FailedRunCard) |

## Open questions

1. **Take 10 / Take 20 on the dialog** — `pf1.dice.d20Roll` exposes Take 10/20.
   The rules forbid Take 20 on learn checks; if the dialog can't be told to hide
   Take 20, do we accept it as a known limitation or roll without that dialog?
2. **Failure Insight scope flag** — store the "currently training" technique id
   on an actor flag (planned, path exported from `flag-paths.mjs`) vs. infer it
   some other way.
3. **Eligibility strictness** — block hard on rank/skill (planned) or warn-and-allow
   so GMs can override at the table?
4. **Phase 2 ordering** — which manual rule to automate next (learning time +
   chakra drain seems highest value; structured `(t)/(f)/(a)/(1-5)` requirements
   tie into the existing `links.prerequisites`).

## Manual verification

1. Drag a technique from the compendium onto an actor → **unlearned**: Use is
   disabled, a **Learn** button, `0 / N` successes and `0 / M` attempts show.
2. With rank > character level (or 0 ranks in the discipline skill), **Learn**
   warns and does nothing.
3. Click **Learn**: the discipline learn-check dialog appears; the total is
   compared to the technique's `learnDC`. A success bumps successes; the `N`-th
   success flips the technique to **learned**, posts a card, and unlocks **Use**.
4. A failed attempt bumps the attempts counter and adds **+1 Failure Insight**
   (visible on the next roll's breakdown, capped at +5).
5. Running out of attempts before learning resets successes, attempts, and
   Failure Insight to 0 and posts a "start over" card.
6. Attempting to learn a *different* technique clears the previous technique's
   Failure Insight.
7. With `enforceLearning` on, Using an unlearned technique warns and spends no
   chakra; with the setting off, Use works regardless of learned state.
8. **Migration:** an actor that had techniques before the feature finds them all
   **learned** after the one-time `ready` migration; newly dropped techniques
   start unlearned.
9. **Complexity coupling:** a Kinjutsu/Combination technique requires the
   adjusted `successes`; the badge denominator matches `derived.successes`.
10. **Medkit preservation:** learn progress on an embedded technique does not
    make the medkit mark it out-of-date; syncing an out-of-date technique
    preserves its `system.learning` state.
11. **Unmapped disciplines:** `Hachimon Tonkou` / `Training` techniques remain
    usable under `enforceLearning` according to the phase-1 policy above.
