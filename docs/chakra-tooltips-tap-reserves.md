# Chakra Pool/Reserve Tooltips, Tap Reserves & Temp Absorption

Four related improvements to the Chakra tab:

1. **Chakra Pool Max** and **Chakra Reserve Max** display hover tooltips with a
   per-source breakdown, identical in style to the learn check tooltips.
2. **Chakra Pool** has a new **Temp** column for temporary chakra.
3. **Chakra Reserve header** is clickable and opens a custom **Tap Reserves**
   roll dialog.
4. **Temporary chakra is consumed before the regular pool** when a technique is
   used — mirroring PF1e's temporary hit point absorption pattern.

---

## Tap Reserves — rule summary

> You can gain temporary Chakra by transferring it from your Chakra Reserves.
> A successful check grants temporary Chakra and lowers your Chakra Reserves by
> the same amount. The temporary Chakra dissipates after 1 minute per level.
>
> Base DC = 10 + 1 per point of Chakra tapped.
> Half-seal: DC −2. Hand seal: DC −5 (choose one).

The roll uses the actor's **Chakra Control (ckc)** learn check modifier.

---

## Chakra max formulas

```
Chakra Pool Max    = 2 + ((2 + Con Mod) × Level) + maxBonus
Chakra Reserve Max = (2 × Level) + maxBonus
```

`maxBonus` in both cases is the write target for PF1e's changes engine
(buff target keys `chakraPool` / `chakraReserve`, declared in `BUFF_TARGETS`
in `scripts/flag-paths.mjs`). It is reset to `0` in `prepareBaseActorData`
and written by the engine before `prepareDerivedActorData` computes the total.

---

## Data model

All new state lives in actor flags under `flags["naruto-d20"]`:

```
flags["naruto-d20"].chakra.pool.temp      # temporary chakra (preserved, never reset)
flags["naruto-d20"].chakra.pool.maxBonus  # buff write-target (reset each prep)
flags["naruto-d20"].chakra.reserve.maxBonus  # buff write-target (reset each prep)
```

`pool.temp` uses `??= 0` in `prepareBaseActorData` — it is initialised once and
never overwritten by the data pipeline, so it survives re-renders and
pf1PrepareBaseActorData calls.

---

## Tooltip breakdown (from sources)

Two new builder functions in `scripts/data/bonus-sources.mjs` mirror the
existing `buildLearnCheckBreakdown`:

### `buildChakraPoolBreakdown(actor)`

| Source | Value | builtIn |
|---|---|---|
| Base (2 + 2×Lv) | `2 + (2 × charLevel)` | true |
| Con × Level | `conMod × charLevel` | true (omitted if 0) |
| Per-buff name | from `actor.sourceInfo[chakraPoolMaxBonusPath]?.positive` | false |
| Buff Bonus (fallback) | lump-sum `maxBonus` | false |

### `buildChakraReserveBreakdown(actor)`

| Source | Value | builtIn |
|---|---|---|
| 2 × Level | `2 × charLevel` | true |
| Per-buff name | from `actor.sourceInfo[chakraReserveMaxBonusPath]?.positive` | false |
| Buff Bonus (fallback) | lump-sum `maxBonus` | false |

Both functions return `{ sources }` only (no `parts` — these are static values,
not roll formulas). The fallback to a lump-sum "Buff Bonus" row fires only when
`actor.sourceInfo` has no entries for the path — i.e. when a buff was applied
but PF1e's changes engine hasn't repopulated sourceInfo yet, which is rare.

Tooltip listeners are wired in `registerLearnCheckListeners()`
(`scripts/ui/learn-checks.mjs`) inside the existing `renderActorSheetPF` hook,
using `data-naruto-tooltip="chakra.pool.max"` and
`data-naruto-tooltip="chakra.reserve.max"` as selectors (same namespace as
learn checks, no collision with PF1e's own `data-tooltip`).

---

## TapReservesDialog

`scripts/ui/tap-reserves.mjs` — `TapReservesDialog extends Application` (V1).

### Dialog fields

| Field | Behaviour |
|---|---|
| Chakra to Tap | Number input, min 1, max = current reserve value |
| Seals | Radio group (name="seal-type"): None / Half-seal (DC −2) / Hand seal (DC −5) |
| DC | Read-only span, updated live: `10 + amount − sealBonus` |
| Situational Bonus | Free-form formula, added as a labeled `[Situational]` part |
| Roll Mode | `{{selectOptions rollModes selected=currentRollMode localize=true}}` — same pattern as PF1e's `roll-dialog.hbs` |

### Roll mode population

`CONFIG.Dice.rollModes` is passed as-is to the template. The Handlebars helper
`selectOptions` with `localize=true` handles per-version differences in the
object shape (Foundry v13 values are not plain strings). Calling
`game.i18n.localize()` directly on those values throws a TypeError.

### Roll

```js
const chatMsg = await pf1.dice.d20Roll({
    skipDialog: true,   // skip PF1e's own dialog — we already collected params
    flavor,             // "Tap Reserves — N chakra[, seal]"
    parts,              // CKC breakdown parts + optional Situational
    rollData, speaker,
    rollMode,
    dc,                 // causes D20RollPF to set isSuccess/isFailure on the card
});
```

`pf1.dice.d20Roll` (confirmed in `pf1.js`) accepts `skipDialog` and `dc`. The
returned value is a `ChatMessage`; its `rolls[0].total` is compared against `dc`
to determine success.

Using `pf1.dice.d20Roll` instead of a bare `new Roll().toMessage()` ensures the
chat card matches the system's native d20 roll format (compact `20 +11 ⇒ 31`
summary, expandable per-source breakdown rows, success/failure indicator).

### Automation on success

```js
await actor.update({
    [`flags.naruto-d20.chakra.reserve.value`]: Math.max(0, reserve - amount),
    [`flags.naruto-d20.chakra.pool.temp`]:     temp + amount,
});
```

On failure, only the chat card is posted; values are unchanged.

### Listener registration

`registerTapReservesListener()` wires a `click` handler on `.tap-reserve-roll`
via `renderActorSheetPF`. It is called once in the `[7] setup` hook in
`scripts/main.mjs`.

---

## Temporary chakra absorption

When a technique is used, chakra is consumed in priority order:

```
temp → pool.value → reserve.value
```

This mirrors PF1e's `applyDamage` pattern for temporary hit points.

### Algorithm (`scripts/use-technique.mjs`)

```js
const fromTemp    = Math.min(cost, tempValue);   // temp absorbs what it can
const remaining   = cost - fromTemp;
const fromPool    = Math.min(remaining, poolValue);
const fromReserve = remaining - fromPool;

await actor.update({
    [chakraPoolTempPath]:     tempValue    - fromTemp,
    [chakraPoolValuePath]:    poolValue    - fromPool,
    [chakraReserveValuePath]: reserveValue - fromReserve,
});
```

`canAffordTechnique` also counts temp in the total available:
```js
const available = (chakra.pool?.temp ?? 0) + (chakra.pool?.value ?? 0) + (chakra.reserve?.value ?? 0);
```

The chat card spend summary omits zero-value sources
(e.g. "Spent 7 chakra (3 temp, 4 pool)" instead of showing "0 reserve").

`chakraPoolTempPath` is exported from `scripts/flag-paths.mjs` alongside the
other chakra flag-path constants.

---

## Files changed

| File | Change |
|---|---|
| `scripts/data/bonus-sources.mjs` | `buildChakraPoolBreakdown()` + `buildChakraReserveBreakdown()` |
| `scripts/data/derived-data.mjs` | `chakra.pool.temp ??= 0` in `prepareBaseActorData` |
| `scripts/ui/learn-checks.mjs` | Tooltip listeners for `chakra.pool.max` and `chakra.reserve.max` |
| `scripts/ui/tap-reserves.mjs` | **new** — `TapReservesDialog` + `registerTapReservesListener()` |
| `templates/actor/chakra-tab.hbs` | `data-naruto-tooltip` on max spans; Temp column in Pool; clickable Reserve header |
| `templates/actor/tap-reserves-dialog.hbs` | **new** — dialog template |
| `scripts/main.mjs` | Import tap-reserves; add template to preload; call listener in setup |
| `styles/naruto-d20.css` | Styles for dialog DC display, seal hints, buttons, Reserve header hover |
| `scripts/flag-paths.mjs` | `chakraPoolTempPath` export |
| `scripts/use-technique.mjs` | Temp absorption logic in `canAffordTechnique` + `performTechnique` |

No actor migration is needed: `prepareBaseActorData` seeds `chakra.pool.temp`
with `??=` on every data prep.

---

## Manual verification

1. **Reload** (`Ctrl+R`). Open a character → **Chakra** tab.
2. **Pool Max tooltip** — hover over the Pool Max value → extended tooltip appears
   showing "Base (2+2×Lv)", "Con × Level", and any active buff rows.
3. **Reserve Max tooltip** — hover over Reserve Max → tooltip shows "2 × Level"
   plus buff rows.
4. **Temp field** — Chakra Pool section now shows three columns:
   Current | Temp | Max.
5. **Tap Reserves dialog** — click the "🎲 Chakra Reserve" header:
   - Dialog opens with Amount, Seals, DC, Situational Bonus, Roll Mode.
   - Roll Mode dropdown shows localised labels ("Public Roll" etc.).
   - Changing amount updates DC live (e.g. amount=5, no seal → DC 15).
   - Selecting Half-seal → DC −2; Hand seal → DC −5.
6. **Roll** — click Roll:
   - Chat card appears in PF1e's native d20 roll style.
   - Card title is "Tap Reserves — N chakra[, seal]".
   - Expandable breakdown shows CKC sources (Character Level, ability mod, buffs).
   - On **success**: Reserve decreases; Temp increases by the tapped amount.
   - On **failure**: values unchanged.
7. **Buff integration** — apply a "Chakra Pool Max" buff to the actor:
   - Pool Max increases; tooltip shows the buff's name as a separate row.
   - Apply a "Chakra Reserve Max" buff → same for Reserve tooltip.
8. **Temp absorption** — use Tap Reserves to gain temp chakra, then use a technique:
   - Cost ≤ temp: only Temp field decreases; pool unchanged.
   - Cost > temp (e.g. temp=3, cost=7): Temp → 0, pool loses 4.
   - Cost > temp + pool: reserve absorbs the overflow.
   - Chat card footer shows only the sources that contributed (e.g.
     "Spent 7 chakra (3 temp, 4 pool)" — no "0 reserve" noise).
