# Documentação para contribuidores

Esta pasta reúne o material de referência útil para quem desenvolve ou faz QA do módulo.
Para uma visão de produto/funcionalidades, veja o [`README.md`](../README.md) na raiz; para
as convenções de contribuição, veja [`AGENTS.md`](../AGENTS.md) e [`CLAUDE.md`](../CLAUDE.md).

| Documento | Para quê |
|---|---|
| [`manual-qa.md`](manual-qa.md) | Checklist de QA manual por feature — rode antes de um release ou PR grande. |
| [`compendium-source-packing.md`](compendium-source-packing.md) | Fluxo de empacotamento dos compêndios: source JSON ↔ LevelDB (`npm run pack` / `unpack`). |
| [`pf1-buff-changes-reference.md`](pf1-buff-changes-reference.md) | Referência dos buff *changes* do PF1e ao escrever automações de técnica. |

As notas históricas de implementação (como cada feature/refactor foi construído) ficam em
`dev-notes/` na raiz, que é **local e fora do versionamento** (`.gitignore`) — não aparecem em
clones novos.
