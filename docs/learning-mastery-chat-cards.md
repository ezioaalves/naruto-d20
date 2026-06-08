# Cards de chat de Learning / Mastery

Este documento descreve como os testes de **aprendizado** (learn) e **maestria** (mastery) de
técnicas montam o card de chat. Cada tentativa produz **um único card**: a rolagem do PF1e com as
informações de progresso anexadas logo abaixo, no estilo dos *footnotes* (property groups) dos testes
de perícia e do card de uso de técnica.

## Por que um único card

Antes existiam **dois cards** por tentativa:

1. O card da rolagem, criado por `pf1.dice.d20Roll(...)` (template `roll-ext.hbs` do PF1e).
2. Um card extra de progresso, criado por `postProgressionCard` (template `learning-result.hbs`).

Isso poluía o chat e separava a rolagem do seu resultado. Agora o resultado é **anexado ao card da
rolagem**, mantendo rolagem + progresso juntos.

## Descoberta que viabiliza a fusão

O template do PF1e `systems/pf1/templates/chat/roll-ext.hbs` já renderiza *property groups* no fim
do card:

```hbs
{{#each properties}}
{{> "systems/pf1/templates/chat/parts/item-notes.hbs" css=css cssExtra="general-notes" header=header notes=value}}
{{/each}}
```

Os testes de perícia nativos usam exatamente isso (`actor-pf.mjs`, `chatTemplateData.properties`).
O partial `item-notes.hbs` espera `notes` = array de `{ text, source? }`.

Como o resultado do progresso só é conhecido **depois** da rolagem (e `chatTemplateData` precisaria
ser passado antes dela), a estratégia é **renderizar os mesmos grupos `item-notes.hbs` e anexá-los
ao `content` da mensagem da rolagem já criada**. O resultado visual é idêntico aos footnotes nativos.

## O bloco de progresso

O bloco é embrulhado em um container sentinela para que reanexar seja idempotente:

```html
<div class="naruto-learn-progression {success|failed}">
  <!-- grupo "Info":  item-notes com o lead (ex.: "Learn check 28 vs DC 19. Success, +2 progress.") -->
  <!-- grupo "Training": item-notes com o footer dividido em tags (Progress 6/40, blocos, chakra) -->
</div>
```

O título da tentativa (ex.: "Learning <nome>") é **propositalmente omitido** do bloco: ele duplicaria
o *flavor* do próprio card da rolagem ("Learn: <nome>" / "Master: <nome>"), já exibido acima.

Funções em `scripts/data/training-progression.mjs`:

| Função | Papel |
|---|---|
| `renderProgressionBlock({ lead, footer, cssClass })` | Renderiza o bloco (grupos `item-notes.hbs`: `lead` vira o grupo **Info** = `PF1.InfoShort`; `footer` é quebrado por `"; "` no grupo **Training** = `NarutoD20.Cards.TrainingHeader`). O título é omitido (redundante com o flavor da rolagem). |
| `spliceProgressionBlock(currentContent, html)` | Remove qualquer bloco `.naruto-learn-progression` existente e concatena o novo → string idempotente. |
| `postProgressionCard(...)` | **Mantida** apenas para cards autônomos **sem rolagem** (ver abaixo). |

Estilos em `styles/chat/technique-cards.css` (`.naruto-learn-progression`), reaproveitando o visual
`.property-group` / `.tag-list` / `.tag` do PF1e.

## Fluxo (learning e mastery compartilham o motor)

O motor compartilhado é `scripts/data/training-progression.mjs`; os fluxos específicos são
`scripts/learn-technique.mjs` e `scripts/master-technique.mjs`.

1. `attemptLearnTechnique` / `attemptMasterTechnique` validam ator/estado/chakra e resolvem a perícia.
2. `rollLearnCheck` / `rollMasteryCheck` rolam com `pf1.dice.d20Roll(...)` (diálogo Take 10, roll
   mode etc.) → **card da rolagem** criado.
3. `resolveLearnAttempt` / `resolveMasterAttempt`:
   - computam o resultado (`buildLearnAttemptResult` / `buildMasteryAttemptResult`), debitam chakra,
     persistem `system.learning` / `system.mastery*`;
   - montam as partes do card via `buildLearnAttemptCardParts` / `buildMasterAttemptCardParts`
     (`{ title, lead, footer, cssClass }`, reusando as chaves `NarutoD20.Cards.Learn.*` / `Master.*`);
   - renderizam o bloco e **anexam ao card da rolagem** (`spliceProgressionBlock` +
     `rollMessage.update`), marcando-o como *rerollable* (`markNarutoRollRerollable`).

`resolveLearnAttempt` / `resolveMasterAttempt` aceitam `returnBlock: true` para **só retornar**
`{ html, result }` sem mexer na mensagem — usado pelos fluxos de reroll / Action Point, que combinam
o bloco com seu próprio conteúdo de comparação.

## Reroll e "Add Action Point"

Ambos operam **no próprio card da rolagem** (não há mais card secundário nem menu de contexto
secundário). Registrados por `registerProgressionRollReroll(source, config)`.

- **Reroll** (`getChatMessageContextOptions` → Keep New/Higher/Lower): `rerollMessage`
  (`scripts/chat-rerolls.mjs`) monta o `baseContent` (comparação das rolagens) e o passa para
  `applyReroll`. O handler de progressão re-resolve a tentativa (`returnBlock: true`) e **retorna a
  string final** `baseContent + bloco`; `rerollMessage` grava esse conteúdo. Handlers genéricos sem
  retorno (ex.: `shinobi-learn-check`) continuam usando só o `baseContent`.
- **Add Action Point** (`addActionPointToProgressionRoll`): rola 1d6, debita o AP, re-resolve com o
  total turbinado e grava `buildActionPointContent(...) + bloco` na mesma mensagem, marcando
  `actionPointApplied` para impedir novas alterações.

Helpers exportados de `scripts/chat-rerolls.mjs` para esses fluxos:
`buildRerollComparisonContent`, `buildActionPointContent`, `buildActionPointFlags`.

> Reroll/AP são **one-shot**: após aplicados, `flags.reroll.isReroll` / `actionPointApplied` impedem
> novas alterações no card (comportamento herdado de `canAlterNarutoRoll`).

## Cards autônomos (sem rolagem)

Tentativas com rolagem fundem tudo em um card. Fluxos **sem** rolagem continuam como card próprio via
`postProgressionCard` / `postLearningCard` / `postMasteryCard` (template `learning-result.hbs`):

- aprendizado via **Empathy** (`learnTechniqueViaEmpathy`);
- técnica de disciplina **não mapeada** (`learnUnmappedTechnique`);
- **treino interrompido** (>30 dias) (`expireInterruptedTraining` / `expireInterruptedMastery`).

## QA rápido

1. Learning normal (rank ≤ nível, perícia ≥ 1): **um** card com rolagem + Info/Training — sucesso e
   falha.
2. Reroll (botão direito → Keep New/Higher/Lower): card atualiza com a comparação **e** o progresso
   recalculado.
3. Add Action Point: card mostra rolagem + 1d6 e progresso atualizado; sem card duplicado; AP debitado.
4. Mastery (botão master numa técnica já aprendida): mesmo comportamento de 1–3.
5. Cards autônomos (Empathy / treino interrompido): permanecem como card próprio, inalterados.
6. Console do navegador sem erros.
