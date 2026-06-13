# Design — `pf1e-api-check` self-growing API skill

**Date:** 2026-06-13
**Status:** Approved (design), pending implementation plan

## Problem

Every fresh Claude session re-derives knowledge it effectively already learned in
prior prompts, burning tokens:

- **PF1e v11.11 API facts** — class names, `CONFIG.PF1.*` keys, `"PF1.*"` i18n keys,
  data-model field paths, and which paths are real vs dev-branch divergences. Claude
  greps the 5 MB built `pf1.js` (or queries context7) every time.
- **naruto-d20 internals** — where each thing lives, flag patterns, hook pipeline.
  Largely in `CLAUDE.md`, but Claude still re-explores to find precise `file:line`.

Facts verified in one session do not persist to the next. Memory (`MEMORY.md`) and
`CLAUDE.md` both load into **every** session's context, so storing API facts there
inflates token cost on every conversation — the opposite of the goal.

## Goal

Persist verified facts in an **on-demand** store that only enters context when the
task is relevant, and that **grows automatically** as facts are verified — so the
token cost of API/convention lookup trends down over time.

## Ground-truth source correction

The current `CLAUDE.md` tells Claude to treat the built `/systems/pf1/pf1.js` +
context7 as ground truth and to distrust the `pf1-source/` symlink (dev branch).

There is a separate, **verified** source mirror:

```
/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11/
```

`public/system.json` reports `"version": "11.11"` — it is exactly the installed
version, as clean unbuilt Vite source. This is **distinct** from the `pf1-source/`
dev-branch symlink. It is a better ground truth than both `pf1.js` (one giant file)
and context7 (newer than 11.11).

### Namespace → source-file map

| Symbol you need | Where to read it |
|---|---|
| `pf1.components.ItemChange` (and other components) | `module/components/change.mjs` (per-component `.mjs`) |
| `pf1.applications.*` (sheets, browsers, dialogs) | `module/applications/` |
| `pf1.documents.*` | `module/documents/` |
| `pf1.dice.*` | `module/dice/` |
| `CONFIG.PF1.*` keys | `module/config.mjs` |
| `"PF1.*"` i18n keys | `lang/en.json` |
| `system.*` data-model fields | `module/models/` |

## Solution

A single project-level skill, **`pf1e-api-check`**, at
`.claude/skills/pf1e-api-check/` (versioned in the repo; matches the name the
existing `CLAUDE.md` already references). It owns two auto-growing reference caches.

### Skill procedure (rigid)

1. **Trigger** — before referencing any `pf1.*` global, `CONFIG.PF1.*` key,
   `system.*` field, or `"PF1.*"` i18n key; or when locating where a feature lives
   inside naruto-d20.
2. **Step 1 — consult cache first.** Read the relevant `references/*.md`. If the
   fact is present → use it and **stop**. No source reading.
3. **Step 2 — only on a miss.** Read from
   `foundryvtt-pathfinder1-v11.11/module/` (or `lang/en.json`) using the
   namespace→file map. **Never** the built `pf1.js`; **never** context7 for PF1e API
   facts.
4. **Step 3 — record.** Append the verified fact to the matching cache file in the
   structured format below, so the next session resolves it at Step 1.

### Reference caches (both auto-growing)

- **`references/verified-api.md`** — PF1e v11.11 API facts.
  Entry format: `` `symbol` → `path/in/source:line` → note ``.
  **Seed** from the existing `CLAUDE.md` "Known divergences" list:
  - `pf1.components.ItemChange` (real) vs `pf1.models.components.Change` (dev-only).
  - `system.changes` is an `ArrayField` in v11.11, not a `TypedObjectField`.
  - i18n keys are mostly flat (`PF1.Changes`, not `PF1.Changes.many`).
  - Actor sheet classes are `pf1.applications.ActorSheetPFCharacter` etc.

- **`references/naruto-codemap.md`** — `topic → file:line` index of naruto-d20
  internals.
  **Seed** from the existing `CLAUDE.md` "Anchor invariants" and source-tree table
  (e.g. `NARUTO_SKILLS` → `scripts/data/skills.mjs`; `BUFF_TARGETS` →
  `scripts/flag-paths.mjs`; hook orchestration → `scripts/main.mjs`).

Both caches start small and grow only with **verified** entries — never guesses.

### Single-skill decision

Both caches live under the one `pf1e-api-check` skill (not a second skill). One
discipline ("verify from the right source, then record"), one artifact to maintain.
The skill's trigger covers both the PF1e-API moment and the naruto-locate moment.

## CLAUDE.md changes

Edit the "PF1e version pinning" section (and the per-feature
`naruto-d20/CLAUDE.md` references to API verification) to:

- Name `foundryvtt-pathfinder1-v11.11/` as the **ground-truth** source for v11.11
  API facts, with the namespace→file map.
- Demote context7 to concept/cookbook reference, not an API spec (it tracks a newer
  branch than 11.11).
- Replace the dangling "invoke the `pf1e-api-check` skill" instruction so it points
  at the skill that now actually exists.
- Remove the reference to the non-existent `pf1e-api-verifier` subagent entirely
  (the skill covers its job; see Out of scope).

## Out of scope (YAGNI)

- No `pf1e-api-verifier` subagent — the skill covers verification.
- No automated hook/script to populate the caches — growth happens through the
  skill's Step 3 discipline during normal work.
- No bulk pre-population beyond the seed facts already written in `CLAUDE.md`.

## Success criteria

- The skill exists at `.claude/skills/pf1e-api-check/SKILL.md` with both seeded
  reference caches.
- A PF1e API question that is already in `verified-api.md` is answered with **zero**
  reads of `pf1.js` or `foundryvtt-pathfinder1-v11.11/`.
- A miss reads only from `foundryvtt-pathfinder1-v11.11/` (or `lang/en.json`), then
  the fact appears as a new entry in the cache.
- `CLAUDE.md` no longer points at non-existent tooling and names the v11.11 source as
  ground truth.
