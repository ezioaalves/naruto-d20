# pf1e-api-check Self-Growing API Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a project-level `pf1e-api-check` skill with two auto-growing reference caches, sourced from the verified v11.11 source tree, and correct `CLAUDE.md` to match.

**Architecture:** A single skill at `.claude/skills/pf1e-api-check/` enforces a "cache-first, else read v11.11 source, then record" procedure. Two seeded markdown caches (`verified-api.md` for PF1e API facts, `naruto-codemap.md` for module internals) grow as facts are verified. `CLAUDE.md` is updated to name `foundryvtt-pathfinder1-v11.11/` as ground truth and stop pointing at non-existent tooling.

**Tech Stack:** Markdown skill files (Claude Code skill format), no build step. Verification is structural (file existence + `grep`), since there is no test runner for skill content.

**Verification note:** This plan produces documentation/skill artifacts, not executable code, so the usual write-test-first TDD loop is replaced by *define the expected structure, create the artifact, then verify with `grep`/`ls`*. Treat each "verify" step as the test.

**Reference (do not re-derive — verified during planning):**

| Symbol | Source location (v11.11) |
|---|---|
| `pf1.components.ItemChange` | `module/components/change.mjs:12` |
| `pf1.applications.ActorSheetPFCharacter` | `module/applications/actor/character-sheet.mjs:9` (re-export `module/applications/actor/_module.mjs:2`) |
| `pf1.dice.d20Roll` | `module/dice/d20roll.mjs:661` |
| `CONFIG.PF1.buffTargets` | `module/config.mjs:2623` |

(`<SRC>` below = `/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11`. Run all `git`/`ls` from the repo root `/Users/joelfmjr/foundrydata/Data/modules/naruto-d20`.)

---

### Task 1: Skill scaffold + SKILL.md procedure

**Files:**
- Create: `.claude/skills/pf1e-api-check/SKILL.md`

- [ ] **Step 1: Create the skill file**

Create `.claude/skills/pf1e-api-check/SKILL.md` with exactly this content:

````markdown
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
````

- [ ] **Step 2: Verify the file exists and frontmatter is well-formed**

Run:
```bash
ls -la .claude/skills/pf1e-api-check/SKILL.md && head -4 .claude/skills/pf1e-api-check/SKILL.md
```
Expected: file listed; first four lines are `---`, `name: pf1e-api-check`, the `description:` line, `---`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pf1e-api-check/SKILL.md
git commit -m "feat(skill): add pf1e-api-check procedure"
```

---

### Task 2: Seed `references/verified-api.md`

**Files:**
- Create: `.claude/skills/pf1e-api-check/references/verified-api.md`

- [ ] **Step 1: Create the seed cache**

Create `.claude/skills/pf1e-api-check/references/verified-api.md` with exactly this content:

````markdown
# Verified PF1e v11.11 API facts

Auto-growing cache. Each entry was checked against the pinned source root
`/Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11`.

**Entry format:** `` `symbol` → `path/under/source/root:line` → note ``
Append new verified facts under the matching section. Never add a guessed entry.

## Globals (`pf1.*`)

- `pf1.components.ItemChange` → `module/components/change.mjs:12` → real class. NOT
  `pf1.models.components.Change` (that path is dev-branch only).
- `pf1.applications.ActorSheetPFCharacter` → `module/applications/actor/character-sheet.mjs:9`
  (re-exported at `module/applications/actor/_module.mjs:2`). The actor sheet class
  is `ActorSheetPFCharacter`, NOT `pf1.applications.actor.CharacterSheetPF`.
- `pf1.dice.d20Roll` → `module/dice/d20roll.mjs:661` → `async function d20Roll(options = {})`.

## CONFIG.PF1

- `CONFIG.PF1.buffTargets` → `module/config.mjs:2623` → exported `buffTargets` const.

## Data models (`system.*`)

- `system.changes` is an `ArrayField` in v11.11 (NOT a `TypedObjectField` record —
  that's the dev branch). Source under `module/models/`.

## i18n (`"PF1.*"`)

- i18n keys are mostly **flat** in v11.11: use `PF1.Changes`, NOT `PF1.Changes.many`.
  Keys live in `lang/en.json`.
````

- [ ] **Step 2: Verify the seed entries are present**

Run:
```bash
grep -c "→" .claude/skills/pf1e-api-check/references/verified-api.md
grep "ItemChange\|d20Roll\|buffTargets" .claude/skills/pf1e-api-check/references/verified-api.md
```
Expected: count ≥ 4; the three named symbols appear.

- [ ] **Step 3: Spot-check one fact against source (proves the cache is accurate)**

Run:
```bash
sed -n '12p' /Users/joelfmjr/foundrydata/Data/modules/foundryvtt-pathfinder1-v11.11/module/components/change.mjs
```
Expected: a line containing `export class ItemChange`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/pf1e-api-check/references/verified-api.md
git commit -m "feat(skill): seed verified-api cache with known v11.11 facts"
```

---

### Task 3: Seed `references/naruto-codemap.md`

**Files:**
- Create: `.claude/skills/pf1e-api-check/references/naruto-codemap.md`

- [ ] **Step 1: Create the seed cache**

Create `.claude/skills/pf1e-api-check/references/naruto-codemap.md` with exactly this content:

````markdown
# naruto-d20 code map

Auto-growing `topic → file:line` index of where things live in this module, so the
location is not re-explored each session. Paths are relative to the repo root.

**Entry format:** `` topic / symbol → `path:line` → note ``
Append a new entry whenever you locate something not already listed. Verify the line
before recording (lines drift — re-grep if an entry looks stale).

## Anchor invariants (single sources of truth)

- `NARUTO_SKILLS` (canonical discipline map) → `scripts/data/skills.mjs:35`.
- `LEARN_KEYS` (derived from NARUTO_SKILLS) → `scripts/data/skills.mjs:44`.
- `BUFF_TARGETS` (targetName → {label,path,sort}) → `scripts/flag-paths.mjs:49`.
  Flag-path strings are built ONLY in `scripts/flag-paths.mjs`.

## Hook pipeline (order matters)

All registered in `scripts/main.mjs`:
- `init` → `scripts/main.mjs:48`
- `pf1PostInit` → `scripts/main.mjs:161`
- `pf1PrepareBaseActorData` → `scripts/main.mjs:171`
- `pf1GetChangeFlat` → `scripts/main.mjs:177`
- `pf1PrepareDerivedActorData` → `scripts/main.mjs:183`
- `pf1RegisterDamageTypes` → `scripts/main.mjs:188`
- `setup` → `scripts/main.mjs:191`
- `preCreateActor` → `scripts/main.mjs:212`
- `pf1ActorRest` → `scripts/main.mjs:225`

## Technique item

- `TechniqueDataModel.defineSchema` → `scripts/data/technique-model.mjs:130`.
- `COMPLEXITY_TABLE` → `scripts/data/technique-model.mjs:17`.

## Flows

- `performTechnique(item, actionId, event)` → `scripts/use-technique.mjs:23`.
- Buff automation `findBuffByName(name)` → `scripts/automation/buff-application.mjs:270`.
- `buildLearnCheckBreakdown(...)` (shared by roll + tooltip) → `scripts/data/bonus-sources.mjs:44`.
````

- [ ] **Step 2: Verify each seeded line still matches the source**

Run:
```bash
grep -n "BUFF_TARGETS\s*=" scripts/flag-paths.mjs | head -1
grep -n "function performTechnique" scripts/use-technique.mjs | head -1
grep -n "NARUTO_SKILLS\s*=" scripts/data/skills.mjs | head -1
```
Expected: line numbers `49`, `23`, and `35` respectively (matching the cache). If any differ, fix the cache entry before committing.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pf1e-api-check/references/naruto-codemap.md
git commit -m "feat(skill): seed naruto-codemap cache with module anchors"
```

---

### Task 4: Correct `naruto-d20/CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (the naruto-d20 one at repo root) — "PF1e version pinning — IMPORTANT" section.

- [ ] **Step 1: Read the section to anchor the edits**

Run:
```bash
grep -n "Ground truth\|Primary API reference\|pf1e-api-verifier\|pf1e-api-check\|Known divergences" CLAUDE.md
```
Expected: shows the lines for the source table, the skill/subagent instruction, and the divergences note.

- [ ] **Step 2: Demote the built bundle from sole ground truth**

In the sources table, change the installed-system row. Replace:
```
| `/systems/pf1/pf1.js` + `lang/en.json` (installed system) | The bundle Foundry actually loads. | ✅ Ground truth. |
```
with:
```
| `foundryvtt-pathfinder1-v11.11/` (unbuilt source mirror, `system.json` = 11.11) | Clean per-module source for exactly the installed version. | ✅ **Ground truth** for API facts. |
| `/systems/pf1/pf1.js` (installed bundle) | The 5 MB bundle Foundry loads. | ⚠️ Runtime only — do not grep for API spec; read the source mirror instead. |
```

- [ ] **Step 3: Demote context7 from primary API reference**

Replace:
```
| context7 `/websites/foundryvtt_pathfinder1e_gitlab_io_foundryvtt-pathfinder1` | TypeDoc-generated API reference from the published docs site. Matches v11.11 class names (`pf1.components.ItemChange`, etc.). | ✅ Primary API reference. |
```
with:
```
| context7 `/websites/foundryvtt_pathfinder1e_gitlab_io_foundryvtt-pathfinder1` | TypeDoc API reference — tracks a branch **newer** than 11.11. | ⚠️ Concept/cookbook only, NOT an API spec. The source mirror wins on any conflict. |
```

- [ ] **Step 4: Point the instruction at the real skill, drop the missing subagent**

Replace:
```
**Before referencing any `pf1.*` global, `CONFIG.PF1.*` key, `system.*` field,
or `"PF1.*"` i18n key, invoke the `pf1e-api-check` skill (`.claude/skills/`)
to verify it exists in v11.11.** Or delegate to the `pf1e-api-verifier`
subagent (`.claude/agents/`) for batch verification.
```
with:
```
**Before referencing any `pf1.*` global, `CONFIG.PF1.*` key, `system.*` field,
or `"PF1.*"` i18n key, invoke the `pf1e-api-check` skill
(`.claude/skills/pf1e-api-check/`).** It checks its verified-api cache first and,
on a miss, reads the `foundryvtt-pathfinder1-v11.11/` source (never the built
`pf1.js`, never context7), then records the fact.
```

- [ ] **Step 5: Fix the divergences pointer**

Replace:
```
Known divergences are documented in the skill file. A few to keep in mind:
```
with:
```
Known divergences are seeded in `.claude/skills/pf1e-api-check/references/verified-api.md`
(and grow as facts are verified). A few to keep in mind:
```

- [ ] **Step 6: Verify the edits landed and no dangling references remain**

Run:
```bash
grep -n "Ground truth\|Concept/cookbook\|foundryvtt-pathfinder1-v11.11" CLAUDE.md
grep -c "pf1e-api-verifier" CLAUDE.md
```
Expected: ground-truth row now names the source mirror; context7 row says "Concept/cookbook"; `pf1e-api-verifier` count is `0`.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: name v11.11 source as API ground truth; wire real pf1e-api-check skill"
```

---

### Task 5: Align the parent `modules/CLAUDE.md`

**Files:**
- Modify: `../CLAUDE.md` (parent `modules/CLAUDE.md`) — "Documentation via Context7" section (lines 14–19).

- [ ] **Step 1: Confirm the section text**

Run:
```bash
grep -n "Documentation via Context7\|query Context7 MCP before reading source\|PF1 system API" ../CLAUDE.md
```
Expected: the heading at line 14, the instruction at line 16, and the PF1 library-ID bullet.

- [ ] **Step 2: Replace the section so PF1 API points at the source mirror**

Replace this block:
```
## Documentation via Context7

When working with Foundry or pf1 APIs, query Context7 MCP before reading source:

- **PF1 system API** — library ID `foundryvtt_pathfinder1e_gitlab_io_foundryvtt-pathfinder1`
- **Foundry VTT API v13** — library ID `foundryvtt_api_v13`
```
with:
```
## API references

- **PF1 system API (v11.11)** — ground truth is the unbuilt source mirror
  `modules/foundryvtt-pathfinder1-v11.11/` (exactly the installed version). In
  `naruto-d20`, use the `pf1e-api-check` skill, which reads it and caches facts.
  Do **not** treat context7 (`foundryvtt_pathfinder1e_gitlab_io_foundryvtt-pathfinder1`)
  as a v11.11 spec — it tracks a newer branch; use it for concepts/cookbook only.
- **Foundry VTT API v13** — context7 library ID `foundryvtt_api_v13` (core Foundry,
  still authoritative).
```

- [ ] **Step 3: Verify the edit landed**

Run:
```bash
grep -n "ground truth is the unbuilt source mirror\|API references" ../CLAUDE.md
grep -c "query Context7 MCP before reading source" ../CLAUDE.md
```
Expected: the new heading/line present; old instruction count is `0`.

- [ ] **Step 4: No commit (file is outside version control)**

`modules/CLAUDE.md` lives outside the naruto-d20 git repo and `modules/` is not a git
repo, so there is nothing to commit — the edited file is the deliverable. Do **not**
run `git add ../CLAUDE.md` (it errors: "outside repository"). The edit takes effect as
soon as the file is saved.

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm the skill tree is complete**

Run:
```bash
find .claude/skills/pf1e-api-check -type f | sort
```
Expected exactly:
```
.claude/skills/pf1e-api-check/SKILL.md
.claude/skills/pf1e-api-check/references/naruto-codemap.md
.claude/skills/pf1e-api-check/references/verified-api.md
```

- [ ] **Step 2: Cache-hit dry run (no source read needed)**

Pick a seeded fact (e.g. "what class is the PF1e character sheet?") and confirm it is
answerable from the cache alone:
```bash
grep -i "character-sheet\|ActorSheetPFCharacter" .claude/skills/pf1e-api-check/references/verified-api.md
```
Expected: the answer is present — a real session would stop here without opening any source file.

- [ ] **Step 3: Confirm CLAUDE.md no longer points at non-existent tooling**

Run:
```bash
grep -n "pf1e-api-verifier\|Primary API reference" CLAUDE.md || echo "clean: no stale references"
```
Expected: `clean: no stale references`.

- [ ] **Step 4: Final review of the full diff**

Run:
```bash
git log --oneline master..HEAD
git diff --stat master..HEAD
```
Expected: commits from Tasks 1–4; changed files are the three skill files + `CLAUDE.md` + the spec/plan docs.
