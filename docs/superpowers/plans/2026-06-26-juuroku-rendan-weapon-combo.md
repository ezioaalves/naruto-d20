# Juuroku Rendan — weapon-selected fixed 3-hit combo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Juuroku Rendan technique let the player pick an unarmed attack, replace its damage with 2d6 + Str, and roll exactly three attacks (all at −5) in one chat card — regardless of BAB.

**Architecture:** Reuse the existing `weaponAttack` mechanism in `scripts/features/techniques/weapon-attack.mjs` (the same path `Raite no Jutsu` uses), driven from the technique's `system.flags.dictionary`. Add one opt-in `weaponAttack.iteratives` flag so a technique can use PF1e's `custom` extra-attack type (manual attacks, **no** BAB iteratives). Then configure the technique JSON and repack.

**Tech Stack:** Foundry VTT v13 module, PF1e v11.11 system, ESM (no build step), Node's built-in test runner (`node --test`), ESLint + Prettier + Stylelint, FoundryVTT CLI for compendium packing.

**Spec:** `docs/superpowers/specs/2026-06-26-juuroku-rendan-weapon-combo-design.md`

## Global Constraints

- PF1e system **v11.11** is the API ground truth; verify any `pf1.*` / `CONFIG.PF1.*` against the `foundryvtt-pathfinder1-v11.11/` source mirror, never the built `pf1.js` or context7.
- No build step — source is ESM loaded directly by Foundry.
- Default to V1 `Application` for any UI (not relevant here, but holds).
- Work on branch `feat/juuroku-rendan-weapon-combo`; squash-merge into `master` via PR. Never commit to `master`.
- All non-technique module data lives in actor flags; technique data lives in `item.system.*` only.
- `npm run test` and `npm run lint` must pass before any commit.
- PF1e extra-attack type ids (v11.11): `advanced` = `{ manual: true, iteratives: true }`; `custom` = `{ manual: true, iteratives: false }`.
- PF1e damage-type id for bludgeoning is the exact string `"bludgeoning"`.
- End every git commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Expose a no-iteratives mode in the weaponAttack config

Add a `weaponAttack.iteratives` boolean (default `true`) to the parser, and a pure
`chooseExtraAttacksType` helper that selects PF1e's extra-attack type. Wire the helper into the
apply block so `iteratives: false` forces the `custom` type (no BAB iteratives). Existing
techniques (Sangeki, Raite) are unaffected because the flag defaults to `true`.

**Files:**
- Modify: `scripts/features/techniques/weapon-attack.mjs`
- Test: `tests/weapon-attack-iteratives.test.mjs` (create)

**Interfaces:**
- Consumes: existing `parseWeaponAttackConfig({ values, keys, malformed })` and the `KNOWN_KEYS` /
  `str(key)` / `issue(key, data)` helpers already in the file.
- Produces:
  - `parseWeaponAttackConfig(...)` return `config` now includes `iteratives: boolean` (default `true`,
    `false` only when the raw value is the string `"false"`).
  - `chooseExtraAttacksType({ originalType: string, originalSupportsManual: boolean, iteratives: boolean }): string`
    — returns `"custom"` when `iteratives === false`, else `"advanced"` when `!originalSupportsManual`,
    else `originalType`. Exported.

- [ ] **Step 1: Write the failing tests**

Create `tests/weapon-attack-iteratives.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseWeaponAttackConfig,
  chooseExtraAttacksType,
} from "../scripts/features/techniques/weapon-attack.mjs";

describe("weaponAttack iteratives parsing", () => {
  const parse = (values) =>
    parseWeaponAttackConfig({
      malformed: false,
      keys: new Set(Object.keys(values)),
      values,
    });

  it("defaults iteratives to true when the key is absent", () => {
    const { config, warnings } = parse({ mode: "selected" });
    assert.equal(config.iteratives, true);
    assert.deepEqual(warnings, []);
  });

  it('parses iteratives = "false"', () => {
    const { config, warnings } = parse({ mode: "selected", iteratives: "false" });
    assert.equal(config.iteratives, false);
    assert.deepEqual(warnings, []);
  });

  it('parses iteratives = "true"', () => {
    const { config } = parse({ mode: "selected", iteratives: "true" });
    assert.equal(config.iteratives, true);
  });

  it("warns on a non-boolean iteratives value and keeps the default", () => {
    const { config, warnings } = parse({ mode: "selected", iteratives: "maybe" });
    assert.equal(config.iteratives, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /weaponAttack\.iteratives/);
  });

  it("does not flag iteratives as an unknown field", () => {
    const { warnings } = parse({ mode: "selected", iteratives: "false" });
    assert.deepEqual(warnings, []);
  });
});

describe("chooseExtraAttacksType", () => {
  it("forces custom (no BAB iteratives) when iteratives is false", () => {
    assert.equal(
      chooseExtraAttacksType({ originalType: "standard", originalSupportsManual: false, iteratives: false }),
      "custom",
    );
    assert.equal(
      chooseExtraAttacksType({ originalType: "advanced", originalSupportsManual: true, iteratives: false }),
      "custom",
    );
  });

  it("falls back to advanced when the original type lacks manual support", () => {
    assert.equal(
      chooseExtraAttacksType({ originalType: "standard", originalSupportsManual: false, iteratives: true }),
      "advanced",
    );
  });

  it("preserves a manual-capable original type when iteratives is true", () => {
    assert.equal(
      chooseExtraAttacksType({ originalType: "advanced", originalSupportsManual: true, iteratives: true }),
      "advanced",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `chooseExtraAttacksType` is not exported (`undefined`), and the iteratives
assertions fail because `config.iteratives` is `undefined`.

- [ ] **Step 3: Add `"iteratives"` to `KNOWN_KEYS`**

In `scripts/features/techniques/weapon-attack.mjs`, the `KNOWN_KEYS` set (currently lines ~15-26)
add `"iteratives"`:

```js
const KNOWN_KEYS = new Set([
  "mode",
  "filter",
  "damageMode",
  "attackBonus",
  "damageBonus",
  "nonCritDamageBonus",
  "extraAttacks",
  "held",
  "charge",
  "iteratives",
  "suppressedBonuses",
]);
```

- [ ] **Step 4: Parse the `iteratives` boolean and add it to the config**

In `parseWeaponAttackConfig`, directly after the existing `chargeRaw` validation block (it ends
with the `InvalidBoolean` warning push for `charge`), add a sibling block:

```js
  const iterativesRaw = str("iteratives").toLowerCase();
  if (iterativesRaw && iterativesRaw !== "true" && iterativesRaw !== "false") {
    warnings.push(
      issue("InvalidBoolean", {
        field: `${CONFIG_PREFIX}.iteratives`,
        value: iterativesRaw,
      }),
    );
  }
```

Then in the returned `config` object literal (the one that already lists `charge:` and
`suppressedBonuses`), add the field (place it right after `charge: chargeRaw === "true",`):

```js
      iteratives: iterativesRaw === "false" ? false : true,
```

- [ ] **Step 5: Add the exported `chooseExtraAttacksType` helper**

Add this exported function near the other exported helpers in the file (e.g. directly above
`export function getTechniqueWeaponAttackConfig`):

```js
/**
 * Pick the pf1 extraAttacks type for a technique that declares manual extra attacks.
 * `iteratives === false` forces "custom" (manual attacks, no BAB iteratives). Otherwise keep a
 * manual-capable original type, falling back to "advanced" when the original type can't hold
 * manual extras.
 */
export function chooseExtraAttacksType({ originalType, originalSupportsManual, iteratives }) {
  if (iteratives === false) return "custom";
  if (!originalSupportsManual) return "advanced";
  return originalType;
}
```

- [ ] **Step 6: Wire the helper into the apply block**

In `rollSelectedWeaponAttackWithTechnique`, replace the existing
`if (config.extraAttacks?.length) { ... }` block (currently ~lines 308-320) with:

```js
    if (config.extraAttacks?.length) {
      const exAtk = actionUse.shared.action.extraAttacks;
      const originalType = exAtk?.type;
      const originalSupportsManual = pf1.config.extraAttacks[originalType]?.manual === true;
      exAtk.type = chooseExtraAttacksType({
        originalType,
        originalSupportsManual,
        iteratives: config.iteratives,
      });
      const manual = (exAtk.manual ??= []);
      const originalLength = manual.length;
      for (const atk of config.extraAttacks) manual.push(atk);
      cleanup.push(() => {
        exAtk.type = originalType;
        manual.splice(originalLength);
      });
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all new tests green, and the existing
`tests/technique-bonus-suppression.test.mjs` suite still passes.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors. If Prettier flags formatting, run `npm run lint:fix` and re-run `npm run lint`.

- [ ] **Step 9: Commit**

```bash
git add scripts/features/techniques/weapon-attack.mjs tests/weapon-attack-iteratives.test.mjs
git commit -m "feat(techniques): add weaponAttack iteratives opt-out

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Configure the Juuroku Rendan technique and repack

Add the `weaponAttack` dictionary config to the technique source JSON, set the action's damage type
to bludgeoning and its range to melee, then rebuild the techniques compendium.

**Files:**
- Modify: `packs/_source/techniques/TAIJUTSU__JUUROKU_RENDAN__HAND_TO_HAND__SIXTEEN_HIT_COMBO__SRbVxeFEgnKX1MFI.json`
- Regenerate (binary): `packs/techniques/**` (via `npm run pack`)

**Interfaces:**
- Consumes: the `weaponAttack.iteratives` flag and `chooseExtraAttacksType` behavior from Task 1.
- Produces: a technique whose `system.flags.dictionary` carries the full `weaponAttack` config; no
  code depends on this task.

- [ ] **Step 1: Add the weaponAttack dictionary config**

In the JSON file, the `system.flags` block currently reads:

```json
    "flags": {
      "boolean": {},
      "dictionary": {}
    },
```

Replace the empty `dictionary` with:

```json
    "flags": {
      "boolean": {},
      "dictionary": {
        "weaponAttack.mode": "selected",
        "weaponAttack.filter": "unarmedOnly",
        "weaponAttack.damageMode": "replace",
        "weaponAttack.attackBonus": "-5",
        "weaponAttack.extraAttacks": "0|Second Attack;0|Third Attack",
        "weaponAttack.iteratives": "false"
      }
    },
```

- [ ] **Step 2: Set the damage type to bludgeoning**

In `system.actions[0].damage.parts`, change the part's empty `types` array:

```json
          "parts": [
            {
              "formula": "2d6",
              "types": []
            }
          ]
```

to:

```json
          "parts": [
            {
              "formula": "2d6",
              "types": ["bludgeoning"]
            }
          ]
```

- [ ] **Step 3: Set the action range to melee**

In `system.actions[0].range`, change:

```json
        "range": {
          "units": "touch"
        },
```

to:

```json
        "range": {
          "units": "melee"
        },
```

- [ ] **Step 4: Validate the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('packs/_source/techniques/TAIJUTSU__JUUROKU_RENDAN__HAND_TO_HAND__SIXTEEN_HIT_COMBO__SRbVxeFEgnKX1MFI.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no parse error).

- [ ] **Step 5: Repack the techniques compendium**

Run: `npm run pack`
Expected: completes without error; `git status` shows modified binary files under
`packs/techniques/`.

- [ ] **Step 6: Validate the compendia**

Run: `npm run validate:compendia`
Expected: passes (no validation errors for the techniques pack).

- [ ] **Step 7: Commit**

```bash
git add "packs/_source/techniques/TAIJUTSU__JUUROKU_RENDAN__HAND_TO_HAND__SIXTEEN_HIT_COMBO__SRbVxeFEgnKX1MFI.json" packs/techniques
git commit -m "feat(techniques): Juuroku Rendan weapon-selected 3-hit combo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Manual QA in Foundry

There is no automated integration test for the live `item.use` → chat-card flow, so verify the
end-to-end behavior by hand against the spec's checklist. Reload the module in the browser
(`F5`, or `Ctrl+R` in-world) — do **not** restart Docker.

**Files:** none (verification only).

- [ ] **Step 1: Re-import the technique onto the test actor**

The edit is in the compendium source; an actor's already-imported copy will not update. On the
test actor (`Dattoumaru Ikazuchi` in world `kaihou`), delete the old Juuroku Rendan technique and
re-drag it from the `naruto-d20.techniques` compendium so the new config is present.

- [ ] **Step 2: Verify weapon selection**

Use the technique. Expected: the unarmed-attack picker dialog appears (same UI as Raite no Jutsu),
listing the actor's unarmed/natural attacks.

- [ ] **Step 3: Verify the three-attack card**

Pick an unarmed attack and confirm. Expected: a single chat card with **three** attacks, every
attack's to-hit reduced by 5 relative to the base attack bonus.

- [ ] **Step 4: Verify the fixed count on a high-BAB character**

Repeat on a character with 6+ BAB (or temporarily raise BAB). Expected: still **exactly three**
attacks — no extra BAB iteratives.

- [ ] **Step 5: Verify damage**

Expected: each attack's damage is `2d6 + Str` and typed **bludgeoning**.

- [ ] **Step 6: Verify the save still shows**

Expected: the card shows the Fortitude (partial) save with the technique's DC. (Applying the
`stunned` condition remains manual — out of scope.)

- [ ] **Step 7: Regression — Sangeki unchanged**

Use a Sangeki "Three Hit Kill" (second or third strike) technique. Expected: behaves exactly as
before this change (its `weaponAttack.iteratives` flag is absent → defaults to `true`).

---

## Notes for the implementer

- The whole feature rides on the existing `weaponAttack` pipeline: `use.mjs:468` already fetches
  the config via `getTechniqueWeaponAttackConfig(item)` and passes it whole to
  `rollSelectedWeaponAttackWithTechnique`, so the new `iteratives` field flows through with no
  change to `use.mjs`.
- `damageMode: "replace"` swaps only the chosen attack's **damage** (parts + damage-side ability
  fields + `touch` + range/target/notes). The attack ability (Str-to-hit on an unarmed strike) is
  **not** replaced, so to-hit stays correct. The action's `ability.damage: "str"` is what adds the
  Str modifier to the replaced 2d6.
- `attackBonus: "-5"` is applied globally to every attack (`shared.attackBonus`); the two
  `extraAttacks` entries use formula `0` (i.e. +0 relative to base), so all three land at exactly
  −5. Each attack roll's parts are `[...shared.attackBonus, atk.attackBonus]`
  (`action-use.mjs:705`).
- Do not modify the Sangeki techniques. Leaving `weaponAttack.iteratives` unset keeps their
  current behavior.
