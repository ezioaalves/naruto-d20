# Speed Rank (KOUSOKU) Automatic Penalties

Implements the two penalty rules from the KOUSOKU buff description:

- **Immobilizing conditions** (helpless, paralyzed, immobilized, grappled, pinned) → speed rank drops to **0**.
- **Medium armor** equipped → **−1** speed rank.
- **Heavy armor** equipped → **−3** speed rank.

## How it works

The KOUSOKU buff's changes all reference `@item.level` in their formulas (AC dodge, attack, speed, stealth, reflex, acrobatics, CMB). Adjusting `system.level` on the live buff item is therefore sufficient to apply every penalty at once — no change formulas need touching.

The base rank is stored in `flags["naruto-d20"].rankBuff.level` on the buff item (written by `buff-application.mjs` when the technique is performed). Only the effective `system.level` changes at runtime; the base is preserved and restores automatically when the penalty source is removed.

**Source:** `scripts/automation/speed-rank-penalties.mjs`  
**Registered in:** `scripts/main.mjs` `setup` hook, via `registerSpeedRankPenalties()`

---

## Initial design and what changed during testing

### Original plan

The initial plan registered three Foundry hooks:

```js
Hooks.on("updateActor", _onActorOrItemChanged);
Hooks.on("updateItem",  (item, ...) => _onActorOrItemChanged(item.actor, ...));
Hooks.on("createItem",  (item, ...) => _onActorOrItemChanged(item.actor, ...));
```

And the armor check looked for items in `actor.itemTypes.armor` using `item.system.armor.type` ("medium" / "heavy").

Both assumptions came from reading the PF1e TypeDoc reference and the module source — they looked correct on paper but turned out to be wrong for the v11.11 runtime.

### Bug 1 — `updateActor` does not fire for condition changes

**Discovery:** Applied `grappled` via `actor.setConditions({ grappled: true })` and watched which Foundry hooks fired using a spy:

```js
const hookNames = ['updateActor', 'createActiveEffect', 'updateActiveEffect',
                   'deleteActiveEffect', 'createItem', 'updateItem', 'deleteItem'];
// ... registered spy hooks, then called setConditions ...
// Result: only "createActiveEffect" fired
```

Removing a condition only fired `deleteActiveEffect`.

**Root cause:** PF1e conditions are `ActiveEffect` documents attached to the actor. `actor.setConditions()` creates or deletes ActiveEffect documents — it does not directly update the actor document, so `updateActor` is never called.

**Fix:** Replace `updateActor` with `createActiveEffect` and `deleteActiveEffect`. The actor is obtained from `effect.parent`.

```js
Hooks.on("createActiveEffect", (effect, _o, userId) => _onEffectChanged(effect, userId));
Hooks.on("deleteActiveEffect", (effect, _o, userId) => _onEffectChanged(effect, userId));

async function _onEffectChanged(effect, userId) {
  if (game.user.id !== userId) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  await _syncSpeedRankLevel(actor);
}
```

### Bug 2 — PF1e armor items are not in `actor.itemTypes.armor`

**Discovery:** Confirmed via console inspection that `actor.itemTypes.armor` is empty (`length: 0`). PF1e armor items have **`type: "equipment"`**, not `type: "armor"`. They live in `actor.itemTypes.equipment`.

Further inspection of the "Battle Armor, Heavy" item revealed the field layout:

| Field | Value | Note |
|---|---|---|
| `item.type` | `"equipment"` | Foundry document type |
| `item.system.subType` | `"armor"` | Distinguishes armor from shields/other gear |
| `item.system.slot` | `"armor"` | Equipment slot |
| `item.system.equipmentSubtype` | `"heavyArmor"` | Weight category |
| `item.system.equipped` | `true` | Whether currently worn |
| `item.system.armor.type` | *(absent)* | **Not present** on native PF1e armor items |

The armor weight category values are `"lightArmor"`, `"mediumArmor"`, `"heavyArmor"` (camelCase strings in `equipmentSubtype`), not `"light"` / `"medium"` / `"heavy"`.

**Fix:**

```js
function _armorPenalty(actor) {
  const equipment = actor.itemTypes?.equipment ?? actor.items.filter((i) => i.type === "equipment");
  for (const item of equipment) {
    if (!item.system?.equipped) continue;
    if (item.system?.subType !== "armor") continue;   // exclude shields/other gear
    const sub = item.system?.equipmentSubtype;
    if (sub === "heavyArmor")  return 3;
    if (sub === "mediumArmor") return 1;
  }
  return 0;
}
```

---

## PF1e API facts confirmed during this work

| Question | Answer |
|---|---|
| How to detect an active condition on an actor | `actor.statuses?.has("conditionId")` — a `Set` of string IDs |
| What hook fires when a condition is applied | `createActiveEffect` |
| What hook fires when a condition is removed | `deleteActiveEffect` |
| What hook fires when armor is equipped/unequipped | `updateItem` |
| What hook fires when a buff item is added to actor | `createItem` |
| `updateActor` fires for conditions? | **No.** Only fires for direct actor document updates. |
| PF1e item type for armor | `"equipment"` (not `"armor"`) |
| Field identifying armor vs shield | `item.system.subType === "armor"` |
| Field for armor weight category | `item.system.equipmentSubtype` — values: `"lightArmor"`, `"mediumArmor"`, `"heavyArmor"` |
| `item.system.armor.type` on native armor items | **Absent.** Only present if explicitly set (e.g. items created with that field). |
| `grappled` condition also applies | `immobilized` — PF1e adds it automatically as a linked effect |

---

## Loop-safety

`speedBuff.update({ "system.level": effectiveLevel })` triggers `updateItem`, which re-enters `_syncSpeedRankLevel`. The second pass computes the same `effectiveLevel` (conditions and armor haven't changed) and finds `speedBuff.system.level === effectiveLevel`, so it returns without another update. One correction cycle maximum.

## userId guard

Every handler checks `game.user.id !== userId` and returns early if the current client did not trigger the change. This matches the pattern in `charge-defense.mjs` and `buff-expiry.mjs` and prevents duplicate updates from multiple connected clients.
