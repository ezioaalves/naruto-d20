# Training Weight Design

## Goal

Add Training Weight equipment support to the module with these rules:

- Training weights are PF1e items in a dedicated compendium, not buffs or feats.
- Wrist and ankle weights are separate items.
- Equipping wrist weights reduces effective Strength Rank (`JOURYOKU`).
- Equipping ankle weights reduces effective Speed Rank (`KOUSOKU`).
- Equipping one wrist weight and one ankle weight grants a Learn/Mastery bonus only for explicitly marked rank-training techniques.
- The Learn/Mastery bonus uses the lower Type between the equipped wrist and ankle weights.
- Weight ignored for carrying capacity is based on the highest learned Strength Rank technique on the actor, even if no Strength Rank buff is currently active.

## User Decisions

- Use the recommended approach: explicit technique metadata plus conditional Learn/Mastery bonus injection.
- Add a new compendium for items/equipment.
- Keep the compendium simple and predictable: fixed items, not configurable item types.
- Represent wrist and ankle weights as separate items.
- Full-set Learn/Mastery bonus works with any wrist + ankle combination and uses the lower Type.
- The table weight is for the conceptual full set; each half-item uses half that weight.
- Ignoring carried weight applies to both wrist and ankle items.
- Ignoring carried weight depends on the highest learned `JOURYOKU` rank on the actor, not on an active rank buff.

## Item Model

Create a new PF1e item compendium for Training Weights.

The compendium contains 16 fixed items:

- `Wrist Weight Type I` through `Wrist Weight Type VIII`
- `Ankle Weight Type I` through `Ankle Weight Type VIII`

Each item stores module metadata under a dedicated flag, for example:

```js
flags["naruto-d20"].trainingWeight = {
  slot: "wrist" | "ankle",
  type: 1..8,
  rankPenalty: 1..10,
  learnBonus: 1..5,
}
```

The exact flag path name can be finalized during implementation, but the metadata must explicitly encode:

- which half the item represents (`wrist` or `ankle`)
- which Type it is (`1..8`)
- the rank penalty from the source table
- the Learn/Mastery bonus from the source table

The item's PF1e weight uses half of the printed table value:

- Type I: `25 lb.`
- Type II: `37.5 lb.`
- Type III: `50 lb.`
- Type IV: `62.5 lb.`
- Type V: `75 lb.`
- Type VI: `150 lb.`
- Type VII: `250 lb.`
- Type VIII: `500 lb.`

The rule table is fixed and should be represented explicitly in code/data:

| Type | Rank Penalty | Learn/Mastery Bonus | Learned `JOURYOKU` needed to ignore carried weight |
| --- | --- | --- | --- |
| I | `-1` | `+1` | Rank 1 |
| II | `-2` | `+2` | Rank 2 |
| III | `-3` | `+3` | Rank 3 |
| IV | `-4` | `+4` | Rank 4 |
| V | `-5` | `+5` | Rank 5 |
| VI | `-6` | `+5` | Rank 6 |
| VII | `-8` | `+5` | Rank 8 |
| VIII | `-10` | `+5` | Rank 10 |

## Technique Metadata

Training Weight Learn/Mastery bonuses must not be inferred primarily from technique names.

Instead, each eligible technique gets explicit metadata, for example:

```js
flags["naruto-d20"].trainingWeightEligible = "KOUSOKU" | "JOURYOKU";
```

This metadata marks that a technique can receive the full-set Training Weight Learn/Mastery bonus.

The implementation may keep existing name-based helpers such as `resolveRankTechnique(name)` as fallback or convenience, but the explicit technique flag is the source of truth for this feature.

## Derived Actor State

Do not create or persist helper buffs when a Training Weight item is equipped.

Instead, add a centralized helper that scans the actor's equipped Training Weight items and derives a transient state object. The helper should return enough information to drive both rank penalties and Learn/Mastery bonuses, for example:

```js
{
  wrist: { item, type, rankPenalty, learnBonus } | null,
  ankle: { item, type, rankPenalty, learnBonus } | null,
  hasFullSet: boolean,
  fullSetType: number | null,
  fullSetLearnBonus: number,
  strengthRankPenalty: number,
  speedRankPenalty: number,
  highestLearnedStrengthRank: number,
  ignoredCarryWeight: number,
}
```

This helper should also normalize multiple equipped items of the same half:

- only one `wrist` item participates in automation
- only one `ankle` item participates in automation
- recommended rule: use the highest-Type equipped item in each half
- any extra equipped item of the same half has no automatic effect

This keeps the model deterministic and avoids accidental stacking.

## Rank Penalty Rules

Training Weights reduce effective ranks through the existing rank-resolution pipeline rather than by applying downstream stat penalties directly.

- Equipped `wrist` weight reduces effective `JOURYOKU`.
- Equipped `ankle` weight reduces effective `KOUSOKU`.

These penalties are independent of whether the item's weight is ignored for carrying capacity.

Example:

- an `Ankle Weight Type III` can count as `0 lb.` for encumbrance if the actor has learned `SANDAN JOURYOKU`
- the same item still penalizes effective `KOUSOKU` while equipped

The existing dynamic rank calculation remains the right integration point:

- continue computing effective rank at roll-data time
- do not persist penalized levels back into item documents
- clamp final effective rank to the existing supported range

Training Weight penalties should be added as an additional penalty source inside the effective-rank resolver alongside the current rank sources (`paid`, `temp`, `bonus`, and existing KOUSOKU armor/condition penalties where applicable).

## Learn and Mastery Bonus Rules

The Learn/Mastery bonus applies only when all of the following are true:

- the actor has one effective equipped `wrist` weight
- the actor has one effective equipped `ankle` weight
- the technique being learned or mastered is explicitly marked as eligible

When active:

- the bonus uses the lower Type between the effective wrist and ankle items
- the bonus is injected into the roll breakdown for that specific technique only
- the bonus must apply to both learning and mastery, because both use the same learn-style roll pipeline

The bonus must not be written into global actor learn fields such as `flags["naruto-d20"].learn.*`, because those fields are discipline-based and would leak the bonus onto unrelated techniques.

Instead, inject the bonus at the point where the Learn/Mastery roll is assembled with item context.

## Carry Weight Rules

Ignoring carried weight is based on the actor's highest learned `JOURYOKU` technique rank, not on an active Strength Rank buff.

Examples:

- If the actor has learned `SHODAN JOURYOKU`, all Type I Training Weights count as weightless.
- If the actor has learned `SANDAN JOURYOKU`, all Type III-or-lower Training Weights count as weightless.
- This applies to both wrist and ankle items.
- This rule still works even if no `JOURYOKU` buff is currently active.

This means the feature needs two separate notions:

- active effective rank
  Used for current combat/stat penalties from equipped weights.
- highest learned Strength Rank
  Used only for deciding whether Training Weight item weight counts toward carrying capacity.

The PF1e v11.11 encumbrance pipeline sums `item.system.weight.total` in `ActorPF#getCarriedWeight()`, so the module should adjust effective carried weight at the actor encumbrance stage rather than persisting dynamic weight mutations back into the item documents.

The design goal is:

- keep nominal item weight in the item data
- subtract eligible ignored Training Weight mass from the actor's carried weight calculation
- avoid rewriting `system.weight.value` or other item fields just because learned-rank state changed

## Architecture Integration

Planned integration points:

- New item compendium added to `module.json`
- Compendium source files under a new `packs/_source/...` directory for the Training Weights
- A dedicated helper module for Training Weight discovery/state
- Effective-rank calculation extended to include Training Weight penalties
- Learn/Mastery roll assembly extended to include conditional full-set bonus
- Actor encumbrance integration extended so ignored Training Weight mass is removed from carried-weight calculation

The feature should follow the module's current design direction:

- dynamic calculation over persisted transient state
- explicit metadata instead of fragile name parsing
- single-purpose helpers rather than one large mixed module

## Error Handling and Edge Cases

- If no effective `wrist` item is equipped, there is no Strength Rank penalty and no full-set bonus.
- If no effective `ankle` item is equipped, there is no Speed Rank penalty and no full-set bonus.
- If both are equipped, rank penalties apply independently and the Learn/Mastery bonus uses the lower Type.
- If multiple items of the same half are equipped, only the chosen effective item for that half participates.
- If a technique is not explicitly marked eligible, it receives no Learn/Mastery bonus even if its name resembles a rank technique.
- Fractional item weights such as `37.5` and `62.5` must remain correct in carried-weight math.
- Weight-ignoring logic must not suppress the rank penalty effect of an equipped item.

## Verification

Manual Foundry verification should cover:

- Equip only `Wrist Weight Type III`: effective `JOURYOKU` is reduced; no Learn/Mastery bonus is granted.
- Equip only `Ankle Weight Type III`: effective `KOUSOKU` is reduced; no Learn/Mastery bonus is granted.
- Equip `Wrist Weight Type V` and `Ankle Weight Type II`: both rank penalties apply; full-set Learn/Mastery bonus equals Type II.
- Learn or master a technique explicitly marked `trainingWeightEligible`: bonus appears in the roll breakdown only when the full set is equipped.
- Learn or master a technique without that flag: no Training Weight bonus appears.
- Actor with learned `SHODAN JOURYOKU`: Type I wrist and ankle items count as zero carried weight even without an active Strength Rank buff.
- Actor with learned `SANDAN JOURYOKU`: Type III-or-lower wrist and ankle items count as zero carried weight; Type IV+ still count.
- Weightless-for-carry items still apply their rank penalties while equipped.
- Multiple equipped items of the same half do not stack unexpectedly.

## Out of Scope

- No configurable single item with runtime Type switching.
- No item-generated helper buffs.
- No broad global Learn bonus written onto actor discipline fields.
- No dependency on active Strength Rank buff state for weightless carry logic.
