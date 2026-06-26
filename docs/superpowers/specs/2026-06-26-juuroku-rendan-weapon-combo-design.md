# Juuroku Rendan — weapon-selected fixed 3-hit combo

**Date:** 2026-06-26
**Technique:** `TAIJUTSU: JUUROKU RENDAN (HAND-TO-HAND: SIXTEEN HIT COMBO)`
(`packs/_source/techniques/TAIJUTSU__JUUROKU_RENDAN__HAND_TO_HAND__SIXTEEN_HIT_COMBO__SRbVxeFEgnKX1MFI.json`, id `SRbVxeFEgnKX1MFI`)

## Problem

The technique text reads: *"Make three unarmed attacks at a -5 penalty. Each attack deals 2d6
damage, plus your Strength modifier, on hit."* Today the technique rolls its own bare `mwak`
action. It does **not**:

1. let the player pick which weapon/attack to strike with (the way `Raite no Jutsu` does);
2. apply the text's damage (2d6 + Str) onto the chosen attack;
3. roll the three attacks together in a single full-attack chat card.

## Goal

Make Juuroku Rendan behave like `Raite no Jutsu` for weapon selection and damage replacement,
and roll **exactly three** unarmed attacks — all at a flat −5 — in one chat card, regardless of
the character's BAB.

## Approach

Reuse the existing `weaponAttack` mechanism (`scripts/features/techniques/weapon-attack.mjs`),
driven entirely from the technique's `system.flags.dictionary` config — the same path
`Raite no Jutsu` and the Sangeki "Three Hit Kill" techniques already use. One small, **opt-in**
addition to the shared code lets a technique declare a fixed attack count with no BAB iteratives.

### Decisions taken (from brainstorming)

- **Exactly three attacks, always** — no BAB iterative attacks layered on for high-BAB
  characters. (Requires exposing PF1e's `custom` extra-attack type.)
- **Surgical scope** — the no-iteratives behavior is opt-in per technique. The existing Sangeki
  "Three Hit Kill" techniques keep their current behavior and are **not** modified, even though
  they share the same latent "BAB iteratives stack on top" trait.

## Part 1 — Code change: expose a no-iteratives mode

File: `scripts/features/techniques/weapon-attack.mjs`

PF1e's `pf1.config.extraAttacks` types (v11.11):
- `advanced` → `manual: true, iteratives: true` (current default when a technique declares
  `extraAttacks`)
- `custom` → `manual: true, iteratives: false` (fixed manual attacks, **no** BAB iteratives)

Two edits:

1. **Parser** (`parseWeaponAttackConfig`):
   - Add `"iteratives"` to `KNOWN_KEYS`.
   - Parse it as a boolean defaulting to `true`, mirroring the existing `charge` boolean handling
     (accept `"true"`/`"false"`/empty; emit the existing `InvalidBoolean` warning otherwise).
   - Include `iteratives` in the returned `config` object.

2. **Apply block** (the `if (config.extraAttacks?.length)` section, ~line 308 of the current
   file): choose the extra-attack type based on the flag. When `config.iteratives === false`,
   force `"custom"`; otherwise keep today's behavior.

   ```js
   const originalType = exAtk?.type;
   const supportsManual = pf1.config.extraAttacks[originalType]?.manual === true;
   if (config.iteratives === false) exAtk.type = "custom";   // fixed count, no BAB iteratives
   else if (!supportsManual) exAtk.type = "advanced";        // existing default
   const manual = (exAtk.manual ??= []);
   // ...existing manual-push + cleanup (originalType restore) unchanged...
   ```

   The existing cleanup already restores `exAtk.type = originalType`, so teardown needs no change.

**Backwards compatibility:** with `iteratives` absent the parser yields `true`, so every existing
technique (Sangeki, Raite, etc.) keeps its current behavior. `use.mjs` already passes the whole
config object through to `rollSelectedWeaponAttackWithTechnique` (`use.mjs:468`), so no change is
needed there.

## Part 2 — Data change: the technique JSON

File:
`packs/_source/techniques/TAIJUTSU__JUUROKU_RENDAN__HAND_TO_HAND__SIXTEEN_HIT_COMBO__SRbVxeFEgnKX1MFI.json`

Add to `system.flags.dictionary` (currently `{}`):

```json
"weaponAttack.mode": "selected",
"weaponAttack.filter": "unarmedOnly",
"weaponAttack.damageMode": "replace",
"weaponAttack.attackBonus": "-5",
"weaponAttack.extraAttacks": "0|Second Attack;0|Third Attack",
"weaponAttack.iteratives": "false"
```

Mapping to requirements:

| Requirement | Config |
|---|---|
| Pick the striking weapon/attack | `mode: selected` + `filter: unarmedOnly` → same picker as Raite, listing the actor's unarmed/natural attacks |
| Damage = 2d6 + Str | `damageMode: replace` swaps the chosen attack's damage for the technique action's own `2d6` part; the action's `ability.damage: "str"` adds the Str modifier. Attack ability (Str-to-hit) is **not** replaced, so to-hit stays correct |
| Three attacks, all −5, one card | `attackBonus: "-5"` applies −5 to every attack globally; `extraAttacks` adds two more at `+0` relative → all three at −5. `iteratives: "false"` guarantees exactly three regardless of BAB |

Two correctness touches on the existing technique **action** (`system.actions[0]`), so the
replaced attack is a clean melee bludgeoning strike instead of inheriting placeholder values:

- Set the `2d6` damage part's `types` to `["bludgeoning"]` (currently `[]` → untyped). Verify the
  exact damage-type id against the v11.11 source before writing.
- Change the action's `range.units` from `"touch"` to `"melee"` (it is a melee combo, not a touch
  attack).

After editing source JSON, repack with `npm run pack`.

## Out of scope

- **Stunned-on-hit / Fortitude save automation.** The action already carries the `fort`
  "Fortitude partial" save, and the weapon-attack flow already applies it with the technique DC,
  so the save still appears on the card. Auto-*applying* the `stunned` condition is not built and
  was not requested; the GM applies it manually. Unchanged.
- **The "Rendan Kidouki" prerequisite.** Narrative text only; no automation.

## Deployment / verification note

The edit lands in the compendium source. An actor's **already-imported** copy of the technique
will not update automatically — it needs a re-import from the compendium (or a manual flag edit on
the owned item). Verification on a live character must account for this.

## Verification checklist

- [ ] Using the technique opens the unarmed-attack picker (like Raite).
- [ ] The resulting chat card rolls **three** attacks, all at −5 to hit, in one card.
- [ ] A high-BAB character (6+ BAB) still rolls **exactly three** attacks (no iteratives).
- [ ] Each attack's damage is `2d6 + Str` bludgeoning.
- [ ] The Fortitude save still shows on the card with the technique DC.
- [ ] Sangeki "Three Hit Kill" techniques are unchanged (still behave as before).
