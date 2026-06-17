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
- `init` → `scripts/main.mjs:54`
- `pf1PostInit` → `scripts/main.mjs:174`
- `pf1PrepareBaseActorData` → `scripts/main.mjs:184`
- `pf1GetChangeFlat` → `scripts/main.mjs:190`
- `pf1PrepareDerivedActorData` → `scripts/main.mjs:196`
- `pf1RegisterDamageTypes` → `scripts/main.mjs:201`
- `setup` → `scripts/main.mjs:204`
- `preCreateActor` → `scripts/main.mjs:226`
- `ready` → `scripts/main.mjs:239`
- `pf1ActorRest` → `scripts/main.mjs:244`

## Technique item

- `TechniqueDataModel.defineSchema` → `scripts/data/technique-model.mjs:133`
  (inclui o schema unificado `automation.maintenance`).
- `COMPLEXITY_TABLE` → `scripts/data/technique-model.mjs:20`.

## Flows

- `performTechnique(item, actionId, event)` → `scripts/use-technique.mjs:34`.
- Buff automation `findBuffByName(name)` → `scripts/automation/buff-application.mjs:315`.
- `buildLearnCheckBreakdown(...)` (shared by roll + tooltip) → `scripts/data/bonus-sources.mjs:44`.

## Turn maintenance (motor unificado, start-of-turn upkeep)

Subsistema introduzido em `f9f6075` (#118) — unifica stance/upkeep/rank no schema
`automation.maintenance`. Substitui os módulos removidos `stance-*` e
`rank-buff-maintenance`.

Dois modelos de buff de manutenção:
- **`model:"duration"`** — duração finita em rounds; upkeep cobrado por `chargeDurationUpkeep`
  via `updateCombat`; teardown por `updateItem` (reason="duration").
- **`model:"toggle"`** — duração permanente (`units:"perm"`); ativado/desativado por
  `runToggleMaintenance` via `updateCombat`; PF1e nunca expira automaticamente.
  Usado para stances de modo (CHAMPURU) e técnicas de upkeep sem duração finita.

- `registerTurnMaintenance()` (hook de start-of-turn) → `scripts/automation/turn-maintenance.mjs:22`.
- `runTurnUpkeep(actor, combat)` (trata duration e toggle) → `scripts/automation/turn-maintenance.mjs:100`.
- `runToggleMaintenance(actor, itemId)` (desativa + chama runMaintenance) → `scripts/automation/turn-maintenance.mjs:139`.
- `refreshMaintenanceBuff(actor, itemId, interval)` (model-aware) → `scripts/automation/turn-maintenance.mjs:560`.
- `MAINTENANCE_BUFF_FLAG` → `scripts/automation/maintenance-buffs.mjs:3`.
- `maintenanceFacets(item)` (resolver de facetas) → `scripts/automation/maintenance-buffs.mjs:45`.
- `maintenanceBuffDuration(interval)` (1-round, para duration-model) → `scripts/automation/maintenance-buffs.mjs:22`.
- `toggleMaintenanceBuffDuration()` (perm, para toggle-model) → `scripts/automation/maintenance-buffs.mjs:32`.
- `maintenanceBuffFlagData({..., model, startRound, interval})` → `scripts/automation/maintenance-buffs.mjs:99`.
  `model:"toggle"` stampa `{model, startRound, interval}`; `model:"duration"` stampa `{model, totalRounds, startRound, interval, lastUpkeepRound}`.
- `findMaintenanceBuffForTechnique(actor, techniqueId)` → `scripts/automation/maintenance-buffs.mjs:91`.
- `applyModeBuff(item, actor, modeId, interval)` (stance mode choice) → `scripts/automation/buff-application.mjs:95`.
- `applyUpkeepBuff(item, actor, interval, duration)` (HP/chakraDamage/element) → `scripts/automation/buff-application.mjs:144`.
- Element damage: `registerElementDamage()` → `scripts/automation/maintenance-element-damage.mjs:95`;
  `promptElements(item, count)` → `scripts/automation/maintenance-element-damage.mjs:38`.
- Migração de schema: `runMaintenanceMigrations()` → `scripts/data/maintenance-migration.mjs:111`;
  `MAINTENANCE_MIGRATION_VERSION` → `scripts/data/maintenance-migration.mjs:6`.

## Roll-time attack/damage bonuses that must NOT leak into CMB/CMD

Padrão: o target nativo `attack` é escrito em `system.attributes.attack.general` no
data-prep, e `cmb.total` inclui esse genAtk (`actor-pf.mjs:1405`), então qualquer bônus
de `attack` vaza para o CMB. A solução é um **target deferred customizado** que não mapeia
para nenhum dado do ator (logo nunca toca CMB/CMD/stat estático) e é injetado em roll-time
via `pf1PreAttackRoll`/`pf1PreDamageRoll`. Mecanismo PF1e detalhado em
`references/verified-api.md` → seção "Roll-time change injection".

- Helper compartilhado → `scripts/automation/rank-roll-injection.mjs`:
  `injectDeferredChanges(changes, actorChanges, sourceTarget, destTarget, {ablMult})` → `:22`;
  `isCombatManeuver(action)` (gate p/ excluir mcman/rcman) → `:63`;
  `resolveDeferredValue` / `changeValues` no mesmo arquivo. Pré-computa o valor e estampa
  `value` no change (applyChange daria 0 — sem changeOverride para o flat path).
- `strRankCombat` (Str-governed weapon attack + weapon damage) → `scripts/automation/strength-rank-combat.mjs:3`;
  `registerStrengthRankCombat()` → `:16`. Buffs JOURYOKU / STRENGTH RANK GRANT. (#132)
- `speedRankAttack` (todo ataque não-manobra) → `scripts/automation/speed-rank-attack.mjs:3`;
  `registerSpeedRankAttack()` → `:16`. Buffs KOUSOKU / SPEED RANK GRANT. (#134)
- `attackNoManeuver` (**genérico**: bônus de ataque fixo, qualquer buff, todo ataque
  não-manobra) → `scripts/automation/attack-no-maneuver.mjs:3`;
  `registerAttackNoManeuver()` → `:16`. Usado pelo buff CHAMPURU (Dexterity). (#135)
- Os três registram um hook `pf1PreAttackRoll` em `pf1PostInit` (`scripts/main.mjs`).
  Labels i18n em `NarutoD20.BuffTargets.{StrRankCombat,SpeedRankAttack,AttackNoManeuver}`.
