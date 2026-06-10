# Ranks Temporários e Bônus de Rank (KOUSOKU / JOURYOKU)

## Context

NarutoD20 tem três formas de obter Speed/Strength Ranks:
- **Pago** (técnicas de treino) — já automatizado: buffs com flag `rankBuff`, custo/manutenção de chakra, benefícios via `pf1GetRollData` (`@item.speedRank.*` / `@item.strRank.*`).
- **Ranks Temporários** (ex.: bloodline Hiraishin) — benefícios completos, sem custo de chakra, **não stackam** com outros ranks (vale o maior), não podem ser suprimidos. *Não automatizado.*
- **Bônus de Rank** (ex.: Order of Fujin faz os ranks do Hiraishin stackarem) — **soma** ao rank efetivo, sem alterar custo, cap em 10. *Não automatizado.*

Objetivo: suporte genérico a grants `temp` e `bonus` para ambos os tipos de rank. Order of Fujin sem código específico de feat: o GM apenas muda o modo do grant de "Temporário" para "Bônus" no sheet do buff.

Fórmula: `efetivo = clamp(max(pago, maxTemp) + somaBonus − penalidades, 0, 10)` (penalidades de armadura/condições continuam só para KOUSOKU).

**Decisões do usuário:** configuração via seção injetada no sheet de buff do PF1e; Order of Fujin = troca manual temp→bonus; "rodadas grátis/dia" do Hiraishin fora do escopo; nível do grant lido do `system.level` nativo do buff.

## Fatos verificados (PF1e v11.11, bundle instalado + fonte não-buildada em `/home/joelfmjr/.foundrydata/Data/modules/foundryvtt-pathfinder1`, que está exatamente na tag `v11.11`)

1. `applyChanges` avalia cada `ItemChange` com o rolldata fresco do item dono (`getRollData({refresh:true})` → `Hooks.callAll("pf1GetRollData", ...)`). A injeção per-item atual é o ponto de alavanca correto.
2. Sheet de buff é `ItemSheetPF` (V1) → hook `renderItemSheetPF(app, html /*jQuery*/, data)`. `submitOnChange: true` persiste inputs nomeados automaticamente (merge parcial de flags).
3. `system.level` do buff é editável no header e vira `@item.level` no rolldata — seguro como nível do grant.
4. Só buffs com `system.active === true` contribuem changes — o carrier deve ser eleito entre os ativos.

## Problema-chave: dupla aplicação (carrier)

Um buff de grant (ex.: HIRAISHIN) carrega o **mesmo change set** do KOUSOKU para que os benefícios apliquem mesmo sem buff pago ativo. Quando pago + grant estão ativos juntos, as changes duplicariam. Solução: computar o rank efetivo do ator uma vez e, no hook per-item, eleger **um carrier determinístico** — o buff pago ativo de maior nível, senão o grant ativo de menor `item.id` — que recebe os valores reais no rolldata; os demais buffs do mesmo key recebem zeros.

## Implementação

### 1. `scripts/automation/rank-buffs.mjs` (modificar) — schema + helpers

Schema estendido (ausência de `grantType` ⇒ `"paid"`, **sem migração**):
```
flags["naruto-d20"].rankBuff = {
  key: "KOUSOKU" | "JOURYOKU",
  grantType?: "paid" | "temp" | "bonus",
  level?, cost?, interval?, sourceTechniqueId?   // só para paid
}
```
- Exportar `RANK_KEYS`, `RANK_GRANT_TYPES` e `RANK_BUFF_FLAG_PATH` (= `flags.${MODULE_ID}.${RANK_BUFF_FLAG}`; usar nos `name` dos inputs do template e em `buff-application.mjs` linhas ~310/322 que hoje montam a string inline).
- Normalizar `getRankBuffFlag(item)`: retornar `null` se `key` não estiver em `RANK_KEYS` (estado "None" do sheet, `key: ""`, vira buff comum sem precisar deletar flag).
- Novo `getRankGrantType(item)` → `flag ? (flag.grantType ?? "paid") : null`.
- Novo `rankGrantLevel(item)` → paid: `flag.level ?? system.level ?? 0`; temp/bonus: `system.level ?? 0`.
- `rankBuffFlagData(context)`: incluir `grantType: "paid"` explícito.

### 2. `scripts/automation/rank-effective-level.mjs` (criar) — computação pura

Mover para cá `STR_RANK_TABLE`, fórmulas de speed rank e `IMMOBILIZING_CONDITIONS`. Exportar:
- `computeEffectiveRank(actor, key, { rollData })` → `{ paid, temp, bonus, penalty, effective, carrierId }`:
  1. Coletar buffs ativos com `getRankBuffFlag(i)?.key === key`.
  2. paid = max dos paid; temp = max dos temp; bonus = soma dos bonus.
  3. Penalidades **só KOUSOKU**: condições (`helpless/paralyzed/grappled/pinned` → efetivo 0) e armadura via `rollData?.armor?.type` (−1 média, −3 pesada) — não chamar `actor.getRollData()`.
  4. `effective = Math.clamp(Math.max(paid, temp) + bonus − penalty, 0, 10)`.
  5. Carrier: paid ativo de maior nível; senão entrada ativa de menor `item.id` (`localeCompare` — determinístico entre clients).
- `speedRankValues(level)` e `strRankValues(level)` (mapeadores de tabela). **Atenção:** o fallback atual de str usa `carryMult: 1` — deve ser `0` para nível 0/ausente, senão o zero-set do não-carrier somaria +1 de carga (correção intencional de inconsistência pré-existente).

### 3. `scripts/automation/rank-rolldata.mjs` (criar) — hook consolidado; **deletar** `speed-rank-penalties.mjs` e `str-rank-bonuses.mjs`

```js
function _onGetRollData(item, data) {
  const flag = getRankBuffFlag(item);
  if (!flag || item.type !== "buff" || !item.actor) return;
  let level;
  if (!item.system?.active) {
    level = standaloneEffective(item, data); // preview no sheet: nível próprio − penalidades
  } else {
    const { effective, carrierId } = computeEffectiveRank(item.actor, flag.key, { rollData: data });
    level = item.id === carrierId ? effective : 0; // não-carrier zerado
  }
  if (flag.key === "KOUSOKU") data.item.speedRank = speedRankValues(level);
  else data.item.strRank = strRankValues(level);
}
```
Em `main.mjs`: trocar os dois imports/registros (linhas ~36-37 / ~198-199) por `registerRankRollData()`. Handover de carrier é automático na próxima preparação de dados quando o buff pago expira.

### 4. `scripts/automation/rank-buff-maintenance.mjs` (modificar) — manutenção só para paid

Único chokepoint: em `queueRankBuffMaintenance` (linha 18), trocar o gate para `if (getRankGrantType(item) !== "paid") return false;`. `buff-expiry.mjs` (gated em `sourceId`) e `use-technique.mjs` (keyed no nome da técnica) não precisam de mudança. "Não pode ser suprimido" não precisa de enforcement — temp não tem custo para lapsar; zeragem involuntária (paralisia) continua via penalidade.

### 5. `scripts/ui/rank-grant-config.mjs` + `templates/item/rank-grant-config.hbs` (criar) — UI no sheet de buff

- `registerRankGrantConfig()` em hook `renderItemSheetPF`; guard: `app.item.type === "buff"` e não injetado ainda (`html.find(".naruto-rank-grant").length`).
- Renderizar template e inserir na aba Details após o form-group de Category: `html.find('.tab.details select[name="system.subType"]').closest(".form-group").after(...)`. Usar classes nativas do PF1e (`form-group`, `form-header`) — sem CSS novo.
- Conteúdo (inputs nomeados a partir de `RANK_BUFF_FLAG_PATH` passado como data — nunca hardcodar `naruto-d20`):
  - Rank type: select `key` — `""` (None) / `KOUSOKU` / `JOURYOKU`.
  - Grant mode: select `grantType` — `temp` (default) / `bonus`. **`paid` nunca é oferecido.**
  - Hint: nível do grant vem do campo Level nativo do buff.
  - Buffs paid (gerenciados por técnica): seção **read-only** com aviso "Paid — managed by technique automation".
- Persistência grátis via `submitOnChange`. Em `main.mjs`: adicionar template ao `loadTemplates` e chamar `registerRankGrantConfig()` no `setup` [7].

### 6. `packs/_source/technique-buffs/` (criar 2 JSONs) — templates de grant

`SPEED_RANK_GRANT__<id>.json` / `STRENGTH_RANK_GRANT__<id>.json` (`_id` aleatório de 16 chars, `_key: "!items!<id>"`):
- Nomes "SPEED RANK GRANT" / "STRENGTH RANK GRANT" — não casam com o padrão `^([A-Z]+)\s+(JOURYOKU|KOUSOKU)\b`, logo nunca colidem com a automação de técnicas (idem renomeações como "HIRAISHIN").
- Cópia verbatim do `system.changes` do KOUSOKU/JOURYOKU; `system.level: 1`, `active: false`, `subType: "perm"`, duração infinita (`{ value: "", units: "" }`).
- `flags["naruto-d20"].rankBuff: { key, grantType: "temp" }` — sem level/cost/interval/sourceTechniqueId/sourceId.
- Descrição com instrução de uso (duplicar → renomear → setar Level → trocar para Bonus se stackar, ex. Order of Fujin).
- Rodar `npm run pack` (workflow em `docs/compendium-source-packing.md`).

### 7. `lang/en.json` + `lang/pt-BR.json` — i18n

Chaves: `NarutoD20.RankGrant.{Header, Type.Label, Type.None, Type.Speed, Type.Strength, Mode.Label, Mode.Temp, Mode.Bonus, Mode.Paid, LevelHint, PaidNotice}`.

## Sequência

1. Helpers em `rank-buffs.mjs` → 2. `rank-effective-level.mjs` → 3. `rank-rolldata.mjs` + deletar antigos + rewire `main.mjs` (**checkpoint: paridade com comportamento paid atual**) → 4. gate de manutenção → 5. UI do sheet + lang → 6. templates de compendium + pack → 7. seção de QA em `docs/manual-qa.md` (em português, seguindo o doc).

## Verificação (QA manual, nova seção em docs/manual-qa.md)

Baseline: SANDAN KOUSOKU sozinho → totais de AC/ataque/speed/skills idênticos a antes; diálogo de manutenção e free-use de mastery intactos.

1. **Temp sozinho**: duplicar SPEED RANK GRANT → "HIRAISHIN", level 2, ativar → benefícios rank 2 completos, sem custo, sem prompt de manutenção.
2. **Sem stacking (max)**: KOUSOKU pago 3 + HIRAISHIN temp 2 ativos → totais = pago 3 sozinho (sem dupla aplicação). Temp 4 + pago 1 → rank 4.
3. **Modo Bonus**: HIRAISHIN → Bonus → pago 3 + bonus 2 = rank 5; bonus 2 sozinho = rank 2; pago 10 + bonus 5 clampa em 10.
4. **Penalidades**: armadura média reduz tudo em 1 (só KOUSOKU); paralisado → KOUSOKU 0, JOURYOKU intacto.
5. **Handover de carrier**: pago + grant ativos, pago expira → valores do grant assumem na próxima preparação.
6. **Espelho JOURYOKU**: repetir 1-3 e 5 com STRENGTH RANK GRANT, incluindo capacidade de carga vinda de exatamente um buff.
7. **UI**: seção na aba Details; buff paid mostra aviso read-only; Rank Type "None" reverte a buff comum; editar Level no header muda o rank concedido.
8. **Regressão**: sheet de buff não-rank renderiza normal; console limpo no load e na preparação do ator.

Teste em browser: editar arquivos → `Ctrl+R` in-world (sem restart de Docker).
