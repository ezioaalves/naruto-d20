# Buff Upkeep Flow

Reference note for the turn-start upkeep behavior introduced by the unified maintenance engine and extended by commit `ed481a478f5b48c09bdfb869d3afa32f7d40ebbf`.

## Core idea

Para buffs com `automation.maintenance`, o upkeep usa a expiração natural do próprio buff como gatilho.

Fluxo geral:

1. A técnica é usada com sucesso.
2. O módulo aplica um buff de manutenção com duração em rounds e `end: "turnStart"`.
3. No começo do próximo turno, o PF1e expira esse buff e define `system.active = false`.
4. O hook de manutenção intercepta essa mudança.
5. O módulo decide se o buff:
   - continua, cobrando custo e refrescando/reaplicando o buff;
   - troca de variante;
   - ou termina de vez.

Arquivos centrais:

- `scripts/automation/maintenance-buffs.mjs`
- `scripts/automation/buff-application.mjs`
- `scripts/automation/turn-maintenance.mjs`

## Important nuance

Sim, existe um momento real em que o buff fica inativo. Isso não é um toggle manual arbitrário; é o relógio da automação.

O engine usa este ciclo:

`turnStart -> PF1e expira -> updateItem -> runMaintenance -> custo/escolha -> refresh/reapply/delete`

## Runtime flow

### 1. Initial application

Quando `applyTechniqueBuff()` detecta `automation.maintenance`, ele desvia do fluxo normal de auto-buff e aplica um buff de manutenção:

- `choice === "mode"`: usa `applyModeBuff()`
- `resource === "hp"`: usa `applyUpkeepBuff()`
- `resource === "chakraDamage"`: usa `applyUpkeepBuff()`
- ranks com manutenção de chakra também entram no mesmo engine

Referências:

- `scripts/automation/buff-application.mjs:34`
- `scripts/automation/buff-application.mjs:92`
- `scripts/automation/buff-application.mjs:134`
- `scripts/automation/maintenance-buffs.mjs:22`

### 2. Expiry event

No começo do turno, o PF1e expira o buff e faz `system.active = false`.

O hook escuta exatamente isso:

- `options?.pf1?.reason === "duration"`
- `changed?.system?.active === false`

Referência:

- `scripts/automation/turn-maintenance.mjs:20`

### 3. Maintenance dispatch

`runMaintenance()` lê `flags.naruto-d20.maintenanceBuff.sourceTechniqueId`, encontra a técnica original e despacha por tipo:

- `hp` -> `maintainHpUpkeep()`
- `chakra` -> `maintainChakraUpkeep()`
- `chakraDamage` -> `maintainChakraDamageUpkeep()`
- sem custo, mas com escolha de modo -> `completeMaintenance()`

Referência:

- `scripts/automation/turn-maintenance.mjs:106`

### 4. Resolution

Depois de resolver custo e efeitos, o engine faz uma destas coisas:

- refresca o mesmo buff com `system.active = true`
- reaplica o buff de upkeep
- remove o buff antigo e aplica outra variante
- deleta o buff permanentemente

Referências:

- `scripts/automation/turn-maintenance.mjs:315`
- `scripts/automation/turn-maintenance.mjs:416`
- `scripts/automation/turn-maintenance.mjs:429`

## Technique timelines

## Champuru

Fonte de configuração:

- `packs/_source/techniques/CHAMPURU_DAICHI_SUTANSU__AYAUI_APPUKU__CHAMPURU_FIRST_STANCE__ERRATICALLY_OVERPOWER__hckDyKlm8TtdCYgG.json:51`

Configuração relevante:

- `maintenance.choice = "mode"`
- sem custo por rodada

Linha do tempo:

1. O uso da técnica chama `applyModeBuff()`.
2. O jogador escolhe `dex` ou `str`.
3. O módulo procura a variante de buff pelo nome, por exemplo `(... Dexterity)` ou `(... Strength)`.
4. O buff escolhido é aplicado no ator com flag de manutenção.
5. No começo do turno seguinte, o buff expira e fica inativo.
6. `runMaintenance()` chega em `completeMaintenance()`.
7. O módulo abre o prompt de manutenção para manter, trocar o modo ou encerrar.
8. Se trocar de modo, a variante antiga é removida e a nova é aplicada.
9. Se mantiver o mesmo modo, a variante é reaplicada/refrescada.
10. Se escolher `break` ou fechar o diálogo, o buff é deletado.

Resumo:

- Champuru realmente expira no começo do turno.
- A manutenção existe para decidir a variante ativa da stance.
- Troca de modo pode significar apagar um buff e aplicar outro.

Referências:

- `scripts/automation/buff-application.mjs:92`
- `scripts/automation/buff-application.mjs:115`
- `scripts/automation/turn-maintenance.mjs:325`

## Kai-Mon

Fonte de configuração:

- `packs/_source/techniques/KAI_MON_KAI__INITIAL_GATE_RELEASE__LK2D9Wq8YIgih9Ms.json:49`

Configuração relevante:

- `resource = "hp"`
- `cost = "2"`
- `policy = "forced"`

Linha do tempo:

1. O uso bem-sucedido aplica o buff de upkeep via `applyUpkeepBuff()`.
2. O buff recebe duração até `turnStart`.
3. No começo do turno, o PF1e expira o buff.
4. `runMaintenance()` chama `maintainHpUpkeep()`.
5. Como a política é `forced`, não há prompt.
6. O módulo calcula o custo de HP.
7. Se o custo derrubaria o ator abaixo de 1 HP, o buff termina.
8. Se o ator pode pagar, o HP é reduzido.
9. Em seguida, o buff é reaplicado para a próxima rodada.

Resumo:

- Kai-Mon expira e depois volta.
- O custo de HP acontece entre a expiração e a reativação.

Referências:

- `scripts/automation/buff-application.mjs:134`
- `scripts/automation/turn-maintenance.mjs:133`
- `scripts/data/hp-cost.mjs:17`

## Kyu-Mon

Fonte de configuração:

- `packs/_source/techniques/KYU_MON_KAI__HEAL_GATE_RELEASE__8PfCntX00bnLgvtE.json:49`

Configuração relevante:

- `resource = "chakraDamage"`
- `cost = "3 - floor(@mastery / 5)"`
- `heal = "2 + ceil(@mastery / 2)"`
- `clearConditions = "fatigued,exhausted"`

Linha do tempo:

1. O uso aplica o buff de upkeep via `applyUpkeepBuff()`.
2. No começo do turno, o buff expira.
3. `runMaintenance()` chama `maintainChakraDamageUpkeep()`.
4. A fórmula de chakra damage é rolada com `@mastery`.
5. O dano é absorvido primeiro por chakra temporário e depois pelo chakra pool.
6. O que não for absorvido vira dano em HP dobrado.
7. Se esse overflow mataria o ator, o gate acaba sem aplicar o dano letal.
8. Se continuar, `commitChakraDamage()` grava os novos valores.
9. Depois `applyTurnBenefits()` aplica cura e limpa `fatigued/exhausted`.
10. Por fim, o buff é reaplicado para a próxima rodada.

Resumo:

- Kyu-Mon também expira no começo do turno.
- A resolução da rodada inclui custo, benefícios e reaplicação do buff.

Referências:

- `scripts/automation/turn-maintenance.mjs:172`
- `scripts/automation/turn-maintenance.mjs:350`
- `scripts/data/chakra-damage.mjs:15`

## Sei-Mon

Commit que conectou essa técnica ao fluxo:

- `ed481a478f5b48c09bdfb869d3afa32f7d40ebbf`

Fonte da técnica:

- `packs/_source/techniques/SEI_MON_KAI__LIFE_GATE_RELEASE__rr5ej5Vyiy2U4q7w.json:49`

Fonte do buff:

- `packs/_source/technique-buffs/SEI_MON_KAI__LIFE_GATE_RELEASE__2e9f4c5b8d7a0132.json:1`

Configuração relevante:

- `resource = "hp"`
- `cost = "4 - floor(@mastery / 5)"`
- buff concede `temporaryChakra +8`

Linha do tempo:

1. O uso da técnica aplica o buff de upkeep.
2. Ao criar o buff, o módulo extrai o grant de `temporaryChakra`.
3. O ator recebe `+8` em `flags.naruto-d20.chakra.pool.temp`.
4. O buff guarda quanto desse grant ainda resta em `flags.naruto-d20.temporaryChakra.remaining`.
5. No começo do turno, o buff expira.
6. `maintainHpUpkeep()` cobra o HP automaticamente usando a fórmula com `@mastery`.
7. Se o ator pode pagar, o buff é reaplicado para a próxima rodada.
8. Quando o ator gasta chakra, o temp chakra é consumido antes do pool normal.
9. Quando o buff termina de vez, qualquer sobra de chakra temporário concedida por ele é removida.

Resumo:

- O comportamento base é o mesmo do Kai-Mon: expira, cobra custo, volta.
- O diferencial do commit foi rastrear corretamente o chakra temporário concedido pelo buff.

Referências:

- `scripts/automation/buff-application.mjs:20`
- `scripts/automation/buff-application.mjs:143`
- `scripts/automation/turn-maintenance.mjs:49`
- `scripts/data/chakra-spend.mjs:37`
- `scripts/data/chakra-damage.mjs:41`

## What "deactivate and reactivate" means here

Há três padrões reais no engine:

1. Expira e reativa o mesmo item
   - Kai-Mon
   - Kyu-Mon
   - ranks mantidos
2. Expira e troca por outra variante
   - Champuru quando muda entre `Dexterity` e `Strength`
3. Expira e termina de vez
   - falta de recurso
   - overflow letal bloqueado pelo guard
   - escolha do jogador de encerrar
   - fechamento de diálogo tratado como encerramento

## Practical conclusion

Se a percepção visual foi "o buff apaga e depois volta", ela está correta.

Mas o comportamento intencional é:

- a expiração no `turnStart` é o gatilho do upkeep;
- o módulo aproveita esse momento para cobrar custo e decidir continuidade;
- o buff só volta se a manutenção daquela rodada for validada.
