# Jutsu Compendium Import Plan

**Goal**: Convert `all_jutsus.json` (1053 spell-typed items from the old PF1e system) into a
Foundry module compendium of `naruto-d20.technique` items, compiled as a LevelDB pack and
declared in `module.json`.

---

## Data snapshot

| Stat | Value |
|------|-------|
| Total entries | 1053 |
| Source item type | `"spell"` (legacy PF1e) |
| Target item type | `"naruto-d20.technique"` |
| Entries with empty rank (`""`) | 3 → default `rank: 1` |
| Entries with non-int chakraCost (`"*"` or `""`) | 93 → default `chakraCost: 0` |
| Complexity resolvable from embedded DC | 740 (~70%) |
| Complexity unresolvable (nearest-match fallback) | 310 |

**Disciplines** (from `flags.naruto.type`):

| Discipline | Count |
|------------|-------|
| Ninjutsu | 550 |
| Taijutsu | 223 |
| Genjutsu | 101 |
| Fuinjutsu | 79 |
| Chakra Control | 50 |
| Training | 42 |
| Hachimon Tonkou | 8 |

---

## Approach

Use **`@foundryvtt/foundryvtt-cli`** (the official Foundry CLI) to compile a folder of per-item
JSON source files into a LevelDB pack. This is the same toolchain used by `pf1-source`.

Workflow:
```
all_jutsus.json  →  [tools/convert-jutsus.mjs]  →  packs/_source/techniques/*.json
                                                            ↓
                                               [fvtt package pack]
                                                            ↓
                                                  packs/techniques/  (LevelDB)
                                                            ↓
                                                    module.json packs[]
```

---

## Phase 0 — Tooling bootstrap

Create `package.json` in the `naruto-d20/` root (dev-only; not loaded by Foundry):

```json
{
  "name": "naruto-d20",
  "private": true,
  "type": "module",
  "scripts": {
    "convert": "node tools/convert-jutsus.mjs",
    "pack":    "fvtt package pack --in packs/_source/techniques --out packs/techniques --type Item --id naruto-d20.techniques",
    "unpack":  "fvtt package unpack --in packs/techniques --out packs/_source/techniques --type Item"
  },
  "devDependencies": {
    "@foundryvtt/foundryvtt-cli": "^1.0.0"
  }
}
```

Install: `npm install` (or `npm ci` once `package-lock.json` is committed).

---

## Phase 1 — Conversion script (`tools/convert-jutsus.mjs`)

Reads `all_jutsus.json`, maps each entry to a TechniqueDataModel-shaped object, and writes
one JSON file per technique to `packs/_source/techniques/`.

### 1.1 Field mapping

| Source path | Target field | Notes |
|-------------|-------------|-------|
| `name` | `name` | As-is |
| `flags.naruto.type` | `system.discipline` | As-is |
| `flags.naruto.subtype` | `system.subtype` | As-is; `"*"` → `""` |
| `flags.naruto.rank` | `system.rank` | int; `""` → `1` |
| `flags.naruto.chakraCost` | `system.chakraCost` | int; `"*"` or `""` → `0` |
| `system.activation.type` | `system.activation` | `"standard"` / `"swift"` / `"full"` |
| `system.range.value` | `system.range` | As-is string |
| `system.target.value` | `system.target` | As-is string |
| `system.area.value` | `system.area` | As-is string |
| `system.duration.value` | `system.duration` | As-is string |
| `system.save.description` | `system.save` | As-is string |
| `system.description.value` | `system.description.value` | HTML kept verbatim |
| (derived — see §1.2) | `system.complexity` | Reverse-engineered from embedded DCs |
| (parsed — see §1.3) | `system.comp*` | From `system.components.value` |

### 1.2 Complexity resolution

The original HTML description embeds `<b>Learn DC:</b> N` and `<b>Successes:</b> N`.

Algorithm:
1. Extract `learnDC` and `successes` via regex.
2. Compute `learnMod = learnDC − 10 − rank`.
3. Look up `(learnMod, successes)` in the reverse COMPLEXITY_TABLE.
4. **Fallback** (unresolvable ~310 entries): find the row with the smallest
   `|row.learnMod − learnMod|`, breaking ties by `|row.successes − successes|`.
   If no DC at all, default to `"E-Class"`.

```
COMPLEXITY_TABLE reverse lookup:
  (1, 1)  → "E-Class"       ← also covers Extremely Easy / Very Easy / Easy
  (2, 1)  → "D-Class"
  (3, 2)  → "C-Class"
  (4, 3)  → "B-Class"
  (5, 4)  → "A-Class"
  (6, 5)  → "S-Class"
  (7, 6)  → "SS-Class"
  (15, 8) → "Epic"
```

### 1.3 Component token → boolean flag mapping

Parse `system.components.value` (comma-separated) into the model's `compXxx` booleans:

| Token(s) | Field |
|----------|-------|
| `Hand Seals`, `H *` | `compHandSeals` |
| `Half-Seals` | `compHalfSeals` |
| `Concentration` | `compConcentration` |
| `Mobility`, `Mas Mob`, `Mob Range: *` | `compMobility` |
| `Focus` | `compFocus` |
| `Empower`, `E *` | `compEmpower` |
| `Mastery`, `Mas *`, `Mas Mob` | `compMastery` |
| `Physical` | `compPhysical` |
| `XP Cost`, `X` | `compXpCost` |
| `M`, `M *` | *(Material — no field in model; silently ignored)* |

> `"Mas Mob"` sets both `compMastery` and `compMobility`.

### 1.4 Sanitization rules

- `rank`: coerce to `Math.max(1, parseInt(rank) || 1)`, clamped `1–15`.
- `chakraCost`: `typeof v === "number" ? v : 0`.
- `subtype`: `v === "*" ? "" : (v ?? "")`.
- `discipline`: keep as-is; "Training" and "Hachimon Tonkou" are valid (chakra tab shows them under "Other").
- `activation`: if not `swift/full`, default `"standard"`.

### 1.5 Output format (per-file JSON)

Each file: `packs/_source/techniques/<slug>.json`

```json
{
  "_id": "<random 16-char Foundry ID>",
  "name": "TECHNIQUE NAME",
  "type": "naruto-d20.technique",
  "img": "icons/svg/explosion.svg",
  "system": {
    "description": { "value": "...", "summary": "", "instructions": "" },
    "discipline":    "Ninjutsu",
    "subtype":       "Doton",
    "rank":          5,
    "complexity":    "C-Class",
    "chakraCost":    4,
    "activation":    "standard",
    "range":         "Medium (20 ft. + 10 ft./2 levels)",
    "target":        "",
    "area":          "20 ft. Burst",
    "duration":      "Instant",
    "save":          "Reflex half",
    "compHandSeals":     true,
    "compConcentration": false,
    "compHalfSeals":     false,
    "compFocus":         false,
    "compEmpower":       false,
    "compMastery":       false,
    "compMobility":      false,
    "compPhysical":      false,
    "compXpCost":        false,
    "isHijutsu":     false,
    "isKinjutsu":    false,
    "isCombination": false,
    "performMiscBonus": 0,
    "active": false,
    "changes":  [],
    "actions":  [],
    "scriptCalls": [],
    "links": { "prerequisites": [], "supplements": [], "children": [] },
    "tag": "",
    "tags": [],
    "flags": { "boolean": {}, "dictionary": {} },
    "showInQuickbar": false,
    "showInCombat": false
  },
  "effects": [],
  "folder": null,
  "sort": 0,
  "ownership": { "default": 0 },
  "flags": {}
}
```

### 1.6 Slug generation

```js
function slug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
```

Deduplicate by appending `-2`, `-3`, etc. if a slug already exists in the output set.

### 1.7 `_id` generation

Use `crypto.randomUUID().replace(/-/g,"").slice(0,16)` (Node.js built-in, no dependency).

---

## Phase 2 — Compile the pack

```bash
npm run convert   # writes packs/_source/techniques/*.json
npm run pack      # compiles to packs/techniques/ LevelDB
```

The CLI command resolves to:
```bash
fvtt package pack \
  --in  packs/_source/techniques \
  --out packs/techniques \
  --type Item \
  --id  naruto-d20.techniques
```

---

## Phase 3 — Declare the pack in `module.json`

Add to `module.json`:

```json
"packs": [
  {
    "name":   "techniques",
    "label":  "Naruto Techniques",
    "path":   "packs/techniques",
    "type":   "Item",
    "system": "pf1"
  }
]
```

---

## Phase 4 — (Optional) per-discipline default image

Map discipline to a default `img` path so the compendium looks better in Foundry:

| Discipline | img |
|------------|-----|
| Ninjutsu | `modules/naruto-d20/icons/ninjutsu.svg` (or placeholder) |
| Taijutsu | `modules/naruto-d20/icons/taijutsu.svg` |
| Genjutsu | `modules/naruto-d20/icons/genjutsu.svg` |
| Fuinjutsu | `modules/naruto-d20/icons/fuinjutsu.svg` |
| Chakra Control | `modules/naruto-d20/icons/chakra-control.svg` |
| Training / Hachimon Tonkou | `icons/svg/book.svg` (Foundry built-in) |

If the module doesn't yet have those icons, fall back to `"icons/svg/explosion.svg"` for all.

---

## Edge cases and known data issues

| Issue | Handling |
|-------|---------|
| `rank: ""` (3 entries) | → `rank: 1` |
| `chakraCost: "*"` (89 entries) | → `chakraCost: 0`; the `*` means "variable" — preserve in description HTML |
| `chakraCost: ""` (4 entries) | → `chakraCost: 0` |
| `subtype: "*"` (2 entries) | → `subtype: ""` |
| `complexity` unresolvable (310 entries) | → nearest-match or `"E-Class"` |
| Duplicate slugs | → append `-2`, `-3` suffix |
| Very long names (> 128 chars) | Slug truncated to 64 chars; full name preserved in `name` field |

---

## File checklist

```
naruto-d20/
├── package.json               [NEW] dev tooling only
├── tools/
│   └── convert-jutsus.mjs     [NEW] conversion script
├── packs/
│   ├── _source/
│   │   └── techniques/        [NEW] one .json per technique (gitignored or committed)
│   └── techniques/            [NEW] compiled LevelDB (gitignored — large binary)
│       ├── LOCK
│       ├── LOG
│       └── *.ldb
└── module.json                [EDIT] add packs[] array
```

> **Git note**: Commit `packs/_source/techniques/` (the JSON source files) and
> `packs/techniques/` (the compiled LevelDB). The LevelDB can be regenerated from source
> but shipping it means Foundry can load the compendium without a build step.
> Add `node_modules/` to `.gitignore`.

---

## Execution order

1. `npm install` — installs `@foundryvtt/foundryvtt-cli`
2. `npm run convert` — generates `packs/_source/techniques/*.json`
3. Review a handful of output files manually
4. `npm run pack` — compiles to LevelDB
5. Edit `module.json` — add `packs[]`
6. Reload Foundry (F5)
7. In Foundry: open Compendium tab → "Naruto Techniques" should appear with 1053 entries
