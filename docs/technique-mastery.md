# Technique Mastery

A **Mastery** field (0–5) on each technique, the analog of a spell's *caster
level offset*. It sits on the **Details** tab between Actions and Components and
follows the Mastery rules in `transcricao_tecnicas.md`.

Mastery has 5 steps (the stored value `0` means "no mastery"). Step 1+ grants a
**Perform** bonus; step 2+ also grants a **Level** offset that behaves like a
spell's caster level offset.

| Mastery step | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| **Perform** bonus | 0 | +1 | +2 | +3 | +4 | +6 |
| **Level** offset (`@cl`) | 0 | 0 | +1 | +2 | +3 | +5 |

## How it mirrors PF1e

In PF1e a spell's **caster level offset** (`system.clOffset`) is folded into the
spell's caster level, and `rollData.cl` carries it into action formulas
(duration, range, damage). Techniques are a custom, non-spell item type, so
their action rollData never receives a `cl`. We synthesize one:

```
cl = characterLevel + masteryLevel
```

`characterLevel` is `system.details.level.value` (PC) or `system.attributes.hd.total`
(NPC/HD fallback) — the same fields used elsewhere in the module. `masteryLevel`
is the Level-offset column above. This makes any action formula using `@cl`
resolve and grow with mastery, exactly like a spell's caster level offset.

The Perform bonus is the analog of mastery making a technique easier to pull
off. Per the rules text ("gain this as a bonus to meet the Perform
requirements") it applies in two places:

- **Perform roll** — added to the rolled skill total compared against the
  perform DC.
- **Threshold (bypass)** — added to the skill ranks compared against the
  technique's skill threshold, so high mastery can auto-perform without a roll.

The Perform bonus does **not** change the stored `performDC` or `skillThreshold`
— it is applied at use time, on the practitioner's side of the comparison.

## Data model

`scripts/data/technique-model.mjs`:

- New field `mastery` — `NumberField`, integer, `initial: 0`, `min: 0`, `max: 5`.
- Two lookup tables (index = mastery step):
  ```js
  export const MASTERY_PERFORM = [0, 1, 2, 3, 4, 6];
  export const MASTERY_LEVEL   = [0, 0, 1, 2, 3, 5];
  ```
- The `derived` getter exposes the resolved bonuses (clamped to 0–5):
  ```js
  const m = Math.max(0, Math.min(5, this.mastery ?? 0));
  masteryPerform: MASTERY_PERFORM[m],
  masteryLevel:   MASTERY_LEVEL[m],
  ```
  `learnDC`, `performDC`, `successes`, `skillThreshold` are unchanged.

No actor/item migration is needed: the field defaults to `0`, which reproduces
the previous behavior exactly (no offset, no perform bonus).

## `cl` injection

`scripts/data/technique-rolldata.mjs` patches
`pf1.components.ItemAction.prototype.getRollData` for technique items only,
mirroring the existing `installTechniqueSaveDCPatch` pattern:

```js
proto.getRollData = function (...args) {
    const rd = _original.apply(this, args);
    if (this.item?.type === TECHNIQUE_ITEM_TYPE) {
        const actor = this.item.actor;
        const charLevel = actor?.system?.details?.level?.value
            ?? actor?.system?.attributes?.hd?.total ?? 0;
        const offset = this.item.system?.derived?.masteryLevel ?? 0;
        rd.cl = charLevel + offset;
    }
    return rd;
};
```

`ItemAction.getRollData` is the method used by both `action.use()` (via
`shared.action.getRollData`) and the buff-duration code
(`_durationFromAction` → `action.getRollData()`), so `@cl` now resolves
everywhere an action evaluates formulas. The patch is installed in the
`pf1PostInit` hook (`scripts/main.mjs`) alongside the save-DC patch and is
idempotent (guarded by a `Symbol.for` key).

`_durationFromAction` (`scripts/automation/buff-application.mjs`) is unchanged:
its `if (!Number.isFinite(rollData.cl))` fallback no longer fires because `cl`
now arrives from the patch already including the offset; the fallback remains as
a safety net.

## Perform bonus at use time

`scripts/use-technique.mjs` reads `sys.derived.masteryPerform` and applies it to
both the threshold bypass and the roll comparison:

```js
const masteryPerform = sys.derived.masteryPerform ?? 0;

if (!skillKey || (skillRanks + masteryPerform) >= threshold) { /* auto-perform */ }
else {
    // ...rollSkill...
    succeeded = ((lastMsg?.rolls?.[0]?.total ?? 0) + masteryPerform) >= performDC;
}
```

The chat cards note `(+N mastery)` when the bonus is non-zero. The technique
sheet's perform hint (`scripts/ui/technique-sheet.mjs`) shows effective ranks as
`ranks+bonus/threshold` and computes the bypass with the same `skillRanks +
masteryPerform >= threshold`.

## Files changed

| File | Change |
|---|---|
| `scripts/data/technique-model.mjs` | `mastery` field; `MASTERY_PERFORM`/`MASTERY_LEVEL` tables; `derived.masteryPerform`/`derived.masteryLevel` |
| `scripts/data/technique-rolldata.mjs` | New — patch `ItemAction.getRollData` to inject `cl` for techniques |
| `scripts/main.mjs` | Import + install `installTechniqueRollDataPatch()` in `pf1PostInit` |
| `scripts/use-technique.mjs` | Apply perform bonus to threshold bypass + perform roll; note it in chat cards |
| `scripts/ui/technique-sheet.mjs` | Bypass/hint reflect effective ranks (`ranks+bonus`) |
| `templates/item/technique-sheet.hbs` | Mastery section on Details tab, between Actions and Components |
| `lang/en.json`, `lang/pt-BR.json` | `NarutoD20.Technique.MasteryStep.Hint` |

## Manual verification

1. Open a technique → **Details** tab: the **Mastery** section appears between
   Actions and Components, with a 0–5 input that persists.
2. **Level offset (`@cl`):** set an action's duration to `cl` rounds. Mastery 0
   and 1 → duration = character level; Mastery 2 → +1; Mastery 5 → +5 rounds.
   A range/damage formula using `@cl` grows the same way at step 2+.
3. **Perform roll:** on a discipline with a perform check, with ranks below the
   threshold and a roll just under the DC, raising Mastery (e.g. 3 → +3) makes
   the check pass; the chat card notes the mastery bonus.
4. **Perform threshold (bypass):** ranks = `threshold − 2`. Mastery 0 → must
   roll; a mastery giving +2 or more Perform → auto-perform. The sheet hint
   shows the effective ranks.
5. **Regression:** Mastery 0 reproduces prior behavior (no offset, no perform
   bonus); fixed numeric durations and disciplines without a learn skill still
   work.
