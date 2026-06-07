# Implementação de classes

Este documento descreve como criar, converter e manter itens `class` no
compêndio `naruto-d20.classes`. Ele se aplica a classes base, classes avançadas,
classes Paragon, classes de prestígio e conteúdo comunitário.

Os JSONs editáveis ficam em `packs/_source/classes/`. O diretório
`packs/classes/` é o LevelDB carregado pelo Foundry e deve ser gerado pelo CLI,
nunca editado manualmente.

## Modelo de dados

Uma classe é um item PF1e padrão com `type: "class"`. A estrutura mínima usada
no módulo é:

```jsonc
{
  "type": "class",
  "name": "Example Class",
  "_id": "ID_UNICO_DE_16_CARACTERES",
  "img": "systems/pf1/icons/feats/example.jpg",
  "folder": "ID_DA_PASTA_DO_COMPENDIO",
  "system": {
    "description": {
      "value": "<h2>Example Class</h2>...",
      "instructions": ""
    },
    "subType": "base",
    "level": 1,
    "hd": 8,
    "hp": null,
    "bab": "med",
    "skillsPerLevel": 4,
    "savingThrows": {
      "fort": { "value": "low" },
      "ref": { "value": "high" },
      "will": { "value": "low" }
    },
    "changes": [],
    "classSkills": {},
    "armorProf": [],
    "weaponProf": [],
    "links": {
      "children": [],
      "classAssociations": []
    },
    "customHD": "",
    "casting": { "type": "" },
    "sources": []
  },
  "_key": "!items!ID_UNICO_DE_16_CARACTERES"
}
```

Preserve também os blocos estruturais existentes no item usado como modelo,
como `changeFlags`, `contextNotes`, `flags`, `scriptCalls`, `fc`, `ownership` e
`_stats`. Ao copiar um item, gere novos IDs para o documento e para entradas de
`changes` ou `scriptCalls`.

## Tipo e pasta

`system.subType` controla fórmulas e comportamento nativo do PF1e:

| Subtype | Uso |
|---|---|
| `base` | Classes base, avançadas e Paragon tratadas como classes normais. |
| `prestige` | Classes de prestígio que usam as progressões PF1e de prestige. |
| `npc` | Classes exclusivas de NPC. |
| `racial` | Dados raciais tratados como classe. |
| `mythic` | Mythic paths; não concedem Hit Dice normais. |

Escolha a pasta pelo grupo editorial, não pelo subtype. As pastas atuais incluem
`Base Classes`, `Advanced Classes`, `Paragon Classes`, `Prestige Classes` e
`Community Compendium`. O campo `folder` recebe o `_id` do JSON da pasta.

Não deduza o subtype pelo nome da pasta. Por exemplo, confira o livro e a regra
da classe antes de decidir entre `base` e `prestige`.

## Nível, Hit Dice e HP

- `system.level` é o nível atual daquele item no ator. Sources reutilizáveis
  normalmente começam em `1`.
- `system.hd` é o tamanho do dado de vida: `6`, `8`, `10`, etc.
- `system.customHD` fica vazio quando a classe concede um Hit Die por nível.
  Use uma fórmula somente quando a classe possuir uma progressão especial de HD.
- Para novos sources, prefira `system.hp: null`. Assim, a configuração de saúde
  do mundo calcula HP automaticamente.
- Use HP numérico apenas quando a classe representar deliberadamente um estado
  já avançado com HP manual acumulado. Esse valor não é o tamanho do dado de
  vida.

Classes `mythic` usam `hd` como saúde por tier e têm regras próprias. Não copie
uma classe comum como base sem verificar o modelo PF1e.

## BAB

`system.bab` aceita `high`, `med`, `low` ou `custom`.

| Progressão | Fórmula normal do PF1e |
|---|---|
| `high` | `@hitDice` |
| `med` | `floor(@hitDice * 0.75)` |
| `low` | `floor(@hitDice * 0.5)` |

Com bônus fracionários ativados, o PF1e usa respectivamente `1`, `0.75` e `0.5`
por Hit Die e arredonda o total no ator.

Use:

```json
{
  "bab": "custom",
  "babFormula": "FORMULA"
}
```

somente quando nenhum preset reproduzir a tabela. Fórmulas de classe recebem
principalmente `@level` e `@hitDice`; não presuma que todo o roll data do ator
está disponível nessa fase.

## Saving throws

Cada entrada de `system.savingThrows` aceita `high`, `low` ou `custom`.

Nas regras normais, o PF1e usa:

| Subtype | Save `high` | Save `low` |
|---|---|---|
| `base` | `2 + floor(@hitDice / 2)` | `floor(@hitDice / 3)` |
| `prestige` | `floor((1 + @hitDice) / 2)` | `floor((1 + @hitDice) / 3)` |

Quando a tabela Naruto d20 não corresponde ao preset, use:

```json
"fort": {
  "value": "custom",
  "custom": "floor((2 * @level + 6) / 5)"
}
```

O PF1e também avalia fórmulas customizadas quando
`useFractionalBaseBonuses` está ativo. Portanto, teste a classe com essa opção
ligada e desligada, especialmente em personagens multiclasse.

Não mantenha uma propriedade `custom` esperando que ela seja usada quando
`value` é `high` ou `low`; o PF1e só seleciona a fórmula customizada com
`value: "custom"`.

## Skill points e class skills

`system.skillsPerLevel` guarda o valor base concedido pelo PF1e antes do
modificador de Inteligência. Na conversão dos livros Naruto d20, siga o padrão
já usado nas classes Ninja:

| Texto da classe | `system.skillsPerLevel` |
|---:|---:|
| 3 + Int | 2 |
| 5 + Int | 4 |
| 7 + Int | 6 |
| 9 + Int | 8 |

`system.classSkills` é um mapa `skillKey -> boolean`. O PF1e percorre esse mapa
e marca como class skill toda chave com valor `true`. Para skills PF1e, copie as
chaves de uma classe existente ou confirme a chave em `actor.system.skills`;
não invente abreviações.

As disciplinas canônicas adicionadas pelo módulo são:

| Disciplina | Chave |
|---|---|
| Chakra Control | `ckc` |
| Fuinjutsu | `fui` |
| Genjutsu | `gnj` |
| Ninjutsu | `nin` |
| Taijutsu | `tai` |

As chaves curtas são as que afetam efetivamente a ficha. Alguns sources antigos
contêm aliases descritivos ou resíduos como `newSkill`; não replique essas
chaves em conteúdo novo sem uma necessidade comprovada.

### Conversão de skills do D20 Modern

Os livros Naruto d20 usam a lista de skills do D20 Modern. Converta os nomes
para PF1e antes de preencher `system.classSkills`:

| D20 Modern | PF1e |
|---|---|
| Balance | Acrobatics |
| Bluff | Bluff |
| Climb | Climb |
| Concentration | Chakra Control |
| Craft | Craft, preservando as categorias descritas |
| Decipher Script | Linguistics |
| Demolitions | Disable Device e Craft (Explosives) |
| Diplomacy | Diplomacy |
| Disable Device | Disable Device |
| Disguise | Disguise |
| Drive | Ride |
| Escape Artist | Escape Artist |
| Forgery | Linguistics |
| Gamble | Profession (Gambler) ou Perform |
| Gather Information | Diplomacy ou Knowledge (Local) |
| Handle Animal | Handle Animal |
| Hide | Stealth |
| Intimidate | Intimidate |
| Investigate | Perception |
| Jump | Acrobatics |
| Knowledge (Ninja Lore) | Knowledge (Arcana) |
| Knowledge (Arcane Lore) | Knowledge (Arcana) |
| Knowledge (Art) | Knowledge (History) |
| Knowledge (Behavioral Sciences) | Sense Motive |
| Knowledge (Business) | Profession |
| Knowledge (Civics) | Knowledge (Nobility) |
| Knowledge (Current Events) | Knowledge (Local) |
| Knowledge (Earth and Life Sciences) | Knowledge (Nature) |
| Knowledge (History) | Knowledge (History) |
| Knowledge (Physical Sciences) | Knowledge (Engineering) |
| Knowledge (Popular Culture) | Knowledge (Local) |
| Knowledge (Shadowlands) | Knowledge (Dungeoneering) |
| Knowledge (Streetwise) | Knowledge (Local) |
| Knowledge (Tactics) | Knowledge (Arcana) |
| Listen | Perception |
| Move Silently | Stealth |
| Navigate | Survival |
| Perform | Perform |
| Pilot | Ride ou Profession |
| Profession | Profession |
| Read/Write Language | Linguistics |
| Repair | Craft |
| Research | Linguistics |
| Ride | Ride |
| Search | Perception |
| Sense Motive | Sense Motive |
| Sleight of Hand | Sleight of Hand |
| Speak Language | Linguistics |
| Spot | Perception |
| Survival | Survival |
| Swim | Swim |
| Treat Injury | Heal |
| Tumble | Acrobatics |
| Use Computer | Craft ou Knowledge (Engineering) |
| Use Rope | Escape Artist ou Survival |

Ao aplicar a tabela:

- Normalize singular, plural e erros tipográficos evidentes, como
  `Sleight of Hands`, antes da conversão.
- Trate `Read Language` como `Read/Write Language`.
- Quando a tabela oferece duas conversões unidas por `e` ou `ou`, marque ambas
  como class skills. Não escolha silenciosamente uma delas.
- Quando skills diferentes convergem para a mesma skill PF1e, registre apenas a
  chave PF1e resultante.
- Para `Knowledge (all skills)`, habilite somente as categorias PF1e alcançadas
  pelas conversões explícitas acima. Não marque toda skill de Knowledge do
  sistema.
- Categorias sem conversão definida, como `Knowledge (Theology and Philosophy)`
  ou `Knowledge (Technology)`, permanecem na descrição, mas não geram uma chave
  em `system.classSkills`.
- `Sign Language` também permanece apenas na descrição enquanto não houver uma
  decisão explícita de conversão.
- O atributo exibido no texto antigo não altera a skill PF1e. Por exemplo,
  `Spot (Int)` continua sendo convertido para Perception com o atributo definido
  pelo PF1e.
- Use as chaves canônicas do PF1e e do módulo, nunca nomes completos, aliases
  descritivos ou entradas `newSkill`.

## Proficiências

As proficiências ficam em:

```jsonc
{
  "armorProf": ["lgt", "med", "hvy"],
  "weaponProf": ["simple", "Nin Weapon"]
}
```

Valores comuns de armadura são `lgt`, `med` e `hvy`. As proficiências devem
refletir a regra escolhida para o compêndio, inclusive quando o livro apresenta
uma regra opcional. Não herde proficiências de outra classe apenas porque ela
possui HD ou BAB semelhante.

## Changes e recursos Naruto

Recursos de classe que alteram estatísticas são implementados em
`system.changes`. O bônus de Defesa do Naruto d20 normalmente usa o target
PF1e `ac`:

```json
{
  "type": "untyped",
  "_id": "ID_ALFANUMERICO",
  "operator": "add",
  "priority": 0,
  "target": "ac",
  "formula": "floor((@item.level + 1) / 2)"
}
```

As fórmulas de changes podem usar `@item.level`. Sempre calcule manualmente o
resultado em todos os níveis da tabela; fórmulas visualmente parecidas podem
produzir sequências diferentes.

O módulo registra targets extras para classes que concedem Chakra:

| Target | Efeito |
|---|---|
| `chakraPool` | Soma ao máximo da Chakra Pool. |
| `chakraReserve` | Soma ao máximo da Chakra Reserve. |

Exemplo:

```json
[
  {
    "type": "untyped",
    "_id": "POOLID01",
    "operator": "add",
    "priority": 0,
    "target": "chakraPool",
    "formula": "floor(@item.level / 2)"
  },
  {
    "type": "untyped",
    "_id": "RESERVE1",
    "operator": "add",
    "priority": 0,
    "target": "chakraReserve",
    "formula": "@item.level"
  }
]
```

Consulte [`pf1-buff-changes-reference.md`](pf1-buff-changes-reference.md) antes
de adicionar outros targets. Características sem suporte mecânico confiável
devem permanecer na descrição em vez de ganhar uma automação parcial.

## Features e associações

`system.links.classAssociations` pode conceder automaticamente feats ou class
features em níveis específicos:

```json
"classAssociations": [
  {
    "uuid": "Compendium.pf1.feats.Item.WKIVfdosc5SqYzmP",
    "level": 1
  }
]
```

O `uuid` deve apontar para um documento existente e `level` define quando ele é
concedido. Nos sources, deixe `flags.pf1.links.classAssociations` vazio. Esse
flag armazena os IDs dos itens concedidos no ator e é preenchido pelo PF1e
quando a classe cria as associações. A forma mais segura de criar associações
complexas é configurá-las na ficha da classe no Foundry, exportar com
`npm run unpack:classes` e revisar o diff.

Não crie associações para talentos escolhidos pelo jogador. Associe apenas
features fixas concedidas automaticamente pela tabela.

## Descrição, fontes e metadados

- `system.description.value` usa HTML e deve conter requisitos, informações da
  classe, tabela de níveis e características.
- `system.sources` registra livro e páginas. Deixe páginas desconhecidas como
  string vazia; não invente intervalos.
- `img` deve apontar para um asset existente do PF1e ou do módulo.
- `_id` deve ser único no pack e `_key` deve ser `!items!<ID>`.
- IDs de changes, script calls e componentes relacionados devem ser
  alfanuméricos.
- `system.casting.type` fica vazio para classes sem spellcasting PF1e. Antes de
  preencher casting, use uma classe oficial equivalente como referência e
  confirme os campos no PF1e v11.11.

## Escolha de um item-base

Use como modelo a classe mais próxima em comportamento:

| Caso | Referência |
|---|---|
| Classe base Naruto | `Strong_Ninja_4hLXlBfADg43MAZ0.json` |
| Classe curta tratada como base | `Fast_Paragon_4We55EJqStV6f09r.json` |
| Classe de prestígio com features e Chakra | `Deft_Skirmisher_wg52IybAOg9hHOmk.json` |

Copiar o item mais próximo reduz o risco de omitir campos, mas não torna os
valores copiados corretos. Revise individualmente subtype, HP, progressões,
skills, proficiências, changes, associações, fonte, IDs e pasta.

## Gerador de classes Markdown

[`generate-prestige-classes.pl`](../tools/generate-prestige-classes.pl) converte
um diretório de classes em Markdown para JSONs de classe. Ele foi criado para o
lote em `classes/prestige/`, mas aceita outros diretórios e destinos.

O gerador:

- extrai nome, HD, skill points, class skills e a tabela de progressão;
- converte a descrição Markdown completa para HTML;
- converte class skills usando as regras deste documento;
- identifica fórmulas conhecidas de BAB, saves, Defesa e Bonus Chakra;
- gera IDs determinísticos a partir do nome da classe;
- adiciona associações fixas configuradas no próprio script;
- falha quando uma progressão não corresponde a uma fórmula suportada.

O Markdown de entrada deve manter os cabeçalhos e tabelas usados pelas fontes
Naruto d20:

- um título `# Nome da classe`;
- texto `gains 1dN hit points`;
- lista iniciada por `class skills are as follows`;
- linha `Skill Points at Each Level`;
- tabela principal `## Table: The Nome da classe`, antes de `## Class Features`,
  com `Base Attack Bonus`, saves, `Defense Bonus` e `Reputation Bonus`;
- coluna `Chakra` na tabela principal quando a classe conceder bônus de chakra,
  usando o formato `Pool / Reserve` por nível, por exemplo `1 / 2` ou `- / +1`;
- não usar uma seção separada `### Bonus Chakra` em novos documentos; o gerador
  ainda aceita esse formato apenas como fallback para fontes antigas.

Na coluna `Special`, não liste `bonus chakra` quando a mesma linha já tiver
valor na coluna `Chakra`. O bônus é tratado como progressão mecânica da classe,
não como feature textual separada.

Para classes basic e paragon, que não têm seção `Requirements`, use:

- título `# Nome da classe`;
- seção `## Examples of ...`;
- seção `## Class Information` com bullets para `Ability`, `Hit Die`,
  `Action Points`, `Class Skills`, `Skill Points at First Level` e
  `Skill Points at Each Level`;
- tabela principal `## Table: The Nome da classe`;
- seção `## Starting Feats`;
- seção `## Class Features`, com talentos e listas de bonus feats em
  subtítulos `###`.

Antes de usar o gerador para um novo lote, revise no início do script:

| Configuração | Finalidade |
|---|---|
| `%fixed_ids` | IDs que precisam ser preservados em vez de gerados pelo nome. |
| `%icons` | Imagem específica de cada classe; ausências usam o livro roxo. |
| `%associations` | Feats fixos concedidos automaticamente e seus níveis. |
| `$template_path` | Item de classe usado como modelo estrutural. |
| `$folder_id` | Pasta editorial de destino no compêndio. |

O gerador lê a declaração `advanced class` ou `prestige class` do próprio
Markdown e falha quando ela não está presente. Não adicione bonus feats
escolhidos pelo jogador em `%associations`.

Primeiro valide a conversão sem escrever:

```sh
perl tools/generate-prestige-classes.pl --check
```

O comando retorna status diferente de zero se um JSON estiver ausente ou se a
saída gerada divergir do source existente. Para gerar ou atualizar os JSONs:

```sh
perl tools/generate-prestige-classes.pl
```

Para outro lote, informe os caminhos e a pasta explicitamente:

```sh
perl tools/generate-prestige-classes.pl \
  --source-dir classes/outro-lote \
  --output-dir packs/_source/classes \
  --template packs/_source/classes/classe-modelo-id.json \
  --folder-id id-da-pasta
```

Os IDs dependem do nome da classe; renomear um título cria outro ID e deve ser
tratado como migração ou registrado em `%fixed_ids`. Ownership, `_stats` e os
blocos estruturais são preservados do template. O script não remove JSONs
antigos nem decide proficiências. Depois da geração, revise manualmente subtype,
proficiências, sources, ícones, associações e todas as fórmulas antes de
reconstruir o pack.

## Fluxo de implementação

1. Transcreva a classe e identifique tabela, HD, BAB, saves, skill points,
   class skills, proficiências, Defesa, Chakra e features fixas.
2. Escolha um item-base com subtype e comportamento semelhantes.
3. Crie o JSON em `packs/_source/classes/` manualmente ou com o gerador.
4. Configure `folder`, `subType`, `level`, `hd`, `hp`, BAB, saves e skills.
5. Adicione changes e associações somente para mecânicas suportadas.
6. Compare os valores calculados em todos os níveis com a tabela original.
7. Valide a sintaxe de todos os JSONs de classe:

```sh
for file in packs/_source/classes/*.json; do
  jq -e . "$file" >/dev/null || exit 1
done
```

8. Rode a validação geral:

```sh
npm run validate:compendia
```

Atualmente esse comando valida techniques, feats e technique buffs, mas não faz
validação semântica completa de classes. O parse com `jq`, a revisão das
progressões e o pack continuam obrigatórios.

9. Pare o Foundry antes de reconstruir o LevelDB. Um Foundry aberto pode manter
   `packs/classes/` bloqueado e causar `LEVEL_ITERATOR_NOT_OPEN`.
10. Gere o pack:

```sh
npm run pack:classes
```

11. Revise `git diff --check`, `git status` e as mudanças em
    `packs/_source/classes/` e `packs/classes/`.

Use `npm run unpack:classes` somente para trazer ao source edições feitas no
Foundry. Esse comando sobrescreve os JSONs atuais; revise o diff imediatamente.

## QA manual

1. Abra `Naruto Classes` e confirme pasta, nome, imagem e descrição.
2. Arraste a classe para um ator de teste.
3. Aumente o item por todos os níveis definidos na tabela.
4. Em cada nível, compare BAB, Fort, Ref, Will, AC e Chakra.
5. Confirme HD, HP, skill points, class skills e proficiências.
6. Verifique features associadas exatamente nos níveis configurados.
7. Repita BAB e saves com `useFractionalBaseBonuses` ligado em um ator
   multiclasse.
8. Feche e reabra o mundo para confirmar que o LevelDB empacotado carrega sem
   erros de console.

## Referências

- [`packs/_source/classes/`](../packs/_source/classes/)
- [`compendium-source-packing.md`](compendium-source-packing.md)
- [`pf1-buff-changes-reference.md`](pf1-buff-changes-reference.md)
- [`CLAUDE.md`](../CLAUDE.md)
