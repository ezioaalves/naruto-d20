# Chakra-Damage Upkeep + Kyu-Mon Kai (Heal Gate) automation

**Date:** 2026-06-13
**Status:** Approved (design)
**Scope:** Build the reusable `chakraDamage` turn-maintenance primitive and fully
wire Kyu-Mon Kai (Heal Gate Release) as its first consumer. The remaining 7 gates
are deliberately out of scope and will reuse this primitive in later iterations.

## Background

The Eight Gates (Hachimon Tonkou) techniques are sustained, self-targeted
"stances" that drain the shinobi each round. The turn-maintenance engine
(`scripts/automation/turn-maintenance.mjs`, merged in #118) already centralizes
start-of-turn upkeep for two cost resources: `hp` (Kai-Mon Kai / Amatsu) and
`chakra` (rank buffs). It dispatches on `technique.system.automation.maintenance.resource`.

Most gates, however, cost **Chakra damage**, a distinct mechanic that the engine
does not yet model. Per the rulebook (`chakra_damage.png`):

> **Chakra Damage:** subtracted directly from a character's Chakra Pool. Against
> targets with an empty Chakra Pool, Chakra Damage is doubled and applied to the
> target's hit points instead.

Kyu-Mon Kai (Heal Gate Release) is the chosen pilot:

- Inherits the Kai-Mon Kai bonuses (+2 enh Str/Dex, +10 ft land speed) — already
  automated by the existing compendium buff `KYU_MON_KAI__HEAL_GATE_RELEASE__1d8e3b4a7c6f9021.json`.
- Grants **Fast Healing 2**.
- **Ignores fatigue/exhaustion** while open.
- Str/Dex ability damage is temporarily ineffective (returns when it ends).
- Takes **3 Chakra damage** (no normal damage) per round.
- **Mastery:** steps 1/3/5 each raise Fast Healing by 1 (→ up to FH 5); step 5 also
  drops Chakra damage to 2/round; step 2 lets it open as part of a greater Gate
  (no benefits, no penalties).

## Decisions (resolved during brainstorming)

1. **Deliverable scope:** generic `chakraDamage` primitive + Heal Gate fully wired.
2. **Partial overflow:** `temp + pool` absorb the damage (consistent with
   `availableChakra`); any **unabsorbed remainder is doubled and dealt to HP**.
   Example: pool=1, damage=3 → pool 1→0, remainder 2 ×2 = 4 HP.
3. **Reserve is never touched** by chakra damage, and the deliberate-spend
   "emergency transfer" (burn reserve → 1 pool) does **not** fire — damage is not a
   deliberate spend.
4. **Lethal guard:** if the HP overflow would drop HP below 1, the gate **ends**
   (same semantics as the existing forced HP upkeep), rather than applying the hit.
5. **Automated Heal-Gate effects this iteration:** chakra damage, Kai-Mon bonuses
   (already done), **Fast Healing** (per-turn heal), and **ignoring
   fatigue/exhaustion** (clear those conditions each turn).
6. **Left manual** (buff keeps a note): Str/Dex damage immunity; the step-2
   "open as part of a greater Gate" edge case.

## API facts (verified against v11.11 source)

- `system.traits.fastHealing` is a **string** display field (`public/template.json:717`),
  surfaced only in the defenses chat card and as the `@traits.fastHealing` rolldata
  path. **PF1e does not auto-apply fast healing** and there is no numeric buff change
  target for it — the per-round HP must be healed by our own turn hook. (Recorded in
  the `pf1e-api-check` verified-api cache.)
- Foundry/`RollPF` formulas support `floor()`/`ceil()` but **not** ternary `?:`, so
  mastery scaling is expressed with floor/ceil arithmetic.

## Architecture

One new pure module, a schema extension, and engine wiring. The turn pipeline stays
single: the maintenance buff expires at `turnStart`, the engine reads the source
technique's facets, resolves the cost, then refreshes the buff and applies benefits.

### 1. `scripts/data/chakra-damage.mjs` (new, pure, unit-tested)

Mirrors `hp-cost.mjs`'s roll/commit split so the engine can resolve the amount,
check the lethal guard, and only then commit.

- `calculateChakraDamage(actor, amount)` → `{ temp, pool, absorbed, hpOverflow }`.
  Absorbs from `temp` first, then `pool` (floors at 0). `hpOverflow = (amount - absorbed) * 2`.
  Reserve is never read or written; no emergency transfer.
- `commitChakraDamage(actor, calc)` — writes new temp/pool (via the existing
  `chakraPool*Path` flag paths), subtracts `hpOverflow` from HP when present, runs
  `checkAndUpdateConditions(actor)`, and posts a chat message:
  `"<technique>: N chakra damage (pool X→Y)"` plus `" +M HP (overflow)"` when overflow > 0.
- Amount comes from a roll formula evaluated by the caller, so the formula (with
  `@mastery`) stays in the engine layer; this module takes a resolved integer.

**Condition-trigger note (implementation guard):** chakra damage can leave
`pool == 0` while `reserve > 0` (no emergency transfer). Verify
`checkAndUpdateConditions` keys Chakra Depletion off the **reserve**, not the pool,
so damage to an empty pool does not falsely trigger Depletion. Adjust the call /
add a regression test if it does.

### 2. Schema — `technique-model.mjs` `automation.maintenance`

- `resource` choices: add `"chakraDamage"` → `["", "chakra", "hp", "chakraDamage"]`.
- New optional facets:
  - `heal`: `StringField` (roll formula, default `""`). `""` = no per-turn heal.
  - `clearConditions`: `StringField` (CSV of PF1e condition ids, default `""`).
- `maintenanceFacets()` in `maintenance-buffs.mjs` surfaces `heal` and
  `clearConditions` (parsed to a trimmed string array) alongside the existing facets.

### 3. Engine — `turn-maintenance.mjs`

- `runMaintenance`: add `if (facets.resource === "chakraDamage") return maintainChakraDamageUpkeep(...)`.
- `maintainChakraDamageUpkeep(actor, itemId, technique, facets, flag)` (forced only):
  1. Evaluate `facets.cost` as a formula with `{ ...actor.getRollData(), mastery: step }`
     where `step = Number(technique.system.mastery) || 0`. Clamp to ≥ 0 integer.
  2. `calculateChakraDamage(actor, amount)`. If `hpOverflow > 0` and
     `hp - hpOverflow < 1` → `deleteMaintenanceBuff` + `UpkeepEnded` notification, return.
  3. `commitChakraDamage` → `completeMaintenance`.
- `completeMaintenance`: after the buff is refreshed, call `applyTurnBenefits(actor, technique, facets)`:
  - `heal`: roll `facets.heal` with the same `@mastery` rolldata, heal that many HP
    clamped to `hp.max`; post/append feedback; set `system.traits.fastHealing` to the
    healed value for display.
  - `clearConditions`: for each id, clear the PF1e condition if set.
- Generalize the existing refresh branch (currently `resource === "hp" || element`)
  and `applyTechniqueBuff`'s entry branch to also route `resource === "chakraDamage"`
  through `applyUpkeepBuff` (which stamps the maintenance flag + `turnStart` duration
  by technique name).
- **Teardown:** when the engine deletes a maintenance buff whose technique has a
  non-empty `heal` facet, clear `system.traits.fastHealing` (snapshot/restore the
  prior value via a buff flag if a prior non-empty value existed; otherwise clear).

### 4. Mastery formulas (data, on the technique)

- Chakra damage cost: `"3 - floor(@mastery / 5)"` → m<5 → 3, m=5 → 2.
- Fast Healing: `"2 + ceil(@mastery / 2)"` → m0→2, m1→3, m2→3, m3→4, m4→4, m5→5.

### 5. Heal-Gate content

`packs/_source/techniques/KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json`:

```jsonc
"automation": {
  "enabled": true,
  "targetMode": "self",
  "maintenance": {
    "enabled": true,
    "resource": "chakraDamage",
    "cost": "3 - floor(@mastery / 5)",
    "policy": "forced",
    "interval": 1,
    "heal": "2 + ceil(@mastery / 2)",
    "clearConditions": "fatigued,exhausted"
  }
}
```

Buff `KYU_MON_KAI__HEAL_GATE_RELEASE__1d8e3b4a7c6f9021.json`: keep the existing
Str/Dex/landSpeed changes; rewrite the description so it no longer claims Fast
Healing / fatigue / chakra damage are un-automated (it should now note only the
still-manual bits: Str/Dex ability-damage immunity and the step-2 greater-Gate case).

Repack via the documented `npm run pack` workflow.

## Testing

- **Unit (`tests/`):** `calculateChakraDamage` — full pool absorption (no HP);
  partial overflow doubled to HP; empty pool → full doubled to HP; reserve untouched;
  temp consumed before pool. Mastery formula evaluation at steps 0/1/3/5 for both
  chakra-damage and fast-healing formulas.
- **Manual QA (`docs/manual-qa.md` addition):** perform Heal Gate → buff applies with
  Kai-Mon bonuses; on each of the performer's turns, 3 chakra leaves the pool and
  +2 HP is healed; an empty pool routes 6 HP of overflow; lethal overflow ends the
  gate with a notification; fatigued/exhausted are cleared each turn; mastery 5 shows
  2 chakra damage and Fast Healing 5; ending the gate clears `traits.fastHealing`.

## Out of scope

- The other 7 gate techniques (will reuse `chakraDamage` + the `heal`/`clearConditions`
  facets in later iterations).
- Str/Dex ability-damage immunity automation.
- The step-2 "open as part of a greater Gate" interaction.
