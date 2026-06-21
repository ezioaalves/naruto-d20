# Technique Empower Damage Automation Design

## Goal

Add generic automation for the common Empower pattern where a technique spends
additional chakra to add damage dice or flat damage to its action roll.

This first phase deliberately covers only damage Empower. Empower text that
changes targets, projectiles, area, duration, save DC, penalties, HP costs, or
other non-damage effects remains manual until a later, separately scoped design.

## Current State

Technique items already store `system.compEmpower`, but it only marks the
component for display. The perform flow in `scripts/use-technique.mjs` currently:

1. validates the actor, learning state, and action;
2. resolves special free-use/upkeep cases;
3. runs or bypasses the Perform check;
4. calls PF1e `item.use(...)` to roll the action;
5. spends the base chakra cost;
6. applies post-use buff automation.

PF1e v11.11 prepares `ActionUse.shared` before rolling and fires
`pf1CreateActionUse`. At that point `shared.action`, `shared.rollData`, and
`shared.damageBonus` are available. PF1e later passes `shared.damageBonus` into
normal damage rolls, including actions with damage but no attack roll. This is
the safest integration point for additive Empower damage because it does not
persist changes to `item.system.actions`.

## Data Model

Add a new explicit configuration block under `system.automation.empower`:

```js
{
  enabled: false,
  mode: "damageBonus",
  costPerStep: 1,
  formulaPerStep: "1d6",
  damageTypes: [],
  maxStepsFormula: "",
  performIncreaseEvery: 0,
  performIncreaseAmount: 0
}
```

Field meanings:

- `enabled`: turns Empower automation on for this technique.
- `mode`: initially only `"damageBonus"`.
- `costPerStep`: additional chakra spent per Empower step.
- `formulaPerStep`: damage formula added for each step, such as `"1d6"` or
  `"1d8"`.
- `damageTypes`: optional PF1e damage type ids for the added damage. Empty means
  untyped/no explicit type, matching existing technique data conventions.
- `maxStepsFormula`: formula evaluated against technique roll data to cap the
  number of steps offered in the prompt. It should normally account for the
  existing base damage already present on the action.
- `performIncreaseEvery`: if greater than 0, each complete group of this many
  Empower steps increases the Perform requirement.
- `performIncreaseAmount`: Perform DC increase per group.

`system.compEmpower` remains a component flag only. A technique can display the
Empower component without automation if its Empower text is not covered by this
phase.

## Runtime Flow

Extend `performTechnique()` around the existing Perform/action boundary:

1. Resolve the current owned item and action as the code already does.
2. If `automation.empower.enabled` is false, continue unchanged.
3. For techniques whose Empower increases Perform requirements
   (`performIncreaseEvery > 0`), prompt before the Perform check and pass the
   increased DC into Perform resolution.
4. For techniques whose Empower does not affect Perform, prompt after the
   Perform check succeeds. This preserves the current rule that failed Perform
   checks spend no chakra.
5. Compute `maxSteps` from `maxStepsFormula`, available chakra, and
   `costPerStep`.
6. Prompt the user for an integer number of Empower steps from 0 to `maxSteps`.
7. If canceled, abort the technique use.
8. Compute `extraCost = steps * costPerStep`.
9. If the total chakra cost is unaffordable, warn and abort.
10. Pass the resolved Empower context into `useTechniqueAction(...)`.
11. Inject the additional damage for that one PF1e action use through
   `pf1CreateActionUse`.
12. After a successful `item.use(...)`, spend the total chakra cost using the
    existing chakra spend path.

This split keeps the common case efficient while still supporting Rasengan-like
techniques whose Empower explicitly raises the Perform Requirements.

## Damage Injection

For `mode: "damageBonus"`, build one formula from the chosen step count:

```js
`${steps} * (${formulaPerStep})[Empower]`
```

For dice formulas, this should be normalized to ordinary dice notation where
possible, such as `3d6[Empower]` instead of `3 * (1d6)[Empower]`, so PF1e roll
cards remain readable.

The injection should be temporary:

- Normal technique actions: hook `pf1CreateActionUse` around `item.use(...)`.
- Selected weapon attack techniques: reuse the existing hook path in
  `scripts/ui/technique-weapon-attack.mjs` and add the Empower damage to the
  selected action only for that roll.

PF1e `shared.damageBonus` is a good path for untyped extra damage. If
`damageTypes` is non-empty, append a temporary `damage.parts` row to
`shared.action.damage.parts` instead, then restore it in cleanup. This keeps
typed Empower damage correct without editing source data.

## Sheet UI

Expose Empower damage automation on the existing Automation tab. Keep the fields
compact and hidden unless `system.automation.empower.enabled` is checked.

The Details tab remains responsible for component flags, including
`system.compEmpower`.

## Compendium Seeding

Do not infer config at runtime from description HTML.

Seed only a small verified set first:

- `RASENGAN (SPIRAL BLAST)`: `1 chakra -> +1d8`, max `18d8 total`, Perform +1
  per 2 empowered chakra.
- `GODAI TAIGEKI: SHODAN JUTSU`: `1 chakra -> +1d6`, max by level and the
  rulebook variant cap once that cap is verified.
- `GODAI RANSATSU: SHODAN JUTSU`: `1 chakra -> +1d6`, max `16d6`.
- `KARYUU ENDAN (FIRE DRAGON BLAST)`: `1 chakra -> +1d6 fire`, max `14d6`.

Additional techniques should be seeded incrementally after verifying each text
and current action damage formula.

## Validation

Automated validation:

- Extend compendium validation to accept and sanity-check
  `system.automation.empower`.
- Reject enabled configs with unsupported `mode`, non-positive `costPerStep`, or
  blank `formulaPerStep`.
- Warn when a technique has `compEmpower` but no automation config, because many
  valid Empower effects remain manual.

Manual Foundry verification:

- Rasengan prompts for Empower, raises Perform requirement when applicable,
  rolls extra damage, and spends base plus extra chakra.
- Godai Taigeki Shodan prompts after a successful Perform check, rolls extra
  damage, and spends total chakra.
- Canceling the Empower prompt cancels the technique without spending chakra.
- Choosing 0 Empower preserves current behavior.
- A selected weapon attack technique with Empower applies damage only to that
  triggered roll and does not persist changes on the item.

## Out of Scope

- Parsing `<b>Empower:</b>` text into rules.
- Automating Empower that changes area, duration, target count, projectile count,
  save DC, penalties, HP/self-damage, or multi-choice effects.
- Source-wide conversion of all 263 Empower techniques.
- Changing non-Empower chakra spend behavior.
