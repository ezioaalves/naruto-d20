# Technique condition enrichers

## Goal

Let techniques that inflict conditions (e.g. *Shitsukentou no Jutsu* → **dazed**) expose a
clickable button that applies the condition, using PF1e's built-in **text enrichers**
(wiki: `Help/Enrichers`). The button must work both on the technique's item sheet and in the
success chat card posted when the technique is performed.

## Which enricher — `@Condition`, not `@Apply`

PF1e v11.11 ships two distinct button enrichers that are easy to confuse:

| Enricher | Applies | Notes |
|---|---|---|
| `@Apply[...]` | A **buff item** (by name or UUID) | Hard-restricted to `type === "buff"`; errors on anything else. Use it for the buff-automation flow, not conditions. |
| `@Condition[...]` | A **condition** (dazed, shaken, …) | Resolved via `pf1.registry.conditions.getAliased()`. This is the one for conditions. |

So conditions use `@Condition`. The buff path is the separate
[buff automation](../scripts/automation/buff-application.mjs) feature.

## Syntax

Verified against the installed `pf1.js` enricher regex:

```
@Condition[<key>;<options>]{<label>}
```

```
/@Condition\[(?<condition>\w+)(?:;(?<options>.*?))?](?:\{(?<label>.*?)})?/g
```

- `<key>` — a single word (the condition key, see table below). Required.
- `<options>` — optional, `;`-separated `key=value` / flags. Supported: `toggle` (flip state),
  `remove` / `disable` (remove it), `info` (link to the compendium entry instead of applying),
  `duration` (set a time period). With no option, clicking **adds** the condition.
- `{<label>}` — optional display text; replaces the rendered button text.

Examples:

```
@Condition[dazed]                          → button "Dazed", adds Dazed
@Condition[dazed]{dazed}                    → lower-case label, adds Dazed
@Condition[shaken;duration=1 round]{shaken} → adds Shaken for 1 round
@Condition[confused;info]{Confused}         → links the Confused compendium entry (no apply)
@Condition[stunned;toggle]                  → toggles Stunned on the selected/targeted token
```

Clicking the button applies the condition to the player's selected/targeted token(s) via
PF1e's own condition handling — no module code is involved in the click.

> `duration` value format: validate in-app. The option-less form is the safe default; add
> `duration=...` only after confirming the parsed result on a live token.

## Condition keys

Canonical keys from `pf1.registry.conditions` (v11.11):

```
bleed        blind        confused     cowering     dazed        dazzled
deaf         disabled     dying        entangled    exhausted    fatigued
flatFooted   frightened   grappled     helpless     incorporeal  invisible
nauseated    panicked     paralyzed    petrified    pinned       prone
shaken       sickened     sleep        squeezing    stable       staggered
stunned      unconscious
```

(Note: the *fear track* key is `frightened`, plus the separate `shaken` / `panicked` keys.)

## Where to author it / where it shows up

- **Author** the enricher inline in the technique's `system.description.value`, in the prose
  where the effect already lives. In the `packs/_source/techniques/*.json` files this is plain
  text — no JSON escaping needed.
- **Item sheet** — appears automatically. `ui/technique-sheet.mjs` already runs the description
  through `TextEditor.enrichHTML` (its `getData`), so the button is live on the *Description* tab
  with no extra work.
- **Perform chat card** — surfaced by `use-technique.mjs`. After a successful perform it enriches
  `currentItem.system.description.value` and injects it into the success card inside a collapsible
  `<details class="naruto-technique-effect"><summary>Effect</summary>…</details>`. This runs only
  on success — a failed perform never causes the effect, so its card omits the block.

## Files

- `packs/_source/techniques/SHITSUKENTOU_NO_JUTSU__…2qcPnzRtPZbkAOVv.json` — reference example
  (`@Condition[dazed]{dazed}` in the effect line).
- `scripts/use-technique.mjs` — enriches the description and adds the `Effect` block to both
  success-card branches (auto-bypass and roll path).
- `scripts/ui/technique-sheet.mjs` — pre-existing description enrichment for the sheet.

## Manual verification

1. Reload the world (`F5`) after editing.
2. Open the technique → *Description* tab: "dazed" is a clickable PF1e condition button.
3. Equip the technique on an actor, select a target token, perform it successfully.
4. In the success chat card, expand **Effect**: the `@Condition` button is present and clickable;
   clicking it applies *Dazed* to the selected/targeted token (status icon on the token + entry in
   the actor's conditions).
5. Force a failed perform: the failure card shows **no** Effect block.
6. If a pre-enriched button does not respond to clicks in chat, fall back to placing the raw
   `@Condition[...]` text directly in the chat `content` (Foundry auto-enriches message content on
   render) and re-verify.
