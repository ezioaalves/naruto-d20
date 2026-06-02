# Naruto D20: tarefas de refatoracao

Este backlog organiza o refactor do modulo em tarefas pequenas, pensadas para
PRs ou commits independentes por feature. A prioridade favorece risco de regra,
bug e fluxos mais usados em mesa: aprendizado, uso de tecnicas e Chakra tab.

Regra de trabalho para todas as tarefas:

- Manter PRs pequenos, com uma feature ou melhoria estrutural por vez.
- Preservar comportamento quando a regra estiver correta.
- Alterar comportamento quando houver inconsistencia de regra ou bug claro,
  registrando a mudanca no PR.
- Validar manualmente no Foundry VTT 13 com PF1e v11.11+.
- Evitar refactors amplos junto com alteracoes de pack.

## Ordem sugerida

1. Corrigir ou confirmar regra de Ninjutsu conditional.
2. Padronizar paths de flags de chakra e aprendizado.
3. Refatorar fluxo de uso de tecnicas.
4. Refatorar aprendizado de tecnicas.
5. Investigar performance do auto-add-buffs.
6. Refatorar auto-add-buffs.
7. Refatorar Chakra tab/listeners.
8. Unificar defaults de Technique e Medkit sync.
9. Extrair base comum dos browsers.
10. Migrar chat cards para templates.
11. Expandir i18n.
12. Formalizar weapon-attack techniques.
13. Criar QA manual por feature.

## Tarefa 1: alinhar regra de Ninjutsu conditional

Prioridade: alta  
Tipo: bug/regra  
Area: learn checks, chakra affinity
Status: concluida

Problema:

O README descreve o bonus condicional de Ninjutsu como dependente de afinidade
primaria, mas `scripts/data/derived-data.mjs` aplica
`learn.nin.conditional` por nivel sem checar afinidade. Isso pode ser regra
errada ou doc desatualizado.

Escopo:

- Confirmar a regra esperada.
- Ajustar `prepareDerivedActorData` se o bonus depender de
  `flags["naruto-d20"].chakra.nature.primary`.
- Atualizar a documentacao afetada.
- Garantir que o breakdown de learn check continue coerente.

Arquivos principais:

- `scripts/data/derived-data.mjs`
- `scripts/data/bonus-sources.mjs`
- `README.md`
- `docs/funcionalidades-e-melhorias.md`

Criterios de aceite:

- Ator sem afinidade primaria recebe ou nao recebe o bonus conforme regra
  definida.
- Ator com afinidade primaria recebe o bonus esperado por nivel.
- Tooltip e roll card exibem o valor correto.
- A documentacao nao contradiz o comportamento.

QA manual:

- Criar ou abrir ator de niveis 1, 5, 10 e 15.
- Testar Ninjutsu sem afinidade primaria.
- Definir afinidade primaria e recalcular a ficha.
- Rolar learn check de Ninjutsu e comparar tooltip/chat card.

## Tarefa 2: padronizar paths de flags

Prioridade: alta  
Tipo: mantenibilidade/risco de bug  
Area: chakra, aprendizado, actor flags
Status: concluida

Problema:

O projeto ja define builders em `scripts/flag-paths.mjs`, mas alguns pontos
ainda atualizam flags com strings diretas. Isso aumenta risco de typos e
divergencia de paths.

Escopo:

- Auditar updates em `flags.${MODULE_ID}`.
- Adicionar builders faltantes em `scripts/flag-paths.mjs`.
- Substituir strings diretas por imports de paths/builders.
- Evitar mudanca comportamental.

Arquivos principais:

- `scripts/flag-paths.mjs`
- `scripts/use-technique.mjs`
- `scripts/ui/tap-reserves.mjs`
- `scripts/data/chakra-conditions.mjs`
- `scripts/learn-technique.mjs`
- `scripts/main.mjs`

Criterios de aceite:

- Nenhum call site novo concatena paths de `naruto-d20` manualmente.
- Fluxos de chakra, Tap Reserves, aprendizado e condicoes continuam atualizando
  os mesmos campos.
- Busca por `flags.${MODULE_ID}` aponta apenas para builders, casos inevitaveis
  ou documentacao.

QA manual:

- Usar uma tecnica que gaste Temp, Pool e Reserve.
- Usar Tap Reserves com sucesso.
- Forcar Low Reserves e Chakra Depletion.
- Fazer uma tentativa de aprendizado e conferir flags no ator/item.

## Tarefa 3: refatorar fluxo de uso de tecnicas

Prioridade: alta  
Tipo: mantenibilidade/risco de bug  
Area: uso de tecnicas
Status: concluida

Problema:

`scripts/use-technique.mjs` concentra validacao, perform check, action use,
deducao de chakra, Emergency Transfer, condition update, chat card e
auto-add-buffs. Essa concentracao dificulta alterar regras sem regressao.

Escopo:

- Separar funcoes puras ou quase puras para:
  - validacao de ator/item/action;
  - verificacao de aprendizado;
  - perform check e auto-perform;
  - calculo de gasto de chakra;
  - aplicacao de gasto e condicoes;
  - chat card de sucesso/falha;
  - pos-uso e automacao de buff.
- Preservar a API publica `performTechnique(item, actionId, event)`.
- Manter o fluxo de weapon-attack techniques funcionando.

Arquivos principais:

- `scripts/use-technique.mjs`
- `scripts/ui/technique-weapon-attack.mjs`
- `scripts/automation/buff-application.mjs`

Criterios de aceite:

- `performTechnique` fica menor e orquestra helpers nomeados.
- Falha de perform nao gasta chakra.
- Sucesso gasta chakra depois da action PF1e bem-sucedida.
- Emergency Transfer continua funcionando.
- Buff automatico continua sendo chamado no fim do fluxo.

QA manual:

- Usar tecnica aprendida com auto-perform.
- Usar tecnica que exige roll de perform e falhar.
- Usar tecnica que exige roll de perform e passar.
- Usar tecnica com ataque/dano PF1e.
- Usar tecnica com weapon attack selecionado.
- Verificar gasto de Temp, Pool e Reserve.

## Tarefa 4: refatorar aprendizado de tecnicas

Prioridade: alta  
Tipo: mantenibilidade/risco de bug  
Area: aprendizado

Problema:

`scripts/learn-technique.mjs` mistura regra de aprendizado, custo de treino,
expiracao, Action Point, chat cards e context menu. E uma area usada com
frequencia e com alto risco de regressao.

Escopo:

- Separar regra de aprendizado em helpers:
  - target progress;
  - max attempts;
  - award por margem;
  - blocos de treino;
  - custo de chakra;
  - expiracao por interrupcao;
  - resolucao de tentativa.
- Separar fluxo de Action Point em bloco proprio.
- Preservar exports usados pela sheet/lista:
  - `attemptLearnTechnique`;
  - `buildLearningView`;
  - `isTechniqueEffectivelyLearned`;
  - `registerLearnCardContextMenu`.
- Evitar alterar regra junto do refactor, exceto bugs descobertos e
  documentados.

Arquivos principais:

- `scripts/learn-technique.mjs`
- `scripts/ui/technique-sheet.mjs`
- `scripts/ui/technique-list.mjs`
- `scripts/data/bonus-sources.mjs`

Criterios de aceite:

- Uma tentativa de aprendizado resolve igual antes para sucesso, falha,
  Failure Insight e run reset.
- Modo `standard` e `fourHourBlocks` continuam funcionando.
- Action Point reavalia a tentativa correta e nao duplica gasto.
- Treino interrompido por mais de 30 dias ainda reseta progresso.

QA manual:

- Aprender tecnica simples ate completar progresso.
- Falhar tentativas ate acumular Failure Insight.
- Testar limite de tentativas no modo standard.
- Testar modo `fourHourBlocks`.
- Usar Action Point no chat card.
- Testar `deductLearningChakra` ligado e desligado.

## Tarefa 5: investigar pausa no auto-add-buffs

Prioridade: alta  
Tipo: performance/diagnostico  
Area: uso de tecnicas, buffs

Problema:

Foi percebida uma pausa entre a rolagem, o card de auto-perform e a aplicacao
do buff quando tecnicas aplicam buffs automaticamente. O problema pode ser
influenciado por hardware, mas o fluxo atual faz lookup em compendio e pode
carregar documento durante o uso.

Escopo:

- Instrumentar temporariamente ou medir com logs controlados:
  - tempo de perform check;
  - tempo de `item.use`;
  - tempo de lookup de buff;
  - tempo de `pack.getIndex`;
  - tempo de `pack.getDocument`;
  - tempo de create/update do buff no alvo.
- Identificar se o gargalo e compendium index, document load, actor update,
  render da sheet ou canvas/Foundry.
- Remover logs temporarios antes do PR final, ou deixar debug atras de setting
  oculta se for util.

Arquivos principais:

- `scripts/use-technique.mjs`
- `scripts/automation/buff-application.mjs`
- `scripts/automation/buff-expiry.mjs`

Criterios de aceite:

- Ha uma conclusao clara do gargalo mais provavel.
- Existe uma proposta objetiva para reduzir a pausa, se confirmada no codigo.
- Nenhum log ruidoso fica ativo por padrao.

QA manual:

- Usar uma tecnica com buff automatico em ator proprio.
- Usar uma tecnica com buff automatico em alvo selecionado.
- Repetir a mesma tecnica duas vezes para comparar create vs refresh.
- Testar em mundo com o pack `technique-buffs` ja aberto e fechado.

## Tarefa 6: refatorar e otimizar auto-add-buffs

Prioridade: media-alta  
Tipo: performance/mantenibilidade  
Area: auto-add-buffs

Problema:

`buff-application.mjs` concentra busca, selecao de variante, resolucao de alvo,
duracao e apply/refresh. Alem disso, o lookup pode ser otimizado se a tarefa de
diagnostico confirmar custo perceptivel.

Escopo:

- Separar:
  - `findBuffByName`;
  - resolucao de pack/world item;
  - target resolution;
  - duration resolution;
  - apply/refresh.
- Considerar cache de index por pack durante a sessao.
- Invalidar cache ao usar reload manual, se uma UI futura depender disso, ou
  manter cache simples com fallback seguro.
- Preservar prioridade: compendios primeiro, world items depois.

Arquivos principais:

- `scripts/automation/buff-application.mjs`
- `scripts/use-technique.mjs`

Criterios de aceite:

- Reaplicar a mesma tecnica refresca buff existente.
- Variantes `Nome (...)` continuam sendo fallback.
- `targetMode` self/selected/auto continua igual.
- Duracao da action continua herdada quando aplicavel.
- Fluxo fica mais facil de testar manualmente e medir.

QA manual:

- Buff exato em `naruto-d20.technique-buffs`.
- Buff variante `Nome (...)`.
- Buff em custom compendium.
- Buff como world item.
- Sem alvo selecionado para tecnica de alvo.
- Alvo sem permissao.

## Tarefa 7: refatorar Chakra tab e listeners

Prioridade: media-alta  
Tipo: mantenibilidade  
Area: Chakra tab

Problema:

A Chakra tab e uma das areas mais usadas. `technique-list.mjs` concentra
filtros, drop zone, create, browse, open, use, learn, delete e duplicate.

Escopo:

- Separar listeners por responsabilidade:
  - filtros;
  - drop/create/duplicate/delete;
  - use/learn/open;
  - browser/medkit buttons.
- Manter o patch `_renderInner` em `render-patch.mjs`.
- Evitar mudar markup desnecessariamente.

Arquivos principais:

- `scripts/ui/render-patch.mjs`
- `scripts/ui/technique-list.mjs`
- `templates/actor/chakra-tab.hbs`

Criterios de aceite:

- A aba Chakra continua aparecendo antes do binding de tabs.
- Filtros funcionam igual.
- Drop de tecnica nao duplica item.
- Botoes por linha continuam funcionando.
- Create/Browse por rank continuam funcionando.

QA manual:

- Abrir actor sheet em character e npc.
- Alternar abas e confirmar que Chakra nao volta para Summary.
- Filtrar por disciplina.
- Dropar tecnica do compendio.
- Criar, duplicar e deletar tecnica.
- Usar e aprender tecnica pela lista.

## Tarefa 8: unificar defaults de Technique e Medkit sync

Prioridade: media-alta  
Tipo: mantenibilidade/risco silencioso  
Area: Technique model, Medkit

Problema:

`TechniqueDataModel.prepareBaseData()` e `automation/technique-sync.mjs`
mantem defaults semelhantes. Se o schema evoluir e o sync nao acompanhar, o
Medkit pode marcar tecnicas como out-of-date incorretamente.

Escopo:

- Extrair normalizacao/defaults compartilhados para um modulo de dados.
- Usar a mesma fonte na model e no sync quando possivel.
- Preservar tratamento especial do sync:
  - remover `_id`;
  - ignorar `learning`;
  - normalizar HTML;
  - ignorar `tag`.

Arquivos principais:

- `scripts/data/technique-model.mjs`
- `scripts/automation/technique-sync.mjs`

Criterios de aceite:

- Medkit nao marca tecnica identica como out-of-date por default ausente.
- Estado de aprendizado do ator continua preservado no sync.
- Mudancas reais em rank, custo, actions, changes ou descricao ainda aparecem
  como out-of-date.

QA manual:

- Abrir Medkit em ator com tecnicas atualizadas.
- Alterar uma tecnica no compendio e confirmar out-of-date.
- Sincronizar e confirmar up-to-date.
- Confirmar que `system.learning` nao foi resetado.

## Tarefa 9: extrair base comum dos browsers

Prioridade: media  
Tipo: mantenibilidade/performance preventiva  
Area: Technique Browser, Feat Browser

Problema:

Os browsers de tecnica e feat repetem padroes de busca, filtros, collapse,
reload, clear filters, foco pos-render e drag-start.

Escopo:

- Criar helper/base leve para:
  - debounce de busca;
  - sets de filtros;
  - toggle de grupos colapsaveis;
  - clear filters;
  - reload de index;
  - drag-start com UUID.
- Manter `Application` V1.
- Evitar abstracao pesada que dificulte ler cada browser.

Arquivos principais:

- `scripts/ui/technique-browser.mjs`
- `scripts/ui/feat-browser.mjs`
- `templates/apps/technique-browser.hbs`
- `templates/apps/feat-browser.hbs`

Criterios de aceite:

- Technique Browser preserva filtros por disciplina, rank, complexity,
  special e components.
- Feat Browser preserva filtros por subType, discipline e abilityType.
- Drag-and-drop continua funcionando.
- Busca mantem foco apos render.

QA manual:

- Abrir browser de tecnicas por rank.
- Buscar por nome.
- Combinar filtros.
- Limpar filtros.
- Usar reload.
- Arrastar tecnica para Chakra tab.
- Repetir fluxo equivalente no browser de feats.

## Tarefa 10: migrar chat cards para templates

Prioridade: media  
Tipo: mantenibilidade/i18n  
Area: chat UX

Problema:

Varios chat cards sao strings HTML inline. Isso dificulta consistencia visual,
i18n e manutencao.

Escopo:

- Criar templates Handlebars para:
  - perform success/failure;
  - learning result;
  - training interrupted;
  - chakra spend footer.
- Manter classes CSS existentes para nao quebrar estilo.
- Separar dados do card da renderizacao.

Arquivos principais:

- `scripts/use-technique.mjs`
- `scripts/learn-technique.mjs`
- `templates/`
- `styles/naruto-d20.css`

Criterios de aceite:

- Cards renderizam igual ou melhor que antes.
- Conteudo dinamico e escapado corretamente.
- Nenhum HTML inline complexo permanece nos fluxos principais.

QA manual:

- Auto-perform com sucesso.
- Perform roll falho.
- Learn success.
- Learn failure.
- Run reset.
- Training interrupted.
- Action Point aplicado.

## Tarefa 11: expandir i18n de strings hardcoded

Prioridade: media  
Tipo: qualidade/mantenibilidade  
Area: localizacao

Problema:

Ha notificacoes, titulos, labels e cards em ingles hardcoded. Isso afeta a
experiencia em PT-BR e dificulta ajustes de texto.

Escopo:

- Mapear strings hardcoded em codigo runtime.
- Migrar para `lang/en.json` e `lang/pt-BR.json`.
- Usar `game.i18n.localize` ou `game.i18n.format`.
- Evitar mudar texto de regras sem necessidade.

Arquivos principais:

- `lang/en.json`
- `lang/pt-BR.json`
- `scripts/use-technique.mjs`
- `scripts/learn-technique.mjs`
- `scripts/ui/tap-reserves.mjs`
- `scripts/ui/technique-list.mjs`
- `scripts/ui/technique-browser.mjs`
- `scripts/ui/feat-browser.mjs`

Criterios de aceite:

- Fluxos principais nao exibem strings hardcoded em ingles quando PT-BR esta
  ativo.
- Chaves novas seguem namespace `NarutoD20`.
- Mensagens com variaveis usam `game.i18n.format`.

QA manual:

- Alternar idioma do mundo para PT-BR.
- Testar notificacoes de erro em uso de tecnica.
- Testar aprendizado.
- Testar Tap Reserves.
- Abrir browsers e Medkit.

## Tarefa 12: formalizar weapon-attack techniques

Prioridade: media  
Tipo: robustez/documentacao  
Area: tecnicas com ataque de arma

Problema:

A configuracao `system.flags.dictionary.weaponAttack` e poderosa, mas pouco
descoberta e sem validacao explicita.

Escopo:

- Documentar formato aceito.
- Criar helper de parsing/validacao leve.
- Emitir warning util quando config e invalida.
- Preservar compatibilidade com formato nested e dotted.

Arquivos principais:

- `scripts/ui/technique-weapon-attack.mjs`
- `scripts/data/technique-model.mjs`
- `docs/funcionalidades-e-melhorias.md`

Criterios de aceite:

- Config valida continua funcionando.
- Config invalida nao quebra o uso da tecnica.
- Mensagem de erro aponta o campo problemático.
- Documento explica `mode`, `filter`, `attackBonus`, `damageBonus`, `held` e
  `charge`.

QA manual:

- Tecnica com melee weapon.
- Tecnica com ranged weapon.
- Tecnica com unarmed attack.
- Tecnica com `charge`.
- Tecnica sem arma valida equipada.
- Config malformada.

## Tarefa 13: criar QA manual por feature

Prioridade: media  
Tipo: qualidade/processo  
Area: release workflow

Problema:

Nao ha suite automatizada. A validacao depende de testes manuais, mas os passos
estao espalhados entre README, CLAUDE e docs individuais.

Escopo:

- Criar um documento de QA manual por feature.
- Incluir setup minimo do mundo de teste.
- Separar casos por:
  - Chakra;
  - Tap Reserves;
  - aprendizado;
  - uso de tecnicas;
  - auto-buffs;
  - Medkit;
  - browsers;
  - descanso;
  - compendios.

Arquivos principais:

- `docs/manual-qa.md`
- `README.md`
- `docs/funcionalidades-e-melhorias.md`

Criterios de aceite:

- Cada feature critica tem passos de verificacao.
- Passos indicam resultado esperado.
- O documento pode ser usado antes de release ou PR grande.

## Tarefas futuras opcionais

Estas tarefas devem vir depois das areas criticas, a menos que virem bloqueio:

- Criar scripts de validacao de JSON de tecnicas, feats e buffs.
- Adicionar cache compartilhado para indexes de compendio se a investigacao de
  performance justificar.
- Criar docs PT-BR equivalentes aos docs de feature em ingles.
- Avaliar testes automatizados leves para funcoes puras extraidas, se o ambiente
  permitir simular Foundry/PF1e sem custo alto.
