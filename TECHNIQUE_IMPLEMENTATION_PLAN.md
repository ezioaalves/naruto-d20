# Technique Actions & Perform Flow — Implementation Plan

> **Branch:** `damage-techniques`
> **Goal:** Make a Technique behave like a PF1e Spell, but with chakra as
> the resource and discipline-skill ranks as the perform-DC bypass. Each
> Technique gets a real PF1e `pf1.components.ItemAction` collection so
> we inherit the entire damage / attack / save / conditional / effect-notes
> machinery for free.

---

## 0. Prerequisite — Route techniques through `ItemPF` (DONE)

PF1e routes item construction through `CONFIG.Item.documentClasses[type]`,
falling back to `ItemBasePF` when the type is not registered. `ItemBasePF`
does **not** have `_configure()` that initializes `this.actions` and
`this.scriptCalls` Collections, and it does not run `_prepareActions()` /
`_prepareScriptCalls()`. Technique items must be `ItemPF` instances.

**Already applied in `scripts/main.mjs` `init` hook:**

```js
if (pf1?.documents?.item?.ItemPF) {
    CONFIG.Item.documentClasses ??= {};
    CONFIG.Item.documentClasses["naruto-d20.technique"] = pf1.documents.item.ItemPF;
}
```

This is the single most load-bearing change in the entire feature. Without
it, every downstream item (`item.actions`, `item.scriptCalls`,
`ItemScriptCall.create`, `action.sheet`) is undefined or broken.

The companion fix — pushing `"naruto-d20.technique"` into the `use` and
`postUse` script-call categories during `pf1PostInit` — is also already
applied (`_registerScriptCallCategories`).

---

## 1. Architecture decisions

**Why V1 `ItemSheet` and not `pf1.applications.item.abstract.ActionItemSheetPF`:**
We tried the AppV2 path. PF1e's `_prepareContext` runs a long pipeline
(sidebar fields, content-source prep, label calculation, link prep,
`getDescription`, change collections) — several stages assume properties
that PF1e item sub-types provide via custom logic and that a third-party
module sub-type does not. The result was a sheet that rendered only the
header. V1 `ItemSheet` is fully supported in Foundry v13, is the
conventional choice for module-provided sub-typed items, and is proven to
render our 5-tab layout correctly.

**Why `foundry.abstract.TypeDataModel` (NOT `pf1.models.item.ActionItemModel`):**
`pf1.models.item.ActionItemModel` is a **dev-branch path** that exists only
in the `pf1-source/` symlink, not in the installed v11.11 bundle. Trying
to extend it throws `TypeError: Cannot read properties of undefined`
at module load. The action pipeline works correctly because the item is
constructed as `ItemPF` (via §0), **not** because of what the model
extends. `ItemPF.prepareDerivedData()` calls `_prepareActions()`, which
reads `this.system.actions` (an array of `_id`-keyed shapes) and
populates `item.actions` with `pf1.components.ItemAction` instances. The
model class doesn't need to participate.

**Why `system.actions` stays an `ArrayField` (NOT `TypedObjectField`):**
`pf1.models.components.Action` is another dev-branch-only path; the v11.11
equivalent is `pf1.components.ItemAction`. Independently, `ItemPF._prepareActions()`
in v11.11 reads `this.system.actions ?? []` as an **array**. Switching to
a Record (object keyed by `_id`) would break the pipeline. We keep an
`ArrayField<SchemaField>` whose minimum keys (`_id`, `name`, `img`) match
what `ItemAction` expects, and let the rest of the Action's fields live
on the `ItemAction` instance via `pf1.components.ItemAction`'s own schema.

**Why the duplicated fields stay on the Details tab:**
Per user direction. Range / target / area / duration / save / activation
now exist both on the technique (descriptive) and on each Action
(mechanical). Convergence is a follow-up.

---

## 2. Files

| File | Status | Purpose |
|---|---|---|
| `scripts/main.mjs` | **modified** | `CONFIG.Item.documentClasses` registration so techniques are `ItemPF` (§0). Script-call category registration in `pf1PostInit`. |
| `scripts/data/technique-model.mjs` | **modified** | `system.actions` stays an `ArrayField`. Description SchemaField. `hasChanges` getter returns `true` to opt into PF1e's changes pipeline. `flags.boolean` is `ObjectField` (EntrySelector writes `{key: true}` objects). |
| `scripts/ui/technique-sheet.mjs` | **modify** | Add Use button handler that calls `performTechnique`. Hook `editAction` into `item.actions.get(id).sheet.render(true)` (the PF1e Action sheet). |
| `scripts/use-technique.mjs` | **new** | `performTechnique(item, actionId)` (full perform pipeline) and `canAffordTechnique(actor, item)` (boolean for sheet button state). |
| `scripts/data/skills.mjs` | **modify** | Export `DISCIPLINE_SKILL_MAP`. |
| `templates/item/technique-sheet.hbs` | **modify** | Add Use action and perform-hint header on Details. Other tabs already wired. |
| `styles/naruto-d20.css` | **modify** | Perform-hint header, disabled Use state, perform-success/failure chat card styling. |

---

## 3. Data model — already aligned (`scripts/data/technique-model.mjs`)

The current model is in the right shape for this feature. No structural
change needed for the perform-flow work. Key invariants:

- Extends `foundry.abstract.TypeDataModel`.
- `system.actions` is an `ArrayField<SchemaField({_id, name, img, notes})>`.
  PF1e's `_prepareActions()` constructs `pf1.components.ItemAction`
  instances on top of these rows; any additional Action fields
  (`damage`, `save`, `attack`, etc.) are stored on the row by the
  Action sheet itself.
- `system.changes` is an `ArrayField`; `hasChanges` returns `true` so
  PF1e's `_prepareChanges` constructs `ItemChange` instances.
- `system.scriptCalls` matches `ItemScriptCall`'s schema so
  `_prepareScriptCalls()` populates `item.scriptCalls`.
- `system.description.{value, summary, instructions}` (SchemaField).
- `system.flags.{boolean: ObjectField, dictionary: ObjectField}`
  (matches what `EntrySelector` writes — `{key: true}` for booleans).
- `migrateData` normalizes legacy shapes:
  - string `description` → `{value, summary, instructions}` object
  - action `id` → `_id`
  - `flags.boolean` array → object

If `system.activation` needs to converge with per-Action activation later,
that is a separate migration. For now both fields exist (user direction).

**Action note (for §6):** Action CRUD uses **array manipulation**, not
record dot-path notation:

```js
// Create
const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
actions.push({ _id: foundry.utils.randomID(8), name: "New Action" });
await this.item.update({ "system.actions": actions });

// Delete
const actions = (this.item.system.actions ?? []).filter(a => a._id !== id);
await this.item.update({ "system.actions": actions });
```

This pattern is already implemented in `technique-sheet.mjs`.

---

## 4. Perform pipeline (`scripts/use-technique.mjs`)

```js
import { DISCIPLINE_SKILL_MAP } from "./data/skills.mjs"; // see §5

const MODULE_ID = "naruto-d20";

export function canAffordTechnique(actor, item) {
    if (!actor) return false;
    const chakra    = actor.flags?.[MODULE_ID]?.chakra ?? {};
    const available = (chakra.pool?.value ?? 0) + (chakra.reserve?.value ?? 0);
    return available >= (item.system.chakraCost ?? 0);
}

export async function performTechnique(item, actionId) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("Equip this technique on an actor to use it.");
        return;
    }
    const action = item.actions?.get(actionId);
    if (!action) {
        ui.notifications.warn(`${item.name}: action not found.`);
        return;
    }

    const sys  = item.system;
    const cost = sys.chakraCost ?? 0;

    // 1. Chakra sufficiency
    if (!canAffordTechnique(actor, item)) {
        ui.notifications.warn(`${actor.name}: not enough chakra to perform ${item.name}.`);
        return;
    }

    // 2. Skill threshold bypass
    const skillKey   = DISCIPLINE_SKILL_MAP[sys.discipline];   // may be undefined
    const skillRanks = skillKey ? (actor.system.skills?.[skillKey]?.rank ?? 0) : Infinity;
    const threshold  = sys.derived.skillThreshold;
    const performDC  = sys.derived.performDC;

    let succeeded;
    let bypassNote = null;

    if (!skillKey || skillRanks >= threshold) {
        succeeded  = true;
        bypassNote = skillKey
            ? `Ranks ${skillRanks} ≥ threshold ${threshold} — auto-perform.`
            : `No perform check required.`;
    } else {
        // 3. Roll perform check vs performDC.
        // pf1.dice.d20Roll posts its own chat card and returns a ChatMessage
        // (NOT a Roll). Access the total via roll.rolls[0].total.
        // The `skill:` option tells PF1e to apply the standard skill formula
        // (ranks + ability + class-skill bonus). `parts` adds only extras.
        const roll = await pf1.dice.d20Roll({
            flavor:   `${item.name} — Perform Check (DC ${performDC})`,
            skill:    skillKey,
            parts:    _buildPerformParts(sys),
            rollData: actor.getRollData?.() ?? {},
            speaker:  ChatMessage.implementation?.getSpeaker({ actor }) ?? ChatMessage.getSpeaker({ actor }),
        });
        if (!roll) return;                    // user cancelled dialog
        succeeded = roll.rolls[0].total >= performDC;
    }

    // 4. Failure path → chat card, no chakra spent
    if (!succeeded) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card failed">
                        <header><h3>${item.name}</h3></header>
                        <p>Perform check failed (DC ${performDC}). No chakra spent.</p>
                      </div>`,
        });
        return;
    }

    // 5. Deduct chakra: pool first, reserve as overflow
    const chakra       = actor.flags[MODULE_ID]?.chakra ?? {};
    const poolValue    = chakra.pool?.value    ?? 0;
    const reserveValue = chakra.reserve?.value ?? 0;
    const fromPool     = Math.min(cost, poolValue);
    const fromReserve  = cost - fromPool;
    await actor.update({
        [`flags.${MODULE_ID}.chakra.pool.value`]:    poolValue    - fromPool,
        [`flags.${MODULE_ID}.chakra.reserve.value`]: reserveValue - fromReserve,
    });

    // 6. Post outcome card then fire the Action.
    // Bypass path → post a card with the bypass note and chakra deduction.
    // Roll path → d20Roll already posted its own card; post only the
    // chakra-deduction footer so the chat isn't duplicated.
    if (bypassNote) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <p class="naruto-perform-bypass">${bypassNote}</p>
                        <footer>Spent ${cost} chakra (${fromPool} pool, ${fromReserve} reserve).</footer>
                      </div>`,
        });
    } else {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="naruto-technique-card success">
                        <header><h3>${item.name}</h3></header>
                        <footer>Spent ${cost} chakra (${fromPool} pool, ${fromReserve} reserve).</footer>
                      </div>`,
        });
    }

    // 7. Fire the PF1e action — standard attack / damage / save card
    await action.use();
}

// Only technique-specific extras — PF1e's d20Roll handles the base skill
// formula (ranks + ability + class-skill bonus) via the `skill:` option.
function _buildPerformParts(sys) {
    const parts = [];
    if (sys.performMiscBonus) parts.push(`${sys.performMiscBonus}[Perform Misc]`);
    return parts;
}
```

Notes:
- **`pf1.dice.d20Roll` returns a `ChatMessage`, not a `Roll`.** It posts its
  own chat card automatically. Read the result total via `roll.rolls[0].total`.
  Do **not** pass `chatMessage: false` — it is not supported and would suppress
  the roll card entirely.
- The `skill:` option delegates the full base skill formula (ranks + ability +
  class-skill bonus) to PF1e. `_buildPerformParts` only needs to add
  technique-specific extras (e.g. `performMiscBonus`). Do not manually push
  ranks/ability/buff parts that PF1e already handles.
- `action.use()` is PF1e's built-in handler. It posts the standard
  attack-roll / damage-roll / save-prompt card based on the Action's
  configuration. We do **not** reimplement any of that. This call now
  works because (§0) the item is `ItemPF`, so `item.actions` is a real
  Collection of `ItemAction` instances.

---

## 5. Discipline → skill mapping

Defined as a single constant. Five disciplines roll, three do not.

```js
// scripts/data/skills.mjs — add this export
export const DISCIPLINE_SKILL_MAP = Object.freeze({
    "Chakra Control":  "ckc",
    "Fuinjutsu":       "fui",
    "Genjutsu":        "gnj",
    "Ninjutsu":        "nin",
    "Taijutsu":        "tai",
    // No-roll cases — `performTechnique` treats `undefined` as auto-success:
    "Hachimon Tonkou": undefined,
    "Training":        undefined,
    "":                undefined,
});
```

The `undefined` value is load-bearing in `performTechnique`:

```js
const skillKey = DISCIPLINE_SKILL_MAP[sys.discipline];
if (!skillKey || skillRanks >= threshold) { succeeded = true; ... }
```

---

## 6. Sheet changes (`scripts/ui/technique-sheet.mjs`)

The sheet already has working CRUD for actions, links, tags, flags, and
script calls. The remaining additions are the perform flow.

### `getData` additions

```js
const actor    = item.actor;
const skillKey = DISCIPLINE_SKILL_MAP[system.discipline];
const skillRanks = (skillKey && actor)
    ? (actor.system.skills?.[skillKey]?.rank ?? 0)
    : 0;
const bypassesPerform = !skillKey || skillRanks >= system.derived.skillThreshold;

context.canUse          = !!actor && canAffordTechnique(actor, item);
context.skillKey        = skillKey;
context.skillRanks      = skillRanks;
context.bypassesPerform = bypassesPerform;
context.performHint = !actor
    ? "Equip on an actor to use."
    : (!skillKey
        ? "No perform check required for this discipline."
        : (bypassesPerform
            ? `Ranks ${skillRanks}/${system.derived.skillThreshold} — auto-perform.`
            : `Ranks ${skillRanks}/${system.derived.skillThreshold} — must roll vs DC ${system.derived.performDC}.`));
```

The existing `context.actions = Array.from(item.actions ?? [])` already
gives the template each `ItemAction` instance — its `id`, `name`, `img`,
`hasAttack`, `hasDamage`, `hasSave` properties are read directly in the
template.

### `activateListeners` addition

```js
html.on("click", ".use-action", this._onUseAction.bind(this));
```

```js
async _onUseAction(event) {
    event.preventDefault();
    event.stopPropagation();
    const row = event.currentTarget.closest(".item[data-action-id]");
    const id  = row?.dataset.actionId;
    if (id) {
        const { performTechnique } = await import("../use-technique.mjs");
        await performTechnique(this.item, id);
    }
}
```

The existing `_onAddAction`, `_onEditAction`, `_onDuplicateAction`, and
`_onDeleteAction` handlers already exist and are correct (array push /
filter, plus opening `action.sheet`).

---

## 7. Template changes (`templates/item/technique-sheet.hbs`)

The current template already renders the action list correctly with
`data-action-id="{{_id}}"`. The remaining additions:

### Details tab — perform-check hint on the Actions header

```hbs
<h3 class="form-header">
  {{localize "PF1.Action.many"}}
  <span class="perform-hint">{{performHint}}</span>
</h3>
```

### Details tab — Use control on each action row

Inside the existing action row's controls:

```hbs
<a class="use-action {{#unless @root.canUse}}disabled{{/unless}}" title="Use">
  <i class="fa-solid fa-dice-d20"></i>
</a>
```

### Description tab — editor button parameter

Both editors (`description.value` and `description.instructions`) must use
`button=false`. With `button=true`, Foundry adds a `.editor-edit` pencil
that is `display:none` until `:hover` — and an empty editor has no
visible area to hover over, making it unreachable. `button=false` makes
`_activateEditor` call `activate()` immediately on render, so ProseMirror
launches with its toolbar visible.

```hbs
{{editor system.description.value
         target="system.description.value"
         button=false
         owner=editable
         editable=editable}}
```

(Already applied in the current template — listed here for completeness.)

---

## 8. CSS additions (`styles/naruto-d20.css`)

```css
.pf1.sheet.item .perform-hint {
    font-size: 0.75em;
    color: #6b6050;
    font-weight: normal;
    margin-left: 8px;
    font-style: italic;
}
.pf1.sheet.item .use-action {
    cursor: pointer;
    color: #5a4830;
}
.pf1.sheet.item .use-action.disabled {
    pointer-events: none;
    opacity: 0.4;
}
.naruto-perform-bypass {
    color: #5a4830;
    font-style: italic;
    margin: 4px 0;
}
.naruto-technique-card {
    border: 1px solid #c0b89a;
    border-radius: 4px;
    padding: 6px;
    background: rgba(0, 0, 0, 0.03);
}
.naruto-technique-card.failed { border-color: #a04040; }
.naruto-technique-card header h3 { margin: 0; }
.naruto-technique-card footer    { font-size: 0.85em; color: #6b6050; margin-top: 4px; }
```

---

## 9. Build sequence

Each step is independently testable. Don't move on until the preceding
step is verified in-browser.

### Step 0 — `documentClasses` registration ✅ DONE
- Already applied in `main.mjs` `init` hook.
- Already verified: `item.actions` is a Collection, action CRUD works,
  script calls can be created, action sheet opens on edit.

### Step 1 — Add discipline → skill map
- Add `DISCIPLINE_SKILL_MAP` export to `scripts/data/skills.mjs`.
- **Acceptance:** Importable from a new file; no runtime regression.

### Step 2 — `canAffordTechnique` + perform hint
- Create `scripts/use-technique.mjs` with only `canAffordTechnique`.
- Add `context.canUse`, `context.performHint` to `getData`.
- Add the hint span to the template; add CSS for `.perform-hint`.
- **Acceptance:** Sheet header shows the correct hint in all four
  scenarios (no-actor / no-skill / auto-perform / must-roll). No
  functional change to action rows yet.

### Step 3 — Use button (auto-success path)
- Add the Use anchor with `.disabled` styling on each action row.
- Wire `_onUseAction`.
- Implement only the `!skillKey || skillRanks >= threshold` branch of
  `performTechnique`.
- **Acceptance:** On a technique with discipline = "Training" (no skill
  required), clicking Use deducts chakra and posts the Action's
  standard PF1e chat card (attack / damage / save as configured on the
  Action). On a technique with `Ninjutsu` + ranks at/above threshold,
  same behaviour — no dialog.

### Step 4 — Perform check (must-roll path) ✅ DONE
- Implement `_buildPerformParts(sys)` (technique extras only) and the
  `pf1.dice.d20Roll` invocation with `skill:` option in
  `performTechnique`.
- Read success/failure from `roll.rolls[0].total` — `pf1.dice.d20Roll`
  returns a `ChatMessage`, not a `Roll`.
- **Acceptance:** On a technique with discipline = "Ninjutsu" where the
  actor has fewer ranks than the threshold, clicking Use opens the
  PF1e d20 dialog. d20Roll posts its own roll card. On success, chakra
  is deducted, a chakra-deduction card posts, and the Action fires. On
  failure, the failure card posts and no chakra is deducted.

### Step 5 — Disabled Use state on insufficient chakra
- Acceptance covered by Step 2 + Step 3 (the `.disabled` class is
  already conditional on `@root.canUse`). Verify visually.

### Step 6 — End-to-end smoke test
1. Create technique "Test Katon", rank 3, B-Class, Ninjutsu.
2. Edit Action: damage `2d6` fire, save Reflex DC 15 for half.
3. Drag onto a character with 0 ninjutsu ranks. Use → d20 dialog,
   fail at DC. No chakra deducted.
4. Bump character's ninjutsu ranks to threshold. Use → no dialog,
   chakra deducted, damage card posts with PF1e's Reflex save prompt.
5. Spend all chakra, try Use → blocked with notification.
6. Switch discipline to "Training". Use → auto-perform, chakra
   deducted, Action fires immediately.

---

## 10. Out of scope (tracked for follow-up)

- **Multi-success channeling** for B/A/S-class. The `successes` value is
  shown in derived stats but doesn't gate effects yet.
- **Empowerment** (rules doc §EMPOWERMENT — spend extra chakra for extra
  dice). Component flag exists; per-use dialog deferred.
- **Hotbar / macro use.** A drag-to-hotbar macro that calls
  `performTechnique` would be a one-liner module addition.
- **Converging the duplicated fields** (technique-level range/target/area
  vs per-Action range/target/area). User explicitly asked to leave both
  for now.
- **Localization**: new chat-card strings (`"Performance failed."`,
  `"Performance succeeded."`, `"No perform check required."`,
  `"Spent X chakra"`) should be moved to `lang/en.json` in a follow-up.
- **Migration of `activation` to per-Action**: defer.

---

## 11. Open risks

1. **PF1e Action sheet expects an owned item.** `action.sheet.render(true)`
   may behave differently when the Technique is in the world sidebar
   vs on an actor. Test both. (The `documentClasses` fix means the
   sheet at least opens in both cases now.)

2. **`actor.system.skills[key]` shape.** The chakra tab already reads
   `.rank` and `.abilityMod` from this path; `ensureActorSkillEntries`
   seeds them — should be safe.

3. **`pf1.dice.d20Roll` returns a `ChatMessage`, not a `Roll`.**
   Confirmed in v11.11. Access the total via `roll.rolls[0].total`.
   Using `roll.total` returns `undefined`, treating every check as a
   failure. PF1e may rename this structure between minor versions;
   the chakra tab uses the same call, so breakage will surface there
   first.

4. **`action.use()` on an action whose parent item has no `uses`
   field.** PF1e Actions assume the parent item has `system.uses` for
   charge accounting. Our model doesn't define `uses`. If
   `action.use()` throws on this in v11.11, add a no-op
   `uses: { value: 0, max: 0, per: null }` field to the model, or
   override the call site to bypass charge accounting.

5. **Action sheet field persistence.** The Action sheet writes back
   into `system.actions[i]` rows via `ItemAction#update`. Confirm
   damage/attack/save fields persist across a sheet reload — they
   should, since the `ArrayField` accepts arbitrary nested shapes
   from `ItemAction`'s own schema, but if `TechniqueDataModel`'s
   inner `SchemaField` strips unknown keys we'll need to widen it to
   an `ObjectField` row or define the full action shape.
