# Auto-add-buffs: diagnostico de performance

Este diagnostico cobre a pausa percebida entre o uso de uma tecnica e a
aplicacao automatica do buff.

## Fluxo atual

Depois que `performTechnique()` completa a action PF1e e gasta chakra, o modulo
chama `applyTechniqueBuff()` em `scripts/automation/buff-application.mjs`.

Antes da otimizacao da Tarefa 6, o caminho critico era:

1. `findBuffByName(item.name)`.
2. Para cada compendio configurado, `pack.getIndex()`.
3. Busca por match exato ou variante `Nome (...)` no index.
4. `pack.getDocument(_id)` para carregar o buff escolhido.
5. Resolucao de alvos.
6. `existing.update()` para refrescar buff existente ou
   `targetActor.createEmbeddedDocuments("Item", [itemData])` para criar novo buff.

## Conclusao do diagnostico

O gargalo mais provavel e o lookup em compendio durante o uso, especialmente em
primeiro uso ou com packs customizados:

- `findBuffByName()` chama `pack.getIndex()` em toda aplicacao automatica.
- O index do pack pode estar frio, entao o primeiro uso pode pagar o custo de
  carregar o index antes de achar o buff.
- Mesmo quando o index ja esta cacheado pelo Foundry, o fluxo ainda percorre
  todos os packs configurados a cada uso.
- `pack.getDocument()` tambem pode causar pausa no primeiro carregamento do
  documento do buff.
- `createEmbeddedDocuments()` e `existing.update()` podem causar render da sheet
  e atualizacao do ator, mas esse custo e esperado e so ocorre depois que o
  buff ja foi resolvido.

`scripts/automation/buff-expiry.mjs` nao participa do caminho critico do uso da
tecnica. Ele roda em resposta a expiracao natural de buffs ja existentes.

## Otimizacao aplicada na Tarefa 6

A Tarefa 6 aplicou a otimizacao mais objetiva do diagnostico:

- Mantem um cache de index por pack durante a sessao.
- Separa `findBuffByName`, resolucao de pack/world item, alvo, duracao e
  apply/refresh.
- Resolve matches exatos e variantes usando indexes cacheados.
- Carrega documento com `pack.getDocument()` apenas depois de escolher o match.
- Preserva prioridade por origem: compendios primeiro, world items depois.

Se ainda houver pausa apos cachear indexes, o proximo ponto a medir e
`pack.getDocument()` versus `createEmbeddedDocuments()`/`existing.update()` em
um mundo Foundry real.

## QA recomendado

- Usar uma tecnica com buff automatico em ator proprio.
- Repetir a mesma tecnica duas vezes e comparar primeiro uso versus reuso.
- Repetir com o pack `naruto-d20.technique-buffs` aberto e fechado.
- Repetir com um pack customizado configurado em `customBuffCompendia`.
- Comparar criar buff novo versus refrescar buff existente.
