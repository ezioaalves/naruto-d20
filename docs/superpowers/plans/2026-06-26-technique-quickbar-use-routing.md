# Technique Quickbar Use Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Naruto d20 technique quickbar, Token HUD, and hotbar/action-macro uses route through the same `performTechnique()` flow as the Chakra tab and technique sheet.

**Architecture:** Patch PF1e `ItemPF.prototype.use` only for `naruto-d20.technique` items. External PF1e entry points call `item.use(...)` as usual; the patch redirects technique items into `performTechnique()`. The internal native technique roll uses a symbol bypass option so the patched `item.use(...)` can call PF1e once without recursion.

**Tech Stack:** Foundry VTT module JavaScript ESM, PF1e v11.11 `ItemPF.use`, Node `node:test`, manual Foundry VTT 13 + PF1e v11.11 verification.

---

## Evidence Summary

PF1e v11.11 source reference:

`/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11`

The Chakra tab path already works because `scripts/features/techniques/list.mjs` calls:

```js
await performTechnique(item, firstAction.id, ev);
```

The PF1e quick-action paths bypass that wrapper:

- `module/applications/actor/actor-sheet.mjs:3458` calls `item.use({ token: this.token })`.
- `module/canvas/token-hud.mjs:124` calls `item.use({ ev: event, token: token.document, skipDialog: getSkipActionPrompt() })`.
- `module/documents/macros.mjs:27` creates item macros as `fromUuidSync("${uuid}").use();`.
- `module/documents/macros.mjs:78` creates action macros as `fromUuidSync("${uuid}").use();`; PF1e `ItemAction.use()` then calls `this.item.use(options)`.

The fix belongs at `ItemPF.use` routing, not only in UI click listeners, because that covers all PF1e entry points.

---

### Task 1: Add Routing Helpers And Unit Tests

**Files:**
- Modify: `scripts/core/constants.mjs`
- Create: `scripts/features/techniques/use-routing.mjs`
- Create: `tests/technique-use-routing.test.mjs`

- [ ] **Step 1: Add the native-use bypass constant**

In `scripts/core/constants.mjs`, add:

```js
export const NATIVE_TECHNIQUE_USE_OPTION = Symbol.for("naruto-d20.nativeTechniqueUse");
```

- [ ] **Step 2: Create failing helper tests**

Create `tests/technique-use-routing.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

globalThis.Hooks ??= { once() {}, on() {}, off() {}, callAll() {} };
globalThis.game ??= {
  i18n: {
    format: (_key, data = {}) => data.name ?? "",
    localize: (key) => key,
  },
};
globalThis.ui ??= { notifications: { warn() {} } };
globalThis.pf1 ??= { documents: { item: { ItemPF: class {} } } };

const { NATIVE_TECHNIQUE_USE_OPTION, TECHNIQUE_ITEM_TYPE } = await import(
  "../scripts/core/constants.mjs"
);
const {
  installTechniqueUseRoutingPatch,
  resolveTechniqueUseActionId,
  routeTechniqueItemUse,
} = await import("../scripts/features/techniques/use-routing.mjs");

function action(id) {
  return { id };
}

function techniqueItem(actions, extra = {}) {
  const map = new Map(actions.map((a) => [a.id, a]));
  return {
    type: TECHNIQUE_ITEM_TYPE,
    actions: map,
    system: { actions },
    defaultAction: extra.defaultAction,
    ...extra,
  };
}

describe("resolveTechniqueUseActionId", () => {
  it("keeps a valid requested action id", () => {
    const item = techniqueItem([action("first"), action("second")]);
    assert.equal(resolveTechniqueUseActionId(item, "second"), "second");
  });

  it("falls back to the default action id", () => {
    const item = techniqueItem([action("first")], { defaultAction: action("default") });
    assert.equal(resolveTechniqueUseActionId(item, ""), "default");
  });

  it("falls back to the first action id", () => {
    const item = techniqueItem([action("first"), action("second")]);
    assert.equal(resolveTechniqueUseActionId(item, ""), "first");
  });

  it("returns an empty string when no action exists", () => {
    const item = techniqueItem([]);
    assert.equal(resolveTechniqueUseActionId(item, ""), "");
  });
});

describe("routeTechniqueItemUse", () => {
  it("routes technique item use into performTechnique", async () => {
    const item = techniqueItem([action("first")]);
    const calls = [];

    const result = await routeTechniqueItemUse(
      item,
      { ev: "event", token: "token" },
      async function nativeUse() {
        calls.push(["native"]);
        return "native";
      },
      async (performedItem, actionId, event, context) => {
        calls.push(["perform", performedItem, actionId, event, context]);
        return "performed";
      },
    );

    assert.equal(result, "performed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "perform");
    assert.equal(calls[0][1], item);
    assert.equal(calls[0][2], "first");
    assert.equal(calls[0][3], "event");
    assert.deepEqual(calls[0][4], { token: "token" });
  });

  it("passes non-technique item use through to native PF1e use", async () => {
    const item = { type: "weapon" };
    const result = await routeTechniqueItemUse(
      item,
      { actionId: "attack" },
      async function nativeUse(options) {
        assert.equal(this, item);
        assert.deepEqual(options, { actionId: "attack" });
        return "native";
      },
      async () => {
        throw new Error("performTechnique should not run");
      },
    );

    assert.equal(result, "native");
  });

  it("passes bypassed technique item use through to native PF1e use", async () => {
    const item = techniqueItem([action("first")]);
    const options = { actionId: "first", [NATIVE_TECHNIQUE_USE_OPTION]: true };

    const result = await routeTechniqueItemUse(
      item,
      options,
      async function nativeUse(received) {
        assert.equal(this, item);
        assert.equal(received, options);
        return "native";
      },
      async () => {
        throw new Error("performTechnique should not run");
      },
    );

    assert.equal(result, "native");
  });

  it("falls through to native PF1e use when a technique has no usable action", async () => {
    const item = techniqueItem([]);
    const result = await routeTechniqueItemUse(
      item,
      {},
      async function nativeUse(options) {
        assert.equal(this, item);
        assert.deepEqual(options, {});
        return "native";
      },
      async () => {
        throw new Error("performTechnique should not run without an action");
      },
    );

    assert.equal(result, "native");
  });
});

describe("installTechniqueUseRoutingPatch", () => {
  it("patches ItemPF.use once", () => {
    class ItemPF {
      async use(options) {
        return ["native", this.type, options?.actionId ?? ""];
      }
    }

    const localPf1 = { documents: { item: { ItemPF } } };
    const first = installTechniqueUseRoutingPatch({ pf1Ref: localPf1 });
    const second = installTechniqueUseRoutingPatch({ pf1Ref: localPf1 });

    assert.equal(first, true);
    assert.equal(second, false);
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
npm test -- --test-name-pattern="Technique|routeTechniqueItemUse|resolveTechniqueUseActionId"
```

Expected: fails because `scripts/features/techniques/use-routing.mjs` does not exist and `NATIVE_TECHNIQUE_USE_OPTION` is not exported yet.

- [ ] **Step 4: Implement the routing module**

Create `scripts/features/techniques/use-routing.mjs`:

```js
import { NATIVE_TECHNIQUE_USE_OPTION, TECHNIQUE_ITEM_TYPE } from "../../core/constants.mjs";
import { performTechnique } from "./use.mjs";

const PATCH_KEY = Symbol.for("naruto-d20.techniqueUseRoutingPatched");

export function resolveTechniqueUseActionId(item, requestedActionId = "") {
  if (requestedActionId && item.actions?.get?.(requestedActionId)) return requestedActionId;
  if (item.defaultAction?.id) return item.defaultAction.id;
  return Array.from(item.actions ?? [])[0]?.id ?? "";
}

export async function routeTechniqueItemUse(
  item,
  options = {},
  nativeUse,
  perform = performTechnique,
) {
  if (item?.type !== TECHNIQUE_ITEM_TYPE || options?.[NATIVE_TECHNIQUE_USE_OPTION] === true) {
    return nativeUse.call(item, options);
  }

  const actionId = resolveTechniqueUseActionId(item, options.actionId);
  if (!actionId) return nativeUse.call(item, options);

  return perform(item, actionId, options.ev ?? null, { token: options.token ?? null });
}

export function installTechniqueUseRoutingPatch({ pf1Ref = globalThis.pf1 } = {}) {
  const ItemPF = pf1Ref?.documents?.item?.ItemPF;
  if (!ItemPF?.prototype?.use || ItemPF.prototype[PATCH_KEY]) return false;

  const nativeUse = ItemPF.prototype.use;
  ItemPF.prototype.use = function narutoTechniqueUseRouting(options = {}) {
    return routeTechniqueItemUse(this, options, nativeUse);
  };

  Object.defineProperty(ItemPF.prototype, PATCH_KEY, {
    value: true,
    configurable: false,
  });

  return true;
}
```

- [ ] **Step 5: Run the helper tests**

Run:

```bash
npm test -- --test-name-pattern="routeTechniqueItemUse|resolveTechniqueUseActionId|installTechniqueUseRoutingPatch"
```

Expected: PASS.

---

### Task 2: Bypass Internal Native Technique Rolls

**Files:**
- Modify: `scripts/features/techniques/use.mjs`
- Modify: `scripts/features/techniques/weapon-attack.mjs`
- Modify: `tests/technique-use-routing.test.mjs`

- [ ] **Step 1: Add a failing test for preserving token context**

Append this test to `tests/technique-use-routing.test.mjs` under `describe("routeTechniqueItemUse", ...)`:

```js
it("passes null token context when no token option was provided", async () => {
  const item = techniqueItem([action("first")]);
  const result = await routeTechniqueItemUse(
    item,
    { ev: "event" },
    async () => "native",
    async (_item, _actionId, _event, context) => context,
  );

  assert.deepEqual(result, { token: null });
});
```

Run:

```bash
npm test -- --test-name-pattern="passes null token context"
```

Expected: PASS if Task 1 was implemented as specified.

- [ ] **Step 2: Extend `performTechnique` to accept invocation context**

In `scripts/features/techniques/use.mjs`, update the import:

```js
import { MODULE_ID, NATIVE_TECHNIQUE_USE_OPTION } from "../../core/constants.mjs";
```

Change the exported signature:

```js
export async function performTechnique(item, actionId, event = null, context = {}) {
```

At the start of the function, after `const context = validateTechniqueUse(...)`, rename the local variable to avoid the new parameter name:

```js
const validated = validateTechniqueUse(item, actionId);
if (!validated) return;

const { actor, actionIndex } = validated;
let { cost } = validated;
```

Use `context` only for invocation metadata:

```js
const useResult = await useTechniqueAction(current.item, current.action, actor, event, {
  empower,
  token: context.token ?? null,
});
```

- [ ] **Step 3: Pass bypass and token to native technique `item.use()`**

In `scripts/features/techniques/use.mjs`, update the direct native technique branch inside `useTechniqueAction(...)`:

```js
const useResult = await item.use({
  [NATIVE_TECHNIQUE_USE_OPTION]: true,
  actionId: action.id,
  skipDialog: !(action.hasAttack || action.hasDamage),
  ev: event,
  token: options.token ?? null,
});
```

This is the critical recursion guard. Without this symbol, the patched `ItemPF.use()` would route back into `performTechnique()` indefinitely.

- [ ] **Step 4: Preserve token context for delegated weapon attacks**

In `scripts/features/techniques/use.mjs`, when calling `rollSelectedWeaponAttackWithTechnique(...)`, pass:

```js
token: options.token ?? null,
```

Update the function signature in `scripts/features/techniques/weapon-attack.mjs`:

```js
export async function rollSelectedWeaponAttackWithTechnique({
  technique,
  techniqueAction,
  actor,
  config,
  event,
  token = null,
  empower = null,
}) {
```

And update the delegated PF1e use:

```js
return await selection.item.use({
  actionId: selection.action.id,
  skipDialog: false,
  ev: event,
  token,
  options,
});
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- --test-name-pattern="routeTechniqueItemUse|weaponAttack|Amatsu"
```

Expected: PASS.

---

### Task 3: Install The Patch During Setup

**Files:**
- Modify: `scripts/lifecycle/setup.mjs`

- [ ] **Step 1: Import the patch installer**

In `scripts/lifecycle/setup.mjs`, add:

```js
import { installTechniqueUseRoutingPatch } from "../features/techniques/use-routing.mjs";
```

- [ ] **Step 2: Register the patch before UI listeners**

Inside the first `Hooks.once("setup", ...)` block, place this before `registerTechniqueListListeners()`:

```js
installTechniqueUseRoutingPatch(); // PF1e quickbar/token HUD/hotbar technique use -> performTechnique
```

The order matters only for clarity. The patch affects PF1e `item.use(...)`; the Chakra tab listeners can continue calling `performTechnique(...)` directly.

- [ ] **Step 3: Run import validation**

Run:

```bash
npm run validate:imports
```

Expected: PASS.

- [ ] **Step 4: Run the full unit test suite**

Run:

```bash
npm test
```

Expected: PASS.

---

### Task 4: Foundry Manual QA

**Files:**
- No source changes.

- [ ] **Step 1: Reload Foundry**

Run Foundry VTT 13 with PF1e v11.11, reload the world, and open an actor with `AMATSU NO KARADA (HEAVENLY BODY)` learned.

- [ ] **Step 2: Verify existing Chakra tab behavior**

Use Amatsu from the Chakra tab technique list.

Expected:

- The element prompt still appears when needed.
- The “Choose Attack” dialog appears.
- Selecting an unarmed/natural attack opens the PF1e attack dialog for that selected attack.
- The PF1e dialog offers `Single Attack` and `Full Attack` when the selected attack has iterative/multiple attacks.

- [ ] **Step 3: Verify actor summary quickbar behavior**

Mark Amatsu `Quickbar` on the technique sheet, then use it from the actor Summary quick actions.

Expected:

- The same “Choose Attack” dialog appears.
- The PF1e attack dialog uses the selected unarmed/natural attack, not the technique item's bare action.
- `Full Attack` is available when the selected attack has iterative/multiple attacks.

- [ ] **Step 4: Verify Token HUD behavior**

Select the actor token, open the Token HUD quick actions, and click Amatsu.

Expected:

- The same “Choose Attack” dialog appears.
- The roll uses the token context without errors.
- Ctrl-click still displays the item card, because the PF1e Token HUD handles Ctrl-click before calling `item.use()`.

- [ ] **Step 5: Verify hotbar macro behavior**

Drop the Amatsu item onto the hotbar and run the generated macro.

Expected:

- The generated `fromUuidSync("...").use();` macro routes through `performTechnique()`.
- “Choose Attack” appears.
- `Full Attack` is available after selecting an iterative attack.

- [ ] **Step 6: Verify action macro behavior**

Create or drag a PF1e action macro for the Amatsu action, then run it.

Expected:

- PF1e `ItemAction.use()` sets `options.actionId`.
- The patched item use preserves that action id.
- “Choose Attack” appears.

- [ ] **Step 7: Regression check direct non-weapon technique**

Use a technique without `system.flags.dictionary.weaponAttack.*` from the quickbar.

Expected:

- It still performs the Naruto d20 perform/chakra flow.
- It then opens the native PF1e action dialog when the action has attack or damage.
- It does not recurse or create duplicate chat cards.

---

## Completion Criteria

- `npm test` passes.
- `npm run validate:imports` passes.
- Amatsu has identical behavior from the Chakra tab, actor Summary quickbar, Token HUD quick action, item hotbar macro, and action macro.
- No PF1e source files are modified.
- No compendium source JSON changes are required for this fix.
