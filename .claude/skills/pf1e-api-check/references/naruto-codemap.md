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
