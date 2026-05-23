# Botões de Criar e Browse no cabeçalho de Rank das técnicas

## Objetivo

Replicar, na aba **Chakra** (lista de técnicas), o comportamento dos dois botões que o pf1
exibe no cabeçalho de cada nível da aba de **Spells**:

- **`+` (Criar)** — cria um item direto na ficha do ator e abre a ficha dele para edição.
- **Pasta/livro (Browse)** — abre um compêndio de onde o item pode ser adicionado.

Antes desta mudança, técnicas só podiam ser adicionadas por drag-and-drop.

## Como o pf1 faz (referência)

Em `pf1/templates/actors/parts/actor-spellbook.hbs`, o cabeçalho de nível tem em `.item-controls`:

- `<a class="item-control item-create" data-create=… data-level=… data-book=…>` → handler
  `_onItemCreate` faz `Item.create` no ator e abre a ficha.
- `<a data-action="browse" data-source="spells.spell" data-level=…>` → abre
  `pf1.applications.compendiums.spells`.

**Limitação:** o Compendium Browser do pf1 seleciona packs/entradas por `handledTypes` (derivado
dos filtros de cada browser nativo). O tipo customizado `naruto-d20.technique` não é reconhecido
por nenhum browser nativo, então não é possível reusar `pf1.applications.compendiums.*` para
técnicas sem escrever um browser customizado.

## Decisões de design

- **Browse** → abre a **janela nativa do pack** `naruto-d20.techniques`
  (`game.packs.get(...).render(true)`). O usuário busca por nome e arrasta a técnica para a aba
  (a drop zone já existia em `technique-list.mjs`). Escolhido por ser simples e confiável, sem
  depender de internals compilados do pf1.
- **Posição dos botões** → no cabeçalho de **cada Rank**, espelhando a aba de Spells (que põe os
  botões na linha de cada nível).
  - Como uma aba vazia não tem cabeçalho de rank, o bloco de *empty-state* também recebe o par de
    botões, para que um ator novo consiga criar a primeira técnica / abrir o compêndio.

## Implementação

### `templates/actor/chakra-tab.hbs`

Os dois cabeçalhos de rank (grupo "All" e grupos por disciplina) tinham
`<div class="item-controls"></div>` vazio. Cada um agora contém:

```hbs
<div class="item-controls">
    <a class="technique-create item-control" data-tooltip="Create Technique" data-rank="{{rank}}"><i class="fa-solid fa-plus" inert></i></a>
    <a class="technique-browse item-control" data-tooltip="Browse Techniques"><i class="fa-solid fa-folder-plus" inert></i></a>
</div>
```

- `data-rank="{{rank}}"` — rank do grupo, usado como valor inicial da técnica criada.
- No cabeçalho dos grupos por disciplina, o botão de criar inclui `data-disc="{{../label}}"`
  (o `label` do tab é a disciplina, ex. "Ninjutsu"). No grupo "All" e no tab "Other" o handler
  valida o valor contra `MAIN_DISCIPLINES` e cai no default do modelo (`"Ninjutsu"`) se inválido.

O bloco de empty-state recebeu o mesmo par de botões, sem `data-rank` (→ rank 1 por default).

### `scripts/ui/technique-list.mjs`

Dois handlers novos em `registerTechniqueListListeners()`, escopados a `.tab.chakra` e seguindo o
padrão `.off("click").on("click", …)` já usado pelos demais botões da aba.

**Criar** — espelha o `_onItemCreate` do pf1:

```js
chakraTab.find(".technique-create").off("click").on("click", async (ev) => {
    ev.preventDefault();
    const ds = ev.currentTarget.dataset;
    const rank = Number(ds.rank) || 1;
    const system = { rank };
    if (ds.disc && MAIN_DISCIPLINES.includes(ds.disc)) system.discipline = ds.disc;
    const [item] = await app.actor.createEmbeddedDocuments("Item", [{
        type: TECHNIQUE_ITEM_TYPE,
        name: "New Technique",
        system,
    }]);
    item?.sheet?.render(true);
});
```

**Browse** — abre a janela do pack:

```js
chakraTab.find(".technique-browse").off("click").on("click", (ev) => {
    ev.preventDefault();
    const pack = game.packs.get(`${MODULE_ID}.techniques`);
    if (!pack) {
        ui.notifications.warn("Technique compendium not found.");
        return;
    }
    pack.render(true);
});
```

Import ajustado para trazer `MAIN_DISCIPLINES` e `MODULE_ID` de `../constants.mjs`.

## Notas

- O botão de browse usa a janela nativa do pack (sem filtro por rank), então todos os botões de
  browse abrem a mesma janela — `data-rank` não é usado no browse. Fiel o suficiente à intenção.
- Tooltips ficam hardcoded em inglês, igual ao restante de `chakra-tab.hbs` ("Open Sheet",
  "Remove"). Sem mudanças em `lang/`.
- Nenhuma mudança no `TechniqueDataModel`: `rank` (min 1) e `discipline` (default "Ninjutsu") já
  existiam.

## Verificação

Não há build (ESM carregado direto pelo Foundry). Recarregar com `Ctrl+R` no mundo ou `F5`.

1. Ficha **com** técnicas → cada cabeçalho de Rank mostra `+` e o ícone de pasta.
2. `+` no Rank 3 → cria "New Technique" rank 3 e abre a ficha. Em um grupo de disciplina
   (ex. Taijutsu), a técnica nasce com `discipline = Taijutsu`.
3. Botão de pasta → abre o compêndio "Naruto Techniques"; arrastar para a aba ainda funciona.
4. Ficha **sem** técnicas → empty-state mostra o par de botões; `+` cria rank 1 e abre.
5. Filtros de disciplina e use/open/delete por linha continuam funcionando (sem regressão).
