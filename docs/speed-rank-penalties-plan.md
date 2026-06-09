# Plan: Fix KOUSOKU Penalty Implementation (post-review)

Review source: `docs/speed-rank-penalties-review.md`  
Reviewed commits: `2b0392f`, `ac86488`

## Context

The initial implementation (`speed-rank-penalties.mjs`) had a sound core idea but five concrete bugs identified in the review. The review also recommends a fundamentally cleaner design: derive the effective rank synchronously in `pf1GetRollData` instead of persisting it back to `system.level`. This plan implements that preferred design plus all required corrections.

---

## Approach: `pf1GetRollData` hook (preferred design)

**Why this beats the event-driven approach:**
- No document mutations → no race conditions, no stale state, no update loop
- PF1e naturally re-runs actor data prep whenever conditions or items change — the hook fires automatically
- `data.armor.type` (already prepared by PF1e) gives correct consolidated armor category, avoiding the `item.isActive` / container edge cases
- No `createActiveEffect`, `deleteActiveEffect`, `updateItem`, `createItem`, or `deleteItem` hooks needed
- No initial reconciliation needed (data prep fires on every load)

**Verified facts from PF1e 11.11 source:**
- `pf1GetRollData` fires in `ItemPF.getRollData()` → fires for buff items during changes engine evaluation
- `item.actor` is available inside the hook
- `data.armor.type` is numeric: 0=none, 1=light, 2=medium, 3=heavy (`pf1.config.armorTypes`)

---

## Files to change

| File | Change |
|---|---|
| `scripts/automation/speed-rank-penalties.mjs` | Replace entirely with `pf1GetRollData` approach |
| `scripts/main.mjs` | Add migration #6, bump `FLAG_MIGRATION_VERSION` to 6 |
| `packs/_source/technique-buffs/KOUSOKU__SPEED_RANK__8mMF2zl7fuB4lTZy.json` | Update 7 change formulas |

---

## 1 — New `speed-rank-penalties.mjs`

Replace the entire file:

```js
import { getRankBuffFlag, isRankBuffItem } from "./rank-buffs.mjs";

// "immobilized" excluded — not a native PF1e 11.11 condition; add only if a
// module-registered custom condition with that exact status ID exists.
const IMMOBILIZING_CONDITIONS = ["helpless", "paralyzed", "grappled", "pinned"];

export function registerSpeedRankPenalties() {
  Hooks.on("pf1GetRollData", _onGetRollData);
}

function _onGetRollData(item, data) {
  if (!isRankBuffItem(item) || getRankBuffFlag(item)?.key !== "KOUSOKU") return;
  const actor = item.actor;
  if (!actor) return;

  const flag = getRankBuffFlag(item);
  const baseLevel = flag?.level ?? item.system?.level ?? 0;
  const effectiveLevel = _computeEffectiveLevel(actor, data, baseLevel);

  // Table caps: Jump and Hide cap at +10 (rank 10 → +10, not +11)
  data.item.speedRank = {
    level:  effectiveLevel,
    jump:   effectiveLevel > 0 ? Math.min(effectiveLevel + 1, 10) : 0,
    dodge:  effectiveLevel,
    attack: Math.floor(effectiveLevel / 2),
    speed:  effectiveLevel > 0 ? effectiveLevel * 5 + 5 : 0,
    hide:   effectiveLevel > 0 ? Math.min(effectiveLevel + 1, 10) : 0,
    cmb:    -Math.floor(effectiveLevel / 2),
  };
}

function _computeEffectiveLevel(actor, data, baseLevel) {
  for (const cond of IMMOBILIZING_CONDITIONS) {
    if (actor.statuses?.has(cond)) return 0;
  }
  // Use PF1e's consolidated armor type (already accounts for isActive, containers, HP, quantity)
  const armorType = data.armor?.type ?? 0;
  const armorPenalty = armorType >= 3 ? 3 : armorType >= 2 ? 1 : 0;
  return Math.max(0, baseLevel - armorPenalty);
}
```

---

## 2 — Compendium JSON formula update

In `packs/_source/technique-buffs/KOUSOKU__SPEED_RANK__8mMF2zl7fuB4lTZy.json`, update `system.changes`:

| Change `_id` | Target | Old formula | New formula |
|---|---|---|---|
| `B5YddrZI` | `skill.acr` | `@item.level+1` | `@item.speedRank.jump` |
| `JfNd3IDk` | `ac` | `@item.level` | `@item.speedRank.dodge` |
| `vkK43M8p` | `attack` | `floor(@item.level/2)` | `@item.speedRank.attack` |
| `PDR8lbWh` | `allSpeeds` | `@item.level*5 + 5` | `@item.speedRank.speed` |
| `RjMHVqgN` | `skill.ste` | `@item.level+1` | `@item.speedRank.hide` |
| `17OhbWVn` | `ref` | `@item.level` | `@item.speedRank.dodge` |
| `YfxaAt5D` | `cmb` | `-floor(@item.level/2)` | `@item.speedRank.cmb` |

After editing, run `npm run pack` to rebuild the compiled LevelDB.

---

## 3 — Migration in `main.mjs`

Bump `FLAG_MIGRATION_VERSION` from `5` to `6`.

Add `await _migrateKousokuBuffFormulas();` inside the `ready` hook's migration block.

New migration function:

```js
async function _migrateKousokuBuffFormulas() {
  const { isRankBuffItem, getRankBuffFlag } = await import("./automation/rank-buffs.mjs");

  const FORMULA_MAP = {
    "B5YddrZI": "@item.speedRank.jump",
    "JfNd3IDk": "@item.speedRank.dodge",
    "vkK43M8p": "@item.speedRank.attack",
    "PDR8lbWh": "@item.speedRank.speed",
    "RjMHVqgN": "@item.speedRank.hide",
    "17OhbWVn": "@item.speedRank.dodge",
    "YfxaAt5D": "@item.speedRank.cmb",
  };

  const migrateActor = async (actor) => {
    if (!["character", "npc"].includes(actor.type)) return;
    const buff = actor.items.find(
      (i) => isRankBuffItem(i) && getRankBuffFlag(i)?.key === "KOUSOKU",
    );
    if (!buff) return;

    const flag = getRankBuffFlag(buff);
    const changes = buff.system.changes ?? [];
    const needsFormulaFix = changes.some(
      (c) => FORMULA_MAP[c._id] && c.formula !== FORMULA_MAP[c._id],
    );
    // Restore system.level to base — old event-driven code may have written a
    // penalized value (e.g. 0); new design reads from flag and ignores system.level.
    const needsLevelFix = flag?.level !== undefined && buff.system.level !== flag.level;
    if (!needsFormulaFix && !needsLevelFix) return;

    const update = {};
    if (needsFormulaFix) {
      update["system.changes"] = changes.map((c) =>
        FORMULA_MAP[c._id] ? { ...c, formula: FORMULA_MAP[c._id] } : c,
      );
    }
    if (needsLevelFix) update["system.level"] = flag.level;

    await buff.update(update);
  };

  for (const actor of game.actors) await migrateActor(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actor && !token.actorLink) await migrateActor(token.actor);
    }
  }
}
```

---

## 4 — Documentation update (`docs/speed-rank-penalties.md`)

- Remove `"immobilized"` from the condition list and explain why (not a native PF1e 11.11 condition).
- Correct the grappled/immobilized claim: `paralyzed` adds `helpless` as a secondary status; `grappled` does not add `immobilized` (the `immobilized` status observed in the Playwright test was likely from another active effect).
- Replace the old "approach" section with the `pf1GetRollData` design.

---

## Verification

1. Reload Foundry after changes.
2. Apply GODAN KOUSOKU (rank 5) to a test actor.
3. **No armor, no condition** → acr/ste +6, AC dodge +5, ref +5, speed +30ft, attack +2.
4. **Medium armor equipped** → rank 4 → acr/ste +5, AC dodge +4, speed +25ft, attack +2.
5. **Heavy armor equipped** → rank 2 → acr/ste +3, AC dodge +2, speed +15ft, attack +1.
6. **Apply grappled** → rank 0 → ALL bonuses = 0 (no leftover +1 or +5ft).
7. **Remove condition / unequip armor** → rank restores immediately.
8. **Delete equipped armor** (not just unequip) → rank restores correctly.
9. **Rank 10, no penalties** → acr/ste +10 (capped), speed +55ft.
10. **Reload with KOUSOKU + heavy armor active** → penalty applies immediately on load.
