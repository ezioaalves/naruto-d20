# Compendium source ↔ packs workflow

How the `techniques` compendium is edited. The data lives in two forms and you
always edit the **source**, then **pack** it into the form Foundry loads.

## The two forms

| Form | Path | Role |
|---|---|---|
| **Source** (editable) | `packs/_source/techniques/*.json` | One JSON file per technique. Human-editable, diff-friendly, the source of truth committed to git. |
| **Packed** (runtime) | `packs/techniques/` | A LevelDB database. This is what Foundry actually reads at runtime. **Never hand-edit** — it is generated from the source. |

> The repository was restructured in #28 to nest each compendium under its own
> subfolder (`packs/_source/techniques/`, not `packs/_source/` directly). Any
> transform script must point its source directory at `packs/_source/techniques`.

## The round trip

```
packs/techniques/ (LevelDB)  ──unpack──▶  packs/_source/techniques/*.json
                                                    │
                                              edit / transform
                                                    │
packs/techniques/ (LevelDB)  ◀───pack────  packs/_source/techniques/*.json
                                                    │
                                              F5 in Foundry
```

The npm scripts (in `package.json`) wrap the `@foundryvtt/foundryvtt-cli`:

| Command | What it does |
|---|---|
| `npm run unpack` | LevelDB `packs/techniques/` → JSON source. Run this only when you need to start from the current packed data (e.g. after someone edited in-app). It **overwrites** the source files. |
| `npm run pack` | JSON source → LevelDB `packs/techniques/`. **Required** for any source edit to reach the game. |

Run `npm install` once first so `node_modules/.bin/fvtt` exists.

## Editing the source

Two ways, both operating on `packs/_source/techniques/*.json`:

1. **By hand** — open the JSON and edit fields. Each file is a full document
   (`_id`, `name`, `type: "naruto-d20.technique"`, `system`, `_key`, …).
2. **With a transform script** under `tools/` — a small Node ESM program that
   reads every JSON, mutates it, and writes it back. No Foundry/CLI needed.

### Technique action shape

Combat behaviour lives in `system.actions` (an array; techniques use a single
entry). Relevant fields:

```jsonc
{
  "_id": "eIBERKg99jcRIRoK",
  "name": "Use",
  "actionType": "rwak",          // mwak | rwak | spellsave | save | heal | other
  "activation": { "type": "standard", "unchained": { "type": "action", "cost": 2 } },
  "range": { "units": "long" },  // personal|touch|close|medium|long|ft
  "damage": { "parts": [ { "formula": "1d8+1", "types": ["electric"] } ] },
  "save": { "type": "ref", "description": "Reflex half" },
  "ability": { "attack": "dex", "damage": "str", "critRange": 20, "critMult": 2 }
}
```

**Attack types in Naruto d20:** only weapon attack action types are used —
`mwak` (melee) and `rwak` (ranged). They roll attacks on **DEX**
(`ability.attack = "dex"`). If the action deals damage, that damage uses
**STR** (`ability.damage = "str"`). Some melee touch techniques only roll an
attack to apply a save/effect and have no damage block. PF1e's *spell* attack
types (`msak`/`rsak`) are **not** used: they key off a spellcasting class
ability that techniques don't have. Non-attack actions use
`spellsave`/`save`/`heal`/`other`.

## Transform scripts (`tools/`)

| Script | npm alias | Purpose |
|---|---|---|
| `add-actions.mjs` | `npm run add-actions` | Generates `system.actions[0]` for techniques from their flat fields (range, save, damage in description, …). **Skips** any technique that already has actions (use `--force` to override, `--dry-run` to preview). |
| `fix-action-ids.mjs` | `npm run fix-action-ids` | Rewrites invalid/non-alphanumeric `system.actions[*]._id` values so PF1e can resolve the action reliably. `--dry-run` to preview. |
| `fix-spell-attacks.mjs` | `npm run fix-spell-attacks` | One-off cleanup: rewrites any `actionType: "rsak" → "rwak"` and `"msak" → "mwak"`, attaching the DEX/STR `ability` block. Idempotent — only touches matching action types. `--dry-run` to preview. |
| `validate-compendia.mjs` | `npm run validate:compendia` | Validates source JSON structure for techniques, feats and technique buffs: item types, IDs, action/change/link shape, technique rank/complexity/discipline, `weaponAttack` config and automation buff matches. Use `-- --strict-warnings` to fail on warnings too. |

Convention for new transforms: scan `packs/_source/techniques/`, only rewrite a
file when something actually changed, support `--dry-run`, and print a summary.

## Full procedure for a source-wide edit

```sh
npm install                       # once
npm run unpack                    # only if you must resync source from the DB first
node tools/<your-transform>.mjs --dry-run   # preview
node tools/<your-transform>.mjs             # apply to source JSON
# review `git diff` on packs/_source/techniques/
npm run validate:compendia
npm run pack                      # rebuild packs/techniques/ (LevelDB)
# F5 in Foundry to load the new pack
```

## Verification

- `git diff --stat packs/_source/techniques/` shows the expected file count changed.
- `npm run validate:compendia` exits with 0 errors before packing.
- Grep the source to confirm the change, e.g.
  `grep -rl '"actionType": "rsak"' packs/_source/techniques/ | wc -l` → `0`.
- After `npm run pack`, the LevelDB files under `packs/techniques/` are updated
  (`git status` shows them modified).
- In Foundry (F5), open the techniques compendium and confirm the action on a
  converted technique uses DEX to hit and STR for damage.
