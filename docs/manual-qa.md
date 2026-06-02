# QA manual por feature

Este checklist consolida a verificacao manual do modulo antes de release, PR
grande ou alteracao de regra. O alvo de referencia e Foundry VTT 13 com PF1e
v11.11+.

## Setup minimo

1. Instale dependencias se for validar packs: `npm install`.
2. Se houve alteracao em `packs/_source/`, rode `npm run pack` antes de abrir o
   mundo.
3. Abra um mundo de teste com o modulo `naruto-d20` ativo e recarregue com `F5`.
4. Use um ator PC ou NPC com:
   - nivel conhecido, preferencialmente 5+;
   - Con mod positivo ou neutro;
   - pelo menos 1 rank em uma disciplina Naruto;
   - uma tecnica aprendida e uma tecnica nao aprendida;
   - uma arma melee equipada, uma ranged equipada e um attack item desarmado.
5. Deixe um segundo token selecionavel no canvas para testes com alvo.
6. Abra o console do navegador para conferir warnings/erros quando o caso pedir.

Resultado esperado geral: o mundo carrega sem erro de console bloqueante, a aba
Chakra aparece na ficha e os packs `Techniques`, `Technique Buffs` e `Naruto
Feats` abrem.

## Chakra

1. Abra a ficha do ator e confirme a aba Chakra.
   Resultado esperado: Pool, Temp, Reserve, natureza primaria/secundaria e learn
   checks aparecem sem quebrar o layout.

2. Altere nivel ou Con do ator e recalcule a ficha.
   Resultado esperado: `pool.max` e `reserve.max` seguem as formulas do README e
   os valores atuais nao sao apagados indevidamente.

3. Edite manualmente Pool, Temp e Reserve na aba Chakra.
   Resultado esperado: os valores persistem apos fechar e reabrir a ficha.

4. Defina Reserve abaixo de 50%, mas acima de 0, e force uma atualizacao de
   condicoes usando uma tecnica ou Tap Reserves.
   Resultado esperado: Low Reserves ativa e aplica `fatigued` quando foi o
   modulo que criou a condicao.

5. Zere a Reserve.
   Resultado esperado: Chakra Depletion ativa, Low Reserves sai e `exhausted`
   aparece.

6. Aplique `fatigued` manualmente, recupere Reserve acima de 50% e atualize as
   condicoes.
   Resultado esperado: o modulo nao remove uma condicao PF1e que ele nao
   aplicou.

## Tap Reserves

1. Abra Tap Reserves pela aba Chakra.
   Resultado esperado: o dialog abre com quantidade, selo e DC calculado.

2. Tente drenar 0.
   Resultado esperado: aparece warning e nenhum valor muda.

3. Tente drenar mais que a Reserve disponivel.
   Resultado esperado: aparece warning e nenhum valor muda.

4. Drene uma quantidade valida sem selo, com half seal e com hand seal.
   Resultado esperado: o roll usa Chakra Control, o DC muda por selo e o card
   indica Tap Reserves.

5. Force um sucesso.
   Resultado esperado: Reserve diminui, Temp aumenta e condicoes sao
   recalculadas.

6. Force uma falha.
   Resultado esperado: Reserve e Temp nao mudam.

## Aprendizado

1. Com `enforceLearning` ativo, tente usar uma tecnica nao aprendida.
   Resultado esperado: o uso e bloqueado com notificacao.

2. Tente aprender uma tecnica de rank maior que o nivel do ator.
   Resultado esperado: o modulo bloqueia a tentativa.

3. Tente aprender uma tecnica cuja disciplina nao tenha rank no ator.
   Resultado esperado: o modulo exige pelo menos 1 rank na skill correspondente.

4. Aprenda uma tecnica no modo `standard`.
   Resultado esperado: o chat mostra total vs DC, progresso, tentativas,
   blocos de treino e chakra de treino.

5. Falhe tentativas ate gerar Failure Insight.
   Resultado esperado: Failure Insight aumenta ate o limite esperado e entra no
   proximo calculo.

6. Esgote as tentativas de uma run.
   Resultado esperado: o progresso da run reseta e o card informa a perda.

7. Mude `learningProgressionMode` para `fourHourBlocks` e faca uma tentativa.
   Resultado esperado: o card usa contagem por blocos e o estado de aprendizado
   avanca no modo correto.

8. Ative `deductLearningChakra` e repita uma tentativa.
   Resultado esperado: Pool/Reserve sao cobrados quando houver chakra
   suficiente; sem chakra suficiente, a tentativa e bloqueada.

9. Use o menu de contexto do chat card para adicionar Action Point.
   Resultado esperado: 1 Action Point e gasto, rola `1d6`, a tentativa original
   e reavaliada uma unica vez e o gasto de chakra anterior e reembolsado antes
   da nova resolucao.

10. Simule interrupcao superior a 30 dias alterando `lastTrainingAt` para uma
    data antiga e tente aprender de novo.
    Resultado esperado: progresso, tentativas e Failure Insight sao resetados
    antes da nova tentativa.

## Uso de tecnicas

1. Use uma tecnica aprendida com ranks suficientes para auto-perform.
   Resultado esperado: a action PF1e roda, chakra e gasto depois do uso e o card
   informa auto-perform.

2. Use uma tecnica que exija perform roll e force falha.
   Resultado esperado: aparece card de falha e nenhum chakra e gasto.

3. Use uma tecnica que exija perform roll e force sucesso.
   Resultado esperado: a action PF1e roda, chakra e gasto e as condicoes sao
   atualizadas.

4. Use uma tecnica com ataque/dano PF1e normal.
   Resultado esperado: o dialog PF1e aparece quando a action tem ataque ou dano,
   e `@cl` resolve conforme nivel + mastery.

5. Use uma tecnica cujo custo excede Pool mas nao Pool + Reserve.
   Resultado esperado: gasta Temp primeiro, depois Pool e Reserve.

6. Use uma tecnica que acione Emergency Transfer.
   Resultado esperado: Pool termina em 1, Reserve em 0 e Chakra Depletion ativa.

7. Use uma tecnica `weaponAttack` com arma melee.
   Resultado esperado: abre seletor, mostra armas melee equipadas e aplica
   bonuses temporarios de ataque/dano configurados.

8. Repita com ranged, unarmed, `meleeOrUnarmed`, `held` e `charge`.
   Resultado esperado: filtros selecionam os ataques corretos; `charge` aplica a
   penalidade temporaria de defesa no fluxo PF1e.

9. Use uma tecnica com `weaponAttack` malformado em copia de teste.
   Resultado esperado: o uso nao quebra; aparece warning com o campo
   problematico e a tecnica cai no fallback documentado.

## Auto-buffs

1. Ative `automaticBuffs` e use uma tecnica com
   `item.system.automation.enabled`.
   Resultado esperado: o buff correspondente e aplicado apos o gasto de chakra.

2. Configure `targetMode = self`.
   Resultado esperado: o buff aparece no ator que usou a tecnica.

3. Configure `targetMode = selected`, selecione um token alvo e use a tecnica.
   Resultado esperado: o buff aparece no alvo selecionado.

4. Use `targetMode = selected` sem alvo.
   Resultado esperado: aparece warning e nenhum buff e aplicado.

5. Reaplique a mesma tecnica.
   Resultado esperado: o buff existente e refrescado, nao duplicado.

6. Teste um buff exato no pack `naruto-d20.technique-buffs`, um fallback
   `Nome (...)`, um buff em `customBuffCompendia` e um world item.
   Resultado esperado: a prioridade e pack do modulo, packs customizados e world
   items; match exato vence variantes.

7. Avance turnos ate expirar um buff criado pela automacao.
   Resultado esperado: o buff expirado e removido da ficha quando a expiracao
   veio por duracao PF1e.

## Synckit

1. Abra o Synckit pelo botao Sync Techniques na barra de titulo em um ator com tecnicas sincronizadas.
   Resultado esperado: tecnicas iguais ao compendio aparecem como Up to date.

2. Altere uma tecnica embedded no ator sem mudar aprendizado.
   Resultado esperado: o Synckit marca como Out of date.

3. Sincronize uma tecnica Out of date.
   Resultado esperado: dados de sistema voltam ao compendio e o estado de
   aprendizado do ator e preservado.

4. Teste uma tecnica que nao existe mais no compendio.
   Resultado esperado: ela aparece como Orphan e nao bloqueia o Synckit.

5. Use selecao em lote e sincronize multiplas tecnicas.
   Resultado esperado: apenas selecionadas sao atualizadas e o resumo informa a
   quantidade sincronizada.

6. Abra a aba Chakra e use o campo de busca no header de Techniques.
   Resultado esperado: a lista filtra tecnicas por nome em tempo real e limpar
   o campo restaura todos os resultados.

## Browsers

1. Abra o Technique Browser pela aba Chakra.
   Resultado esperado: a janela abre com layout PF1e, busca, filtros e grupos.

2. Abra pelo header de um rank especifico.
   Resultado esperado: o browser inicia filtrado pelo rank clicado.

3. Use busca por nome, filtro por disciplina, rank, complexity, componentes e
   flags especiais.
   Resultado esperado: a lista atualiza sem perder foco de busca e sem erro de
   console.

4. Colapse e expanda grupos, limpe filtros e recarregue o browser.
   Resultado esperado: estado visual responde corretamente e a lista volta ao
   conjunto esperado.

5. Arraste uma tecnica do browser para a aba Chakra.
   Resultado esperado: uma unica copia e criada no ator.

6. Abra o Naruto Feat Browser pela aba Features.
   Resultado esperado: busca/filtros funcionam e drag-and-drop cria o feat no
   ator.

## Descanso

1. Com Temp Chakra acima de 0, faca qualquer descanso.
   Resultado esperado: Temp volta para 0.

2. Sem Chakra Depletion, faca descanso com `restoreDailyUses` ativo.
   Resultado esperado: Pool volta ao maximo.

3. Com `restoreDailyUses` desativado.
   Resultado esperado: Pool nao e restaurado pelo modulo.

4. Com Reserve abaixo do maximo, faca descanso com `restoreHealth` ativo.
   Resultado esperado: Reserve recupera ate `HD total`, limitada ao maximo.

5. Com Chakra Depletion ativo, faca descanso normal.
   Resultado esperado: Pool recupera apenas `floor(max / 4)`.

6. Com Chakra Depletion ativo e long-term care.
   Resultado esperado: Pool recupera `floor(max / 2)`.

7. Apos descanso que recupere Reserve para 50% ou mais.
   Resultado esperado: Low Reserves/Chakra Depletion saem e condicoes PF1e
   aplicadas pelo modulo sao removidas.

## Compendios

1. Abra os packs `naruto-d20.techniques`, `naruto-d20.technique-buffs` e
   `naruto-d20.feats`.
   Resultado esperado: todos carregam sem erro.

2. Se editou `packs/_source/techniques`, rode `npm run pack`, recarregue o
   mundo e abra a tecnica alterada no compendio.
   Resultado esperado: o compendio runtime reflete a fonte JSON.

3. Antes de um transform de compendio, rode o comando com `--dry-run`.
   Resultado esperado: o resumo mostra apenas mudancas esperadas.

4. Depois do transform, revise `git diff` em `packs/_source/` antes de rodar
   `npm run pack`.
   Resultado esperado: somente arquivos/fields pretendidos mudaram.

5. Use uma tecnica recem empacotada no ator.
   Resultado esperado: actions, saves, dano, `weaponAttack`, automacao e links
   carregam como no JSON fonte.

## Sweep final de release

1. Alterne o idioma do mundo para PT-BR.
   Resultado esperado: notificacoes, titulos de apps/dialogs e chat cards dos
   fluxos principais aparecem localizados.

2. Recarregue o mundo com `F5`.
   Resultado esperado: nao ha erros bloqueantes no console durante `init`,
   `setup` ou `ready`.

3. Abra uma ficha, uma tecnica, um browser e o Synckit.
   Resultado esperado: nenhuma janela fica com template faltando ou layout
   quebrado.
