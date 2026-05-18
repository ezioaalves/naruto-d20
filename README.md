# Naruto D20

Módulo para **Foundry VTT 13** que estende o sistema **Pathfinder 1e (pf1e v11.11+)** com mecânicas homebrew de Naruto D20: chakra, disciplinas ninja, técnicas como itens, afinidades elementais e integração nativa com o motor de bônus do pf1e.

Tudo é armazenado em flags de actor (`flags["naruto-d20"].*`), nunca em `system.*`, para evitar conflito com a evolução do pf1e. Técnicas são um tipo de item custom (`naruto-d20.technique`) com `TypeDataModel`.

---

## Compatibilidade

| | |
|---|---|
| Foundry VTT | mínimo 11, verificado em 13 |
| Sistema | `pf1` ≥ 11.11 |
| Build step | nenhum (ESM carregado direto pelo Foundry) |

Definido em [`module.json`](module.json).

---

## Instalação

1. Coloque o diretório `naruto-d20/` em `Data/modules/` do seu Foundry.
2. No mundo, ative o módulo em **Game Settings → Manage Modules**.
3. Recarregue o mundo (`F5` em página, `Ctrl+R` para reload de módulos).

---

## Funcionalidades

### 1. Recursos de Chakra (Pool e Reserve)

Cada Personagem (PC) e NPC ganha duas reservas de chakra:

- **Chakra Pool** — `max = 2 + ((2 + ConMod) × CharLevel) + bônus de buff`
- **Chakra Reserve** — `max = (2 × CharLevel) + bônus de buff`

Os máximos são recalculados em `pf1PrepareDerivedActorData`. O valor atual é editável e a sobra do gasto (quando o pool não cobre) vai para a reserve.

**Arquivos**: [`scripts/data/derived-data.mjs`](scripts/data/derived-data.mjs) (cálculo), [`scripts/flag-paths.mjs`](scripts/flag-paths.mjs) (paths), [`scripts/use-technique.mjs`](scripts/use-technique.mjs) (dedução).

### 2. Disciplinas / Learn Checks

Cinco disciplinas viram skills nativas do pf1e:

| Key | Disciplina        | Habilidade padrão |
|-----|-------------------|-------------------|
| ckc | Chakra Control    | Wisdom            |
| fui | Fuinjutsu         | Intelligence      |
| gnj | Genjutsu          | Charisma          |
| nin | Ninjutsu          | Intelligence      |
| tai | Taijutsu          | Strength          |

Fórmula do learn check: `CharLevel + AbilityMod + miscBonus + buffBonus + synergyBonus`. Quando o jogador tem rank ≥ 2, ganha +2 de synergy. Buffs do pf1e podem alvejar `learnCkc`, `learnGnj`, `learnNin`, `learnTai`, `learnFui`.

O roll usa `pf1.dice.d20Roll()` com parts rotulados (`5[Character Level]`, `3[Int]`, `2[Iron Will Buff]`…) — o chat card mostra cada fonte como linha separada. Os nomes individuais de buffs vêm de `actor.sourceInfo`.

**Arquivos**: [`scripts/data/skills.mjs`](scripts/data/skills.mjs) (NARUTO_SKILLS — fonte de verdade), [`scripts/data/derived-data.mjs`](scripts/data/derived-data.mjs) (cálculo), [`scripts/data/bonus-sources.mjs`](scripts/data/bonus-sources.mjs) (breakdown), [`scripts/ui/learn-checks.mjs`](scripts/ui/learn-checks.mjs) (roll + tooltip).

### 3. Tab Chakra na ficha de actor

Aba dedicada com:

- Status de Chakra Pool / Reserve (valor / max editável)
- Natureza primária e secundária (afinidade elemental)
- Estatísticas das 5 learn checks com tooltip (hover mostra breakdown)
- Lista de técnicas agrupadas por disciplina e rank, com filtros
- Drop zone para arrastar techniques do sidebar/compendium
- Botões open / use / delete por linha

A aba é injetada via patch em `ActorSheetPF.prototype._renderInner` — é a única forma confiável no pf1e atual, pois o hook `renderActorSheetPF` fira depois do bind de tabs, fazendo o usuário ricochetear para Summary.

**Arquivos**: [`scripts/ui/render-patch.mjs`](scripts/ui/render-patch.mjs) (injeção da tab), [`scripts/ui/technique-list.mjs`](scripts/ui/technique-list.mjs) (filtros/CRUD/drop), [`templates/actor/chakra-tab.hbs`](templates/actor/chakra-tab.hbs) (markup).

### 4. Bloco "Hero Statistics" na tab Summary

Insere um bloco compacto antes das Quick Actions com Action Points, Reputation e Wealth (todos editáveis inline).

**Arquivos**: [`scripts/ui/summary-stats.mjs`](scripts/ui/summary-stats.mjs), [`templates/actor/summary-stats.hbs`](templates/actor/summary-stats.hbs).

### 5. Tipo de item `Technique`

Item custom com seu próprio `TypeDataModel` e item sheet. Campos:

- **Identidade**: nome, imagem, descrição, summary, instruções
- **Classificação**: disciplina, subtype, rank (1-15), complexity (Extremely Easy → Epic)
- **Flags especiais**: Hijutsu (+1 success), Kinjutsu (+2 successes), Combination
- **Custo**: chakraCost, activation (standard/full/swift/immediate/free/ritual)
- **Range / target / area / duration / save** (campos textuais)
- **Componentes** (booleanos): Hand Seals, Half Seals, Concentration, Mobility, Focus, Empower, Mastery, Expendable, Physical, XP Cost
- **Stats derivados** (computados de rank + complexity, nunca armazenados): `learnDC`, `performDC`, `successes`, `skillThreshold`
- **Aba Advanced**: tags, flags (boolean + dictionary), showInQuickbar, showInCombat
- **Aba Links**: prerequisites, supplements, children (drag-drop entre itens)
- **Aba Changes**: array de Changes no padrão pf1e (target/operator/formula/type/priority)
- **Aba Script Calls**: scripts use/postUse com `pf1.components.ItemScriptCall`
- **Aba Actions**: array de ItemAction (mesmo schema do pf1e — ataques, dano, save, etc.)

A integração com o changes engine do pf1e é completa: techniques ativas (`active: true`) injetam suas changes nos totais do actor automaticamente.

**Arquivos**: [`scripts/data/technique-model.mjs`](scripts/data/technique-model.mjs) (schema + COMPLEXITY_TABLE), [`scripts/ui/technique-sheet.mjs`](scripts/ui/technique-sheet.mjs) (ItemSheet), [`templates/item/technique-sheet.hbs`](templates/item/technique-sheet.hbs) (markup).

### 6. Fluxo de uso de Technique

Ao clicar em "Use" numa technique:

1. Verifica chakra disponível (pool + reserve) ≥ chakraCost.
2. Se o actor tem ranks na skill da disciplina ≥ `skillThreshold` (derivado de rank + complexity): auto-perform.
3. Caso contrário: rola a skill da disciplina; sucesso se total ≥ `performDC`. Falha não consome chakra.
4. Em caso de sucesso, deduz o custo (pool primeiro, reserve cobre o excesso).
5. Posta chat card com o resultado e dispara a primeira action da technique (que pode incluir ataques, dano, scripts, etc.).

**Arquivos**: [`scripts/use-technique.mjs`](scripts/use-technique.mjs).

### 7. Tipos de dano elementais

Registra 4 tipos de dano novos no `pf1RegisterDamageTypes`:

| ID    | Nome  | Cor                               | Ícone                               |
|-------|-------|-----------------------------------|-------------------------------------|
| earth | Earth | <span>#8B5A2B</span>              | [`icons/earth.svg`](icons/earth.svg)|
| water | Water | <span>#1E90FF</span>              | [`icons/water.svg`](icons/water.svg)|
| wind  | Wind  | <span>#87CEEB</span>              | [`icons/wind.svg`](icons/wind.svg)  |
| holy  | Holy  | <span>#FFD700</span>              | [`icons/holy.svg`](icons/holy.svg)  |

Todos com `resist: true` (entram no seletor de Energy Resistance dos actors do pf1e).

**Arquivos**: [`scripts/data/damage-types.mjs`](scripts/data/damage-types.mjs).

### 8. Afinidade Elemental → Resistência Automática

Quando o actor tem natureza primária definida (Fire / Wind / Lightning / Earth / Water), ganha resistência ao elemento contra o qual sua afinidade é forte (rock-paper-scissors elemental):

- Fire → resiste a Wind
- Wind → resiste a Lightning
- Lightning → resiste a Earth
- Earth → resiste a Water
- Water → resiste a Fire

A resistência escala com nível: **5 no nível 10, 10 no 15, 15 no 20**. É escrita direto em `actor.system.traits.eres` para que o pf1e a aplique como qualquer outra resistência.

Ninjutsu também ganha um bônus condicional de `+1 por 5 níveis a partir do 1` (`learn.nin.conditional`) quando há afinidade primária.

**Arquivos**: [`scripts/data/derived-data.mjs`](scripts/data/derived-data.mjs) (função `_applyElementalResistance`).

### 9. Integração com o motor de Changes do pf1e

Sete buff targets ficam disponíveis no seletor de Changes dos itens pf1e, todos sob a categoria **Chakra**:

- `chakraPool` / `chakraReserve` (máximos)
- `learnCkc` / `learnGnj` / `learnNin` / `learnTai` / `learnFui` (bônus em learn check)

Buffs apontados para esses targets são escritos em flags via `pf1GetChangeFlat` e lidos em `pf1PrepareDerivedActorData`. Os nomes dos buffs aparecem individualmente no chat card do roll e no tooltip.

**Arquivos**: [`scripts/flag-paths.mjs`](scripts/flag-paths.mjs) (tabela `BUFF_TARGETS`), [`scripts/main.mjs`](scripts/main.mjs) (hooks `pf1GetChangeFlat` e `_registerBuffTargets`).

### 10. Migração de flags

Na primeira carga após upgrade do módulo, um GM logado dispara uma migração que adiciona campos novos a actors pré-existentes (controlada por `flagMigrationVersion`). Idempotente e silenciosa.

**Arquivos**: [`scripts/main.mjs`](scripts/main.mjs) (hook `ready` + `_migrateActorFlags`).

---

## Pipeline de Hooks

A ordem dos hooks é crítica porque o pf1e tem dependências fortes:

| # | Hook                          | Função                                                                          |
|---|-------------------------------|---------------------------------------------------------------------------------|
| 1 | `init`                        | Registra TechniqueDataModel, item sheet, templates, helper Handlebars, settings |
| 2 | `pf1PostInit`                 | Registra buff targets + skills + script call categories                         |
| 3 | `pf1PrepareBaseActorData`     | Reseta computed fields para 0 (changes engine escreverá em seguida)             |
| 4 | `pf1GetChangeFlat`            | Mapeia buff targets → flag paths                                                |
| 5 | `pf1PrepareDerivedActorData`  | Calcula totals finais (chakra max, learn totals, resistências)                  |
| 6 | `pf1RegisterDamageTypes`      | Registra Earth / Water / Wind / Holy                                            |
| 7 | `setup`                       | Instala patch no `_renderInner`, registra listeners de UI                       |
| 8 | `preCreateActor`              | Semeia flags em actors novos                                                    |
| 9 | `ready`                       | Migração one-shot de flags (GM apenas)                                          |

Orquestrado por [`scripts/main.mjs`](scripts/main.mjs).

---

## Árvore de fontes

```
scripts/
  main.mjs                    # Orquestrador de hooks
  constants.mjs               # MODULE_ID, TECHNIQUE_ITEM_TYPE, MAIN_DISCIPLINES
  flag-paths.mjs              # Builders de path + BUFF_TARGETS (fonte única)
  use-technique.mjs           # Dedução de chakra + perform check
  data/
    skills.mjs                # NARUTO_SKILLS (canônico), LEARN_KEYS, DISCIPLINE_SKILL_MAP
    derived-data.mjs          # prepareBase/Derived actor data
    technique-model.mjs       # TypeDataModel + COMPLEXITY_TABLE
    damage-types.mjs          # Earth / Water / Wind / Holy
    bonus-sources.mjs         # buildLearnCheckBreakdown — roll + tooltip
  ui/
    render-patch.mjs          # Wrap em _renderInner que injeta a Chakra tab
    learn-checks.mjs          # .shinobi-roll + tooltips
    technique-list.mjs        # Filtro / drop zone / CRUD da chakra tab
    technique-sheet.mjs       # ItemSheet das techniques
    summary-stats.mjs         # Bloco Hero Statistics no Summary
  utils/
    drag-drop.mjs             # resolveDroppedItem — shim TextEditor v12/v13
templates/
  actor/{chakra-tab,summary-stats}.hbs
  item/technique-sheet.hbs
styles/naruto-d20.css
lang/en.json
icons/{earth,water,wind,holy}.svg
module.json
```

Invariantes:
- `NARUTO_SKILLS` (em [`scripts/data/skills.mjs`](scripts/data/skills.mjs)) é o mapa canônico de chave → `{label, ability, discipline}`. Tudo mais deriva daí.
- `BUFF_TARGETS` (em [`scripts/flag-paths.mjs`](scripts/flag-paths.mjs)) é a fonte única de buff target → `{label, path, sort}`.
- Strings de flag path são construídas só em [`scripts/flag-paths.mjs`](scripts/flag-paths.mjs) — call-sites importam os builders, nunca concatenam `"naruto-d20"`.

---

## Desenvolvimento

Sem build step. Edite os `.mjs` / `.hbs` / `.css` e recarregue:

- **`F5`** — reload completo da página
- **`Ctrl+R`** com mundo aberto — reload mais leve que re-dispara os hooks de módulo

Se rodar Foundry em Docker com `foundrydata` bind-mounted, **não** reinicie o container — o bind-mount já pega as alterações de disco.

Para autocomplete de APIs do pf1e, mantenha o symlink `pf1/` → `../pf1-source` (referenciado por `jsconfig.json`).

---

## Documentação para Claude Code

Veja [`CLAUDE.md`](CLAUDE.md) para guidance que orienta agentes Claude trabalhando neste repo. Contém a justificativa para decisões não-óbvias (patch no `_renderInner`, escolha de `ItemSheet` legado em vez de DocumentSheetV2, etc.).

---

## Licença e créditos

Autor: Ezio Alves. Sistema Pathfinder 1e por Furyspark / pf1 Team. Naruto D20 é uma adaptação homebrew — todo material relacionado à franquia Naruto pertence a Masashi Kishimoto e Shueisha.
