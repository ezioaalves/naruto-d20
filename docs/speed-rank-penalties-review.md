# Speed Rank Penalties Review

Reviewed commits:

- `2b0392f68211020bfa774a187b22bddbc80228b6`
- `ac86488c172c045a334bfd8b20437dd779a53187`

PF1e reference:

- `/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11`
- PF1e version `11.11`, unbuilt source

## Conclusion

The implementation has a sound core idea: keep the learned/base KOUSOKU rank in
`flags["naruto-d20"].rankBuff.level` and derive a lower effective rank from
conditions and armor.

It is not fully correct as implemented. The rank can remain stale after armor
deletion, rank 0 still grants some bonuses, and armor detection does not exactly
match PF1e's active-equipment rules. A roll-data-derived effective rank is both
simpler and more reliable than persisting the effective value back to
`system.level`.

## Findings

### High: rank 0 does not remove all KOUSOKU bonuses

`scripts/automation/speed-rank-penalties.mjs` writes `system.level = 0`, but the
KOUSOKU changes include:

- Acrobatics: `@item.level + 1`
- Speed: `@item.level * 5 + 5`
- Stealth: `@item.level + 1`

At rank 0 these still grant `+1`, `+5 ft`, and `+1`. This affects both
immobilizing conditions and armor penalties that reduce a low base rank to 0.

The statement in `docs/speed-rank-penalties.md` that changing `system.level` is
sufficient to apply every penalty is therefore incorrect.

Required correction:

- Make zero-rank formulas explicitly return zero, for example
  `if(gt(@item.effectiveLevel, 0), @item.effectiveLevel + 1)`.
- Do the same for the speed formula.
- Consider precomputing each table value in roll data instead of duplicating
  conditional formulas.

Adjacent compendium issue: `@item.level + 1` produces `+11` at rank 10, while
the KOUSOKU table caps Jump and Hide at `+10`.

### High: deleting equipped armor does not restore the rank

The implementation listens to `createItem` and `updateItem`, but not
`deleteItem`. Deleting an equipped medium or heavy armor item therefore leaves
the KOUSOKU buff at its penalized level until another watched event occurs.

Required correction if the event-driven design is retained:

- Register `deleteItem`.
- Recompute from `item.actor` after deletion.
- Add a manual QA case that deletes equipped armor instead of merely
  unequipping it.

### Medium: armor detection differs from PF1e active-equipment behavior

The field names are correct for PF1e 11.11:

- item type: `equipment`
- armor discriminator: `system.subType === "armor"`
- category: `system.equipmentSubtype`

However, checking only `system.equipped` is incomplete. PF1e uses
`item.isActive`, which also excludes equipment that is in an invalid container,
has zero quantity, or has no remaining HP.

There is also an ordering bug when multiple armor items are equipped. The loop
returns immediately for the first medium armor, so a later heavy armor can be
ignored. PF1e instead consolidates the heaviest active armor into
`actor.equipment.armor.type`.

If item scanning is retained:

- Require `item.isActive`, not only `system.equipped`.
- Compute the maximum penalty across all active armor instead of returning on
  the first medium armor.

Prefer using PF1e's prepared armor result:

- `actor.equipment.armor.type`, or
- `actor.getRollData({ refresh: true }).armor.type`

PF1e defines the values in `pf1.config.armorTypes` as none `0`, light `1`,
medium `2`, and heavy `3`.

### Medium: `immobilized` is not a native PF1e 11.11 condition

PF1e 11.11 registers `helpless`, `paralyzed`, `grappled`, and `pinned`, but does
not register a condition with ID `immobilized`.

`actor.statuses.has("immobilized")` only works if this module or another module
creates an ActiveEffect carrying that exact status ID. The current module does
not register such a condition, so the rule is not generally usable through the
native condition UI.

The documentation also incorrectly states that PF1e automatically adds
`immobilized` when `grappled` is applied. PF1e's `grappled` condition has no
secondary statuses. `paralyzed` does add `helpless`.

Choose and document one behavior:

- Register a module-owned `immobilized` condition during `pf1PostInit`, or
- Treat `immobilized` as an optional external status and state that limitation.

### Medium: existing actors are not reconciled when the module loads

The implementation only reacts to later document events. An actor that already
has active KOUSOKU plus armor or an immobilizing condition when this feature is
installed or reloaded is not corrected until another watched event occurs.

If persisted effective levels are retained, run one ownership-safe
reconciliation after PF1e is ready for active KOUSOKU buffs.

This issue disappears with the recommended roll-data-derived design because the
effective rank is recalculated whenever PF1e evaluates the buff changes.

### Low: generic hooks duplicate PF1e condition plumbing

PF1e exposes the documented `pf1ToggleActorCondition(actor, condition, state)`
hook. It abstracts the ActiveEffect representation and reports PF1e conditions,
including secondary statuses.

The current `createActiveEffect` and `deleteActiveEffect` approach works for the
normal `ActorPF#setConditions()` create/delete path, but it is coupled to the
storage implementation and ignores `updateActiveEffect`. Effects parented by an
Item also require additional care because `effect.parent` is then the Item, not
the Actor.

If condition events remain necessary, prefer the PF1e hook, but verify
multi-client ownership behavior because it does not provide a `userId`.
Alternatively, retain the generic hooks and add the missing update/item-parent
handling.

### Low: broad asynchronous hooks add unnecessary work

Every embedded item create or update scans the actor's rank buffs and equipment,
including unrelated charge, duration, and item edits. Updating the KOUSOKU level
also triggers a second `updateItem` pass.

The equality guard prevents an infinite loop, but the design still causes extra
database writes and actor preparation cycles. Hook callbacks also have no local
error handling, so an update failure can become an unhandled rejected promise.

## Preferred Design

Derive KOUSOKU's effective rank synchronously in PF1e roll data instead of
persisting it to the buff document.

PF1e 11.11 calls:

```js
Hooks.callAll("pf1GetRollData", document, result);
```

for actors, items, and actions. When `document` is the active KOUSOKU buff:

1. Read the base rank from the rank-buff flag, falling back to
   `document.system.level`.
2. Read conditions from `document.actor.statuses`.
3. Read PF1e's consolidated armor category from `data.armor.type`.
4. Add calculated values under `data.item.speedRank`.
5. Make KOUSOKU changes reference those calculated fields.

Suggested roll-data shape:

```js
data.item.speedRank = {
  level: effectiveLevel,
  jump: effectiveLevel > 0 ? Math.min(effectiveLevel + 1, 10) : 0,
  dodge: effectiveLevel,
  attack: Math.floor(effectiveLevel / 2),
  speed: effectiveLevel > 0 ? effectiveLevel * 5 + 5 : 0,
  hide: effectiveLevel > 0 ? Math.min(effectiveLevel + 1, 10) : 0,
  cmb: -Math.floor(effectiveLevel / 2),
};
```

The compendium formulas then become direct references such as:

```text
@item.speedRank.jump
@item.speedRank.dodge
@item.speedRank.attack
@item.speedRank.speed
@item.speedRank.hide
@item.speedRank.cmb
```

Benefits:

- No mutation of the stored base level.
- No `createItem`, `updateItem`, `deleteItem`, or ActiveEffect hooks.
- No multi-client update race.
- No update loop.
- No stale persisted effective level.
- PF1e's own armor aggregation and item activity rules are reused.
- The KOUSOKU table logic has one implementation point.

Update the source JSON under `packs/_source/technique-buffs/`, run
`npm run validate:compendia`, then `npm run pack`.

## Minimal Patch

If changing the formulas and roll-data model is too large for this PR:

1. Fix the zero-rank formulas in the KOUSOKU source JSON.
2. Add `deleteItem`.
3. Use `item.isActive` and the maximum armor category.
4. Add initial reconciliation after PF1e ready.
5. Correct the `immobilized` documentation.
6. Add error handling around asynchronous hook work.

This is acceptable, but still less robust than deriving the effective rank in
`pf1GetRollData`.

## Manual QA

Verify at least these cases in Foundry VTT 13 with PF1e 11.11:

1. Rank 1 with medium armor produces rank 0 and no KOUSOKU bonuses.
2. Rank 2 with heavy armor produces rank 0 and no KOUSOKU bonuses.
3. Rank 5 with medium armor produces rank 4.
4. Rank 5 with heavy armor produces rank 2.
5. Applying and removing each supported condition restores the base rank.
6. Deleting equipped armor restores the base rank.
7. Medium plus heavy armor uses the heavy penalty regardless of item order.
8. Armor with zero quantity, zero HP, or inactive container state follows PF1e
   active-equipment behavior.
9. Activating KOUSOKU while already armored or conditioned applies the penalty
   immediately.
10. Reloading with KOUSOKU and a penalty source already active produces the
    correct effective values.
11. Two connected owners do not produce duplicate updates or warnings.
12. Rank 10 follows the table caps for Jump and Hide.
