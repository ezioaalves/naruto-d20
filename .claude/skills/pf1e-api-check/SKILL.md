---
name: pf1e-api-check
description: Use BEFORE referencing any pf1.* global, CONFIG.PF1.* key, system.* data-model field, or "PF1.*" i18n key, or when locating where a feature lives inside naruto-d20. Verifies facts against the pinned v11.11 source and records them so they are not re-derived.
---

# PF1e v11.11 API Check (self-growing)

Stops re-deriving facts every session. Cache-first; on a miss, read the **pinned
v11.11 source** (never the built `pf1.js`, never context7); then record the fact.

## Ground truth

`/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11` — clean
unbuilt source, `public/system.json` reports `version: 11.11`. This is the **only**
API ground truth.

- ❌ Do NOT grep the built `/systems/pf1/pf1.js`.
- ❌ Do NOT use context7 for PF1e API facts (it tracks a newer branch than 11.11).
- ❌ Do NOT trust the `pf1/` → `pf1-source/` symlink (dev branch).

### Namespace → source file

| Symbol you need | Where to read it (under the source root) |
|---|---|
| `pf1.components.*` (ItemChange, conditionals, …) | `module/components/<name>.mjs` |
| `pf1.applications.*` (sheets, browsers, dialogs) | `module/applications/` |
| `pf1.documents.*` | `module/documents/` |
| `pf1.dice.*` | `module/dice/` |
| `CONFIG.PF1.*` keys | `module/config.mjs` |
| `"PF1.*"` i18n keys | `lang/en.json` |
| `system.*` data-model fields | `module/models/` |

## Procedure (follow exactly)

1. **Cache first.** Read the relevant cache:
   - PF1e API fact → `references/verified-api.md`
   - "Where does X live in naruto-d20?" → `references/naruto-codemap.md`

   If the fact is present, **use it and stop.** Do not open any source file.

2. **On a miss, read the source.** Use the namespace→file map above to open the
   right file under the source root (or `lang/en.json`). Confirm the real symbol /
   key / field and its line.

3. **Record it.** Append a new entry to the matching cache in the format that file's
   header documents. Only record facts you **verified** from source — never guesses.

## Rules

- Never add a guessed entry. A cache entry means "checked against v11.11 source".
- If an existing cache entry contradicts the source, fix the entry (the source wins)
  and note the correction inline.
- Keep entries one line where possible: `` `symbol` → `path:line` → short note ``.
