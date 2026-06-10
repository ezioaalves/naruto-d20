# QA automatizado (E2E)

Suite Playwright que executa, de forma automática, os cenários do
[`manual-qa.md`](manual-qa.md) contra um Foundry real. Substitui o clique manual
nas seções de **regra** de maior risco; o checklist manual continua valendo para
o que ainda não foi automatizado.

## Como funciona

- **A "switch":** um setting de mundo oculto `naruto-d20.testMode` (default
  `false`, `config:false`). Quando ligado, o módulo publica suas funções internas
  de regra + helpers de fixture/determinismo em
  `game.modules.get("naruto-d20").api` (ver `scripts/testing/test-api.mjs`,
  instalado no hook `ready`). Sem o switch, nada disso existe — zero impacto em
  produção.
- **O runner:** `@playwright/test` (`tests/e2e/`). O `global-setup` faz login uma
  vez, liga o `testMode`, recarrega e salva a sessão. Cada spec dirige as regras
  via `page.evaluate` chamando a API e faz asserts em flags/condições/chat — não
  em DOM frágil.
- **Determinismo:** `api.withForcedRoll(face, fn, { actor })` fixa o d20
  (`20` = sucesso, `1` = falha) e força `skipDialog` no perform check; restaura
  tudo no `finally`.

## Pré-requisitos

1. **Foundry rodando** em `http://localhost:30000` (ou defina `FOUNDRY_URL`).
2. Um **mundo de teste já aberto** com o módulo `naruto-d20` ativo.
3. Um ator chamado **`Ikazuchi`** com técnicas (algumas aprendidas, com custo de
   chakra) — é o alvo das fixtures.
4. O usuário de login precisa ser **GM** (necessário para gravar o setting de
   mundo). Default: `Chicó` / `esquecademimhomi` (sobrescreva com
   `FOUNDRY_USER` / `FOUNDRY_PASSWORD`).

## Rodando

```bash
npm install                 # puxa @playwright/test
npx playwright install chromium
npm run test:e2e            # headless
npm run test:e2e:headed     # com browser visível (primeira vez recomendado)
npm run test:e2e:ui         # modo UI interativo do Playwright
```

Relatório HTML em `playwright-report/`. Artefatos de auth/relatório são
gitignored.

## Cobertura atual (núcleo)

| Spec | manual-qa | Observação |
|---|---|---|
| `chakra.spec.mjs` | Chakra 1–6 | Inclui 1 check de DOM (aba Chakra renderiza). |
| `tap-reserves.spec.mjs` | Tap Reserves 2–6 | Dirige o `TapReservesDialog` real. |
| `use-technique.spec.mjs` | Uso 1–3, 5, 6 | Steps de perform descobrem técnicas no ator e dão `skip` se faltarem. |
| `auto-buffs.spec.mjs` | Auto-buffs 1, 2, 4, 5, 6 | Lookup/refresh contra o pack; end-to-end por descoberta. |

Steps que abrem o diálogo de ataque do PF1e, `weaponAttack`/`charge`, e as
seções _Aprendizado_, _Ranks temporários_, _Synckit_, _Browsers_, _Descanso_,
_Compêndios_ e _sweep PT-BR_ ficam para a próxima fase, reusando o mesmo harness.

## Isolamento

Cada teste começa com `api.resetActor(actor, state)` (reseta chakra + limpa
condições do módulo), então a ordem de execução não importa e a suite é
idempotente — rode duas vezes seguidas e o resultado é o mesmo.
