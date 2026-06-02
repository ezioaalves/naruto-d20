# Naruto D20: funcionalidades e melhorias

Este documento resume as principais funcionalidades implementadas no módulo
`naruto-d20`, como elas funcionam, quais arquivos concentram a lógica e quais
pontos de melhoria merecem atenção em ciclos futuros.

O módulo estende o Pathfinder 1e no Foundry VTT com regras de Naruto D20:
técnicas como itens próprios, chakra, disciplinas ninja, aprendizado,
automação de buffs e integrações com o motor nativo de actions/changes do PF1e.

Para validacao manual antes de release ou PR grande, use
`docs/manual-qa.md`.

## Visão geral da arquitetura

- Entrada principal: `scripts/main.mjs`.
- Runtime JavaScript: módulos ESM em `scripts/`.
- Dados de técnicas e compêndios: `packs/_source/` como fonte JSON e `packs/`
  como LevelDB runtime.
- Templates: `templates/`.
- Estilos: `styles/`, dividido por area de UI.
- Localização: `lang/en.json` e `lang/pt-BR.json`.
- Compatibilidade declarada: Foundry VTT mínimo 11, verificado em 13, PF1e
  mínimo 11.11.

O hook pipeline é central para a estabilidade do módulo:

- `init`: registra o tipo de item `naruto-d20.technique`, a sheet de técnica,
  templates e settings.
- `pf1PostInit`: registra buff targets, skills Naruto, patches de Technique DC,
  `@cl` em roll data e condições de chakra.
- `pf1PrepareBaseActorData`: inicializa flags e zera campos calculados antes do
  motor de changes do PF1e.
- `pf1GetChangeFlat`: mapeia buff targets para paths em flags.
- `pf1PrepareDerivedActorData`: calcula chakra, learn checks, resistências e
  totais finais.
- `pf1RegisterDamageTypes`: adiciona danos elementais.
- `setup`: instala patches/listeners de UI e automações.
- `preCreateActor`: inicializa flags simples em atores novos.
- `ready`: executa migrações idempotentes em atores e técnicas existentes.
- `pf1ActorRest`: recupera chakra no descanso.

Arquivos principais:

- `scripts/main.mjs`
- `scripts/constants.mjs`
- `scripts/flag-paths.mjs`
- `module.json`

## Chakra

### Pool, Reserve e Temp Chakra

Cada personagem ou NPC recebe dados de chakra em
`flags["naruto-d20"].chakra`:

- `pool.value`, `pool.max`, `pool.maxBonus`
- `pool.temp`
- `reserve.value`, `reserve.max`, `reserve.maxBonus`
- `nature.primary`, `nature.secondary`

O cálculo dos máximos acontece em `pf1PrepareDerivedActorData`:

- Chakra Pool: `2 + ((2 + ConMod) * nível) + pool.maxBonus`
- Chakra Reserve: `(2 * nível) + reserve.maxBonus`

`maxBonus` é escrito pelo motor de changes do PF1e via buff target. O valor
atual (`value`) é editável na ficha e preservado entre recalculações.

O Temp Chakra é usado principalmente pelo Tap Reserves. Ele é gasto antes do
Pool normal e é limpo em qualquer descanso.

Arquivos principais:

- `scripts/data/derived-data.mjs`
- `scripts/data/rest-recovery.mjs`
- `scripts/use-technique.mjs`
- `scripts/ui/tap-reserves.mjs`
- `scripts/flag-paths.mjs`
- `templates/actor/chakra-tab.hbs`
- `templates/actor/tap-reserves-dialog.hbs`

### Gasto de chakra ao usar técnicas

O fluxo de uso consome chakra apenas depois que a técnica passa pelo perform
check e a action PF1e é usada com sucesso.

Ordem de gasto:

- Temp Chakra
- Chakra Pool
- Chakra Reserve

Há uma regra de Emergency Transfer: se o Pool cairia para 0 enquanto ainda há
Reserve, a Reserve é zerada e o Pool volta para 1. Isso garante que Pool 0 só
ocorra quando a Reserve também acabou, ativando Chakra Depletion.

Arquivo principal:

- `scripts/use-technique.mjs`

### Tap Reserves

Tap Reserves abre um dialog próprio para converter Reserve em Temp Chakra.

Regra implementada:

- DC = `10 + quantidade tocada`
- Half seal reduz DC em 2.
- Hand seal reduz DC em 5.
- O roll usa o modificador de Chakra Control (`ckc`) com o mesmo breakdown dos
  learn checks.
- Em sucesso, a Reserve diminui e o Temp Chakra aumenta.
- Em falha, nada é alterado.

Arquivos principais:

- `scripts/ui/tap-reserves.mjs`
- `scripts/data/bonus-sources.mjs`
- `templates/actor/tap-reserves-dialog.hbs`

### Descanso

No hook `pf1ActorRest`, o módulo recupera chakra seguindo opções do descanso:

- Temp Chakra sempre é limpo.
- Pool volta ao máximo se `restoreDailyUses` não estiver desativado.
- Com Chakra Depletion ativo, Pool recupera apenas `floor(max / 4)`.
- Com Chakra Depletion e long-term care, Pool recupera `floor(max / 2)`.
- Reserve recupera `HD total`, limitada ao máximo, se `restoreHealth` não
  estiver desativado.

Arquivo principal:

- `scripts/data/rest-recovery.mjs`

### Condições de chakra

O módulo registra duas condições no registry do PF1e:

- `lowReserves`: Reserve maior que 0 e abaixo de 50%; implica `fatigued`.
- `chakraDepletion`: Reserve igual a 0; implica `exhausted`.

As condições são mutuamente exclusivas. O módulo rastreia se ele mesmo aplicou
`fatigued` ou `exhausted` antes de remover essas condições, evitando apagar
condições vindas de outras fontes.

Arquivos principais:

- `scripts/data/chakra-conditions.mjs`
- `scripts/constants.mjs`

### Afinidade elemental e resistência

A natureza primária do chakra gera resistência automática contra o elemento que
ela supera:

- Fire resiste Wind
- Wind resiste Lightning
- Lightning resiste Earth
- Earth resiste Water
- Water resiste Fire

A resistência escala por nível:

- Nível 10: 5
- Nível 15: 10
- Nível 20: 15

O valor é escrito em `actor.system.traits.eres` para o PF1e aplicar como uma
resistência normal.

Arquivo principal:

- `scripts/data/derived-data.mjs`

## Skills e aprendizado

### Disciplinas Naruto como skills PF1e

O módulo registra cinco skills de disciplina:

| Key | Disciplina | Habilidade padrão |
| --- | --- | --- |
| `ckc` | Chakra Control | Wisdom |
| `fui` | Fuinjutsu | Intelligence |
| `gnj` | Genjutsu | Charisma |
| `nin` | Ninjutsu | Intelligence |
| `tai` | Taijutsu | Strength |

As entradas são adicionadas em `actor.system.skills` sem sobrescrever ranks
existentes. A habilidade governante pode ser alterada na aba Skills do PF1e e é
lida dinamicamente.

Arquivos principais:

- `scripts/data/skills.mjs`
- `scripts/data/derived-data.mjs`
- `scripts/main.mjs`

### Learn checks

Cada learn check usa uma fórmula base:

`nível + ability mod + miscBonus + buffBonus + synergyBonus`

Detalhes:

- `miscBonus` é editável pelo usuário.
- `buffBonus` vem do motor de changes do PF1e.
- `synergyBonus` é +2 quando a skill tem pelo menos 2 ranks.
- Ninjutsu pode adicionar `learn.nin.conditional` em tentativas de aprendizado
  quando o ator tem natureza primária e a técnica corresponde a ela por
  `system.descriptors` ou `system.subtype`.
- O roll usa `pf1.dice.d20Roll()`, preservando dialog, roll mode, DC e formato
  de chat do PF1e.
- Tooltip e chat card usam a mesma fonte de breakdown.

Arquivos principais:

- `scripts/data/bonus-sources.mjs`
- `scripts/ui/learn-checks.mjs`
- `scripts/data/derived-data.mjs`

### Aprendizado de técnicas

Uma técnica possui estado de aprendizado em `item.system.learning`:

- `learned`
- `progress`
- `attemptsUsed`
- `failureInsight`
- `trainingBlocks`
- `chakraSpent`
- `lastTrainingAt`
- `actionPointBonus`

O uso de técnicas pode exigir aprendizado se a setting `enforceLearning`
estiver ativa.

Regras implementadas:

- Técnica não pode ser aprendida se o rank for maior que o nível do ator.
- Atores precisam de pelo menos 1 rank na skill correspondente.
- Progressão padrão usa a quantidade de `successes` derivada da técnica.
- Modo alternativo `fourHourBlocks` usa blocos de treino.
- Falhas acumulam `Failure Insight`, limitado a +5.
- Treino interrompido por mais de 30 dias perde progresso.
- `deductLearningChakra` permite cobrar chakra de treino.
- `learnMarginInclusive` controla limites de margem em torno de 5.

Arquivos principais:

- `scripts/learn-technique.mjs`
- `scripts/data/technique-model.mjs`
- `scripts/ui/technique-sheet.mjs`
- `scripts/ui/technique-list.mjs`

### Action Point no aprendizado

Após um learn roll elegível, o chat card pode oferecer a opção de contexto
`Add Action Point`.

O fluxo:

- Gasta 1 Action Point do ator.
- Rola `1d6`.
- Reavalia a tentativa original com o bônus.
- Reembolsa o chakra de treino da tentativa substituída antes de resolver a
  nova versão.
- Persiste o bônus pelo restante da run de aprendizado.

Arquivos principais:

- `scripts/learn-technique.mjs`
- `scripts/flag-paths.mjs`

## Técnicas

### Tipo de item `naruto-d20.technique`

Técnicas são um tipo de item custom registrado em `CONFIG.Item.dataModels` e
roteado por `ItemPF` para aproveitar actions, script calls e changes do PF1e.

Campos principais:

- Descrição, summary e instruções.
- Disciplina, subtype, rank, complexity e mastery.
- Descriptors e flags especiais: Hijutsu, Kinjutsu, Combination.
- Custo de chakra.
- Activation, range, target, area, duration e save.
- Componentes: hand seals, half seals, concentration, mobility, focus,
  empower, mastery, expendable, physical e XP cost.
- Links: prerequisites, supplements e children.
- Changes PF1e.
- Script calls PF1e.
- Actions PF1e.
- Automação de buff: enabled e targetMode.
- Learning state.

Arquivos principais:

- `scripts/data/technique-model.mjs`
- `scripts/ui/technique-sheet.mjs`
- `templates/item/technique-sheet.hbs`

### Derived stats de técnica

Stats derivados nunca são armazenados; são computados a partir de rank,
complexity, descriptors e mastery:

- `learnDC`
- `performDC`
- `successes`
- `skillThreshold`
- `masteryPerform`
- `masteryLevel`

Hijutsu aumenta successes em 1. Kinjutsu aumenta successes em 2. Combination
aumenta learn modifier em 5 e reduz successes em 2, respeitando mínimo 1.

Arquivo principal:

- `scripts/data/technique-model.mjs`

### Mastery e `@cl`

Mastery tem dois efeitos:

- Bônus de perform/threshold (`masteryPerform`).
- Offset de nível efetivo (`masteryLevel`).

O patch de roll data injeta `@cl` em actions de técnicas como:

`nível do personagem + masteryLevel`

Isso permite usar `@cl` em duração, dano, alcance e outras fórmulas de actions.

Arquivos principais:

- `scripts/data/technique-model.mjs`
- `scripts/data/technique-rolldata.mjs`

### Perform flow

Ao usar uma técnica:

- Confirma se o item está em um ator.
- Bloqueia uso se aprendizado for exigido e a técnica não estiver aprendida.
- Confirma action existente.
- Verifica chakra disponível.
- Se ranks efetivos alcançam `skillThreshold`, faz auto-perform.
- Caso contrário, rola a skill PF1e correspondente contra `performDC`.
- Falha não gasta chakra.
- Sucesso usa a action PF1e, depois deduz chakra.
- Ao final, pode aplicar buff automático.

Arquivos principais:

- `scripts/use-technique.mjs`
- `scripts/ui/technique-sheet.mjs`
- `scripts/ui/technique-list.mjs`

### Technique DC

Actions de técnicas têm DC próprio por patch em `ItemAction#getDC`.

Fórmula:

`10 + rank + ability mod + offset da action + rollData.dcBonus + bonus global + bonus da disciplina`

Os bônus de DC vêm de buff targets:

- `techDcAll`
- `techDcCkc`
- `techDcFui`
- `techDcGnj`
- `techDcNin`
- `techDcTai`

Arquivos principais:

- `scripts/data/technique-save-dc.mjs`
- `scripts/flag-paths.mjs`

### Técnicas que disparam ataque de arma

Uma técnica pode configurar, via `system.flags.dictionary.weaponAttack`, o uso
de um ataque de arma ou attack item selecionado no momento do uso. Quando a
config está presente e válida (`mode = selected`), o módulo ignora a action
própria da técnica, abre um seletor de ataque, injeta `@cl` e bônus temporários
no `ActionUse`, e chama `item.use()` do item de arma/ataque escolhido.

#### Formatos aceitos

A config é lida em dois formatos, com o objeto aninhado tendo precedência sobre
as chaves pontilhadas:

- Aninhado: `weaponAttack: { mode: "selected", filter: "meleeWeapon", ... }`
- Pontilhado: `"weaponAttack.mode": "selected"`, `"weaponAttack.filter": "meleeWeapon"`, ...

#### Campos suportados

| Campo | Valores | Default | Observação |
|---|---|---|---|
| `mode` | `selected` | — | Obrigatório. Único modo suportado hoje. Sem ele a config é ignorada. |
| `filter` | `meleeWeapon`, `rangedWeapon`, `meleeOrUnarmed`, `unarmedOnly` | `meleeWeapon` | Define quais armas/ataques entram no seletor. |
| `attackBonus` | fórmula de roll (string) | `""` | Empurrado em `actionUse.shared.attackBonus`. Ex.: `2[Nome da Técnica]`. |
| `damageBonus` | fórmula de roll (string) | `""` | Empurrado em `actionUse.shared.damageBonus`. |
| `held` | valor de `held` do pf1 | `""` | Passado como `options.held` para `item.use()`. |
| `charge` | `true` / `false` | `false` | `true` passa `options.charge = true` (investida). |

`filter`:
- `meleeWeapon` — armas equipadas, ações corpo a corpo.
- `rangedWeapon` — armas equipadas, ações à distância.
- `meleeOrUnarmed` — armas equipadas corpo a corpo **mais** attack items.
- `unarmedOnly` — apenas attack items (ataque desarmado, naturais).

#### Validação

`getTechniqueWeaponAttackConfig` valida a config de forma leve e nunca quebra o
uso da técnica — no pior caso ela é ignorada e a técnica usa sua própria action.
Um aviso (`ui.notifications.warn` + `console.warn`) aponta o campo problemático
quando:

- `weaponAttack` existe mas não é objeto nem usa chaves `weaponAttack.*`.
- há um campo desconhecido (ex.: `weaponAttack.filterr`).
- falta `mode`, ou `mode` não é `selected` (config ignorada).
- `filter` é inválido (cai para `meleeWeapon`).
- `charge` não é `"true"` nem `"false"`.

Técnicas sem nenhuma config `weaponAttack` seguem o fluxo normal, sem avisos.

Arquivo principal:

- `scripts/ui/technique-weapon-attack.mjs`

## Automação

### Auto-add-buffs

Após uma técnica ser performada com sucesso e gastar chakra, o módulo pode
procurar um buff com o mesmo nome e aplicá-lo automaticamente.

Condições:

- Setting `automaticBuffs` ativa.
- `item.system.automation.enabled` ativo.
- Setting `buffTargetFiltering` diferente de `off`.

Busca:

- Primeiro no pack `naruto-d20.technique-buffs`.
- Depois em packs listados por `customBuffCompendia`.
- Depois em world items do tipo `buff`.
- Dentro da prioridade de origem, match exato vence; variantes `Nome (...)` são
  fallback.
- Os indexes dos packs sao cacheados durante a sessao para evitar chamar
  `pack.getIndex()` a cada uso de tecnica.

Alvos:

- `targetMode = self`: aplica no usuário da técnica.
- `targetMode = selected`: aplica nos alvos selecionados no canvas.
- `targetMode = auto`: técnicas pessoais/stance/target `you` aplicam no usuário;
  as demais usam alvos selecionados.

Aplicação:

- Buff existente é identificado por `flags["naruto-d20"].sourceId`.
- Reaplicar refresca o buff em vez de duplicar.
- Duração pode ser herdada da action da técnica.

Diagnostico e otimizacao de performance:

- O diagnostico indicou lookup em compendio como gargalo mais provavel.
- A otimizacao implementada cacheia indexes por pack durante a sessao e separa
  lookup, resolucao de documento, alvo, duracao e apply/refresh.
- Detalhes em `docs/auto-add-buffs-performance.md`.

Arquivo principal:

- `scripts/automation/buff-application.mjs`

### Limpeza de buffs expirados

Quando o PF1e expira naturalmente um buff, ele normalmente desativa o item.
O módulo remove buffs criados pela automação para evitar acúmulo na ficha.

A limpeza só acontece quando:

- O update veio por duração (`options.pf1.reason === "duration"`).
- O item é buff.
- O buff tem `flags["naruto-d20"].sourceId`.

Arquivo principal:

- `scripts/automation/buff-expiry.mjs`

### Penalidade de defesa no charge

Quando uma action PF1e com ataque é usada com `charge`, o módulo cria ou
refresca um buff temporário de -2 AC até o começo do próximo turno.

Arquivo principal:

- `scripts/automation/charge-defense.mjs`

### Grants de feats

Quando um feat com `system.links.supplements` é removido de um ator, o módulo
remove em cascata os itens concedidos automaticamente que tenham
`flags.pf1.source` igual ao UUID listado no feat pai.

Arquivo principal:

- `scripts/automation/feat-grants.mjs`

## UI e experiência de uso

### Chakra tab

A ficha PF1e recebe uma aba Chakra com:

- Pool, Temp e Reserve.
- Natureza primária/secundária.
- Learn checks com tooltip de breakdown.
- Lista de técnicas por disciplina/rank.
- Filtros por disciplina.
- Drop zone para técnicas.
- Botões para abrir, usar, aprender, duplicar e excluir técnica.
- Botões de criar e navegar técnicas por rank.
- Botão de Medkit/sync.

A aba é injetada por patch em `_renderInner`, antes do binding de tabs do PF1e,
para evitar que a aba seja adicionada tarde demais.

Arquivos principais:

- `scripts/ui/render-patch.mjs`
- `scripts/ui/technique-list.mjs`
- `scripts/ui/learn-checks.mjs`
- `templates/actor/chakra-tab.hbs`

### Hero Statistics

A aba Summary recebe um bloco editável com:

- Action Points
- Reputation
- Wealth
- EPS

Arquivos principais:

- `scripts/ui/summary-stats.mjs`
- `templates/actor/summary-stats.hbs`

### Technique Browser

Browser custom de compêndio para técnicas, usando `Application` V1 para manter
visual consistente com PF1e.

Recursos:

- Busca por nome.
- Filtros por disciplina, rank, complexity, flags especiais e componentes.
- Grupos colapsáveis.
- Drag-and-drop para a Chakra tab.
- Pré-filtro por rank quando aberto pelo header de rank.

Arquivos principais:

- `scripts/ui/technique-browser.mjs`
- `templates/apps/technique-browser.hbs`

### Naruto Feat Browser

Browser custom para feats Naruto.

Recursos:

- Busca por nome.
- Filtros por tipo, disciplina e ability type.
- Drag-and-drop para a aba Features nativa do PF1e.
- Botão extra de browse inserido nos headers da aba Features.

Arquivos principais:

- `scripts/ui/feat-browser.mjs`
- `scripts/ui/feat-list.mjs`
- `templates/apps/feat-browser.hbs`

### Technique Medkit

O Medkit compara técnicas embedded no ator com suas versões de compêndio e
classifica cada uma como:

- Up to date
- Out of date
- Orphan

A comparação usa diff estrutural do `system`, normalizando defaults, HTML e
IDs internos. Ao sincronizar, preserva o estado de aprendizado da cópia do ator.

Arquivos principais:

- `scripts/ui/technique-medkit-app.mjs`
- `scripts/automation/technique-sync.mjs`
- `templates/actor/technique-medkit.hbs`

## Compêndios e dados

Packs declarados em `module.json`:

- `naruto-d20.techniques`
- `naruto-d20.technique-buffs`
- `naruto-d20.feats`
- `naruto-d20.classes`
- `naruto-d20.class-abilities`

Fonte editável:

- `packs/_source/techniques/`
- `packs/_source/feats/`
- `packs/_source/technique-buffs/`

Packs runtime:

- `packs/techniques/`
- `packs/feats/`
- `packs/technique-buffs/`

Comandos importantes:

- `npm run pack`
- `npm run unpack`
- `npm run add-actions -- --dry-run`
- `npm run fix-spell-attacks -- --dry-run`
- `npm run validate:compendia`

Arquivos e docs relacionados:

- `module.json`
- `package.json`
- `docs/compendium-source-packing.md`

## Integrações com PF1e

O módulo depende de várias integrações nativas do PF1e:

- `ItemPF` para actions, changes e script calls de técnicas.
- `pf1.dice.d20Roll()` para learn checks e Tap Reserves.
- `pf1GetChangeFlat` para buff targets.
- `CONFIG.PF1.buffTargets` e `CONFIG.PF1.buffTargetCategories`.
- `pf1.components.ItemAction#getDC` para DC de técnicas.
- `pf1.components.ItemAction#getRollData` para `@cl`.
- `pf1.registry.conditions` para condições custom.
- `pf1PostActionUse` para charge defense penalty.
- `pf1ActorRest` para recuperação de chakra.

Ao alterar qualquer API PF1e, `CONFIG.PF1`, global `pf1.*` ou path `system.*`,
verifique contra PF1e v11.11 instalado, conforme orientação em `CLAUDE.md`.

## Melhorias recomendadas

### Alta prioridade

- Atualizar o README para refletir features já implementadas que hoje aparecem
  melhor em `CLAUDE.md` e nos docs de feature: aprendizado, Tap Reserves,
  condições de chakra, Technique DC, browsers, medkit e weapon-attack
  techniques.
- Revisar a regra de `learn.nin.conditional` em `scripts/data/derived-data.mjs`.
  Concluído: o bônus só existe quando há afinidade primária e só entra no roll
  de aprendizado de técnicas Ninjutsu compatíveis com essa afinidade.
- Centralizar todos os updates de flags em builders de `scripts/flag-paths.mjs`.
  Alguns fluxos ainda usam strings diretas para paths de chakra/flags.
- Internacionalizar strings hardcoded em notificações, dialogs e cards de chat.
  Há mensagens em inglês diretamente em módulos como `use-technique.mjs`,
  `learn-technique.mjs`, `technique-list.mjs`, `tap-reserves.mjs` e browsers.

### Média prioridade

- Reduzir duplicação entre `TechniqueCompendiumBrowser` e `NarutoFeatBrowser`.
  Ambos têm busca, filtros, grupos colapsáveis, reload, clear filters,
  foco pós-render e drag-start.
- Reduzir duplicação de defaults de técnica entre
  `TechniqueDataModel.prepareBaseData()` e `automation/technique-sync.mjs`.
  O sync precisa espelhar defaults para diff correto; isso pode divergir com o
  tempo.
- Adicionar uma página curta de settings, com impacto de cada setting no fluxo
  de uso/aprendizado/automação.
- Padronizar cards de chat por helper/template, em vez de HTML inline em vários
  módulos.

### Baixa prioridade

- Avaliar se os browsers devem manter cache global por pack para reuso entre
  janelas, mantendo botão de reload para invalidação manual.
- Manter `docs/manual-qa.md` atualizado quando features criticas mudarem.
- Criar docs em português equivalentes aos principais docs ingleses, se o
  público principal do módulo continuar sendo PT-BR.

## Arquivos de referência rápida

| Área | Arquivos principais |
| --- | --- |
| Hook orchestration | `scripts/main.mjs` |
| Paths e buff targets | `scripts/flag-paths.mjs` |
| Chakra e derived data | `scripts/data/derived-data.mjs` |
| Descanso | `scripts/data/rest-recovery.mjs` |
| Condições de chakra | `scripts/data/chakra-conditions.mjs` |
| Skills | `scripts/data/skills.mjs` |
| Learn checks e aprendizado | `scripts/learn-technique.mjs`, `scripts/ui/learn-checks.mjs` |
| Técnica model | `scripts/data/technique-model.mjs` |
| Técnica sheet | `scripts/ui/technique-sheet.mjs`, `templates/item/technique-sheet.hbs` |
| Uso de técnica | `scripts/use-technique.mjs` |
| Technique DC e `@cl` | `scripts/data/technique-save-dc.mjs`, `scripts/data/technique-rolldata.mjs` |
| Auto buffs | `scripts/automation/buff-application.mjs` |
| Medkit/sync | `scripts/ui/technique-medkit-app.mjs`, `scripts/automation/technique-sync.mjs` |
| Browsers | `scripts/ui/technique-browser.mjs`, `scripts/ui/feat-browser.mjs` |
| Chakra tab | `scripts/ui/render-patch.mjs`, `scripts/ui/technique-list.mjs` |
| Summary stats | `scripts/ui/summary-stats.mjs` |
| Compêndios | `module.json`, `packs/_source/`, `packs/` |
