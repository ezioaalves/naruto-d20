# Naruto D20

Módulo para **Foundry VTT 13** que estende o sistema **Pathfinder 1e (pf1e v11.11+)** com
mecânicas homebrew de **Naruto D20**: chakra, disciplinas ninja, técnicas como itens,
afinidades elementais e integração nativa com o motor de bônus do pf1e.

O módulo não substitui o pf1e — ele soma camadas de regra ninja por cima de personagens e NPCs
existentes, aproveitando rolagens, buffs e fichas que você já conhece.

---

## Compatibilidade

| | |
|---|---|
| Foundry VTT | mínimo 11, verificado em 13 |
| Sistema | Pathfinder 1e (`pf1`) ≥ 11.11 |
| Instalação | sem etapa de build — pronto para ativar |

---

## Instalação

**Via manifest URL (recomendado):** no Foundry, **Add-on Modules → Install Module**, cole a URL
do manifest e instale — assim o Foundry detecta e aplica atualizações automaticamente:

```
https://github.com/ezioaalves/naruto-d20/releases/latest/download/module.json
```

**Manual:**

1. Baixe o `module.zip` da release e extraia o conteúdo em `Data/modules/naruto-d20/`.
2. No mundo, ative o módulo em **Game Settings → Manage Modules**.
3. Recarregue o mundo.

---

## Funcionalidades

### 1. Recursos de Chakra (Pool e Reserve)

Cada Personagem (PC) e NPC ganha duas reservas de chakra:

- **Chakra Pool** — `max = 2 + ((2 + ConMod) × CharLevel)`
- **Chakra Reserve** — `max = 2 × CharLevel`

Os máximos sobem com buffs e nível. O valor atual é editável; quando o gasto não cabe no pool,
a sobra é coberta automaticamente pela reserve.

### 2. Disciplinas / Learn Checks

Cinco disciplinas ninja viram skills nativas do pf1e:

| Disciplina        | Habilidade padrão |
|-------------------|-------------------|
| Chakra Control    | Wisdom            |
| Fuinjutsu         | Intelligence      |
| Genjutsu          | Charisma          |
| Ninjutsu          | Intelligence      |
| Taijutsu          | Strength          |

A base do learn check é `CharLevel + AbilityMod + bônus diversos + bônus de buff + sinergia`.
Com rank ≥ 2 na disciplina o personagem ganha +2 de sinergia. As rolagens usam o diálogo de
skill check nativo do pf1e (bônus situacional, DC, modo de rolagem, Take 10/20) e o chat card
mostra cada fonte do total em uma linha separada.

### 3. Aba Chakra na ficha de actor

Uma aba dedicada é adicionada à ficha, com:

- Status de Chakra Pool / Reserve (valor e máximo editáveis, com tooltip de origem dos bônus)
- Natureza primária e secundária (afinidade elemental)
- As 5 learn checks com tooltip de detalhamento ao passar o mouse
- Lista de técnicas agrupadas por disciplina e rank, com filtros
- Área para arrastar técnicas do sidebar ou de compêndios
- Botões de abrir / usar / aprender / duplicar / excluir por linha

### 4. Bloco "Hero Statistics" na aba Summary

Um bloco compacto antes das Quick Actions com **Action Points**, **Reputation** e **Wealth**,
todos editáveis inline.

### 5. Tipo de item `Technique`

Um item personalizado com ficha própria. Campos principais:

- **Identidade**: nome, imagem, descrição, resumo, instruções
- **Classificação**: disciplina, subtipo, rank (1–15), complexidade (Extremely Easy → Epic)
- **Flags especiais**: Hijutsu (+1 sucesso), Kinjutsu (+2 sucessos), Combination
- **Custo**: custo de chakra e ativação (standard / full / swift / immediate / free / ritual)
- **Range / alvo / área / duração / save**
- **Componentes**: Hand Seals, Half Seals, Concentration, Mobility, Focus, Empower, Mastery,
  Expendable, Physical, XP Cost
- **Stats derivados** (calculados a partir de rank + complexidade): DC para aprender, DC para
  executar, número de sucessos e o limiar de skill para auto-execução
- **Abas avançadas**: tags e flags, links (pré-requisitos, suplementos, técnicas filhas),
  changes no padrão pf1e, script calls e actions (ataques, dano, save etc.)

Técnicas ativas injetam suas *changes* nos totais do actor automaticamente, como qualquer buff
do pf1e.

### 6. Fluxo de uso de Technique

Ao usar uma técnica:

1. Verifica se há chakra suficiente (pool + reserve) para o custo.
2. Se o personagem tem ranks na disciplina ≥ o limiar da técnica, a execução é automática.
3. Caso contrário, rola a skill da disciplina; sucesso quando o total atinge o DC de execução.
   **Falha não consome chakra.**
4. Em caso de sucesso, deduz o custo (pool primeiro, reserve cobre o excedente).
5. Posta um chat card com o resultado e dispara a primeira action da técnica.

### 7. Aprendizado de técnicas

Progressão de aprendizado com acúmulo de sucessos, *Failure Insight*, blocos de treinamento e
gasto de Action Points — para evoluir uma técnica de "conhecida" a "dominada".

### 8. Tipos de dano elementais

Quatro novos tipos de dano entram no sistema (e no seletor de Energy Resistance dos actors):

| Nome  | Cor       |
|-------|-----------|
| Earth | `#8B5A2B` |
| Water | `#1E90FF` |
| Wind  | `#87CEEB` |
| Holy  | `#FFD700` |

### 9. Afinidade Elemental → Resistência Automática

Quando o actor tem natureza primária definida, ganha resistência ao elemento contra o qual sua
afinidade é forte (lógica pedra-papel-tesoura elemental):

- Fire → resiste a Wind
- Wind → resiste a Lightning
- Lightning → resiste a Earth
- Earth → resiste a Water
- Water → resiste a Fire

A resistência escala com nível (**5 no nível 10, 10 no 15, 15 no 20**) e é aplicada como
qualquer outra resistência do pf1e. Ninjutsu também ganha um bônus condicional ao aprender
técnicas alinhadas à natureza primária.

### 10. Automação de buffs

Em uma execução de técnica bem-sucedida, o módulo procura um buff de mesmo nome nos compêndios
configurados e o aplica/atualiza nos alvos, herdando a duração da técnica — sem empilhar
duplicatas em re-execuções. Controlável por configurações de mundo e por técnica.

### 11. Compêndios incluídos

O módulo já vem com compêndios de **Técnicas**, **Buffs de Técnica** e **Feats** prontos para
arrastar para a ficha.

### 12. Migração automática

Na primeira carga após uma atualização do módulo, um GM logado dispara uma migração idempotente
e silenciosa que adiciona campos novos a actors pré-existentes.

---

## Idiomas

Interface disponível em **Inglês** e **Português (Brasil)**.

---

## Releases

Cada versão publicada gera uma GitHub Release com `module.json` e `module.zip` (apenas os
artefatos de runtime). Uma nova versão é lançada empurrando uma tag de versão:

```bash
git tag v1.2.3
git push origin v1.2.3
```

O Foundry detecta atualizações automaticamente quando o módulo é instalado pela manifest URL.

---

## Contribuindo

Material para quem desenvolve ou faz QA está em [`docs/`](docs/) (checklist de QA,
empacotamento de compêndios, referência de buff changes) e nas convenções de
[`AGENTS.md`](AGENTS.md).

---

## Licença e créditos

Autores: **Ezio Alves** e **Joel Júnior**. Código licenciado sob **MIT** (veja
[`LICENSE`](LICENSE)). Sistema Pathfinder 1e por Furyspark / pf1 Team. Naruto D20 é uma
adaptação homebrew — todo material relacionado à franquia Naruto pertence a Masashi Kishimoto e
Shueisha.
