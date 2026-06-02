# Repository Guidelines

## Project Structure & Module Organization

This is a Foundry VTT module for Pathfinder 1e. Runtime code lives in `scripts/` as ESM loaded directly by Foundry. Core hook wiring is in `scripts/main.mjs`; data models and calculations are in `scripts/data/`; UI listeners and sheet patches are in `scripts/ui/`; automation helpers are in `scripts/automation/`. Handlebars templates are under `templates/`, styles are split by UI area under `styles/`, localization in `lang/`, and icons in `icons/`.

Compendium source JSON is under `packs/_source/{techniques,feats,technique-buffs}/`. Packed LevelDB data under `packs/` is runtime output; do not hand-edit it. `README.md` is product-facing (features, install, no code paths). Contributor reference (manual QA, compendium packing, buff-changes reference) lives in `docs/`, architectural invariants in `CLAUDE.md`. Per-feature implementation/refactor notes live in the gitignored, local-only `dev-notes/` directory.

## Build, Test, and Development Commands

- `npm install` installs the Foundry CLI dependency used for pack workflows.
- `npm run pack` builds `packs/techniques/` from `packs/_source/techniques/`.
- `npm run unpack` exports `packs/techniques/` into source JSON; use only when resyncing from in-app edits because it overwrites source files.
- `npm run add-actions -- --dry-run` previews generated technique actions; omit `--dry-run` to apply.
- `npm run fix-spell-attacks -- --dry-run` previews attack-type cleanup.
- `npm run validate:compendia` validates technique, feat, and technique-buff source JSON.

There is no build step. Edit `.mjs`, `.hbs`, `.css`, or JSON source files, then reload Foundry with `F5` or in-world `Ctrl+R`.

## Coding Style & Naming Conventions

Use JavaScript ESM with two-space indentation and semicolons. Prefer named exports and small modules grouped by responsibility. Keep constants in `scripts/constants.mjs`; build actor flag paths only through `scripts/flag-paths.mjs`. Do not concatenate `"naruto-d20"` flag paths at call sites.

Technique item data belongs in `item.system.*`. Actor module state belongs in `flags["naruto-d20"].*`, except deliberate PF1e integrations documented in `README.md` or `CLAUDE.md`.

## Testing Guidelines

No automated test suite is configured. Verify manually in Foundry VTT 13 with PF1e v11.11+: reload the world, open an actor sheet, exercise the Chakra tab, technique sheets, rolls, and affected compendium entries. Use `docs/manual-qa.md` for release or large-PR validation. For compendium transforms, run dry-run first, review `git diff`, run `npm run validate:compendia`, then `npm run pack` and confirm the packed data loads.

## Commit & Pull Request Guidelines

Recent history uses short conventional-style subjects such as `feat(rest): ...`, `fix(tap-reserves): ...`, `docs: ...`, and `chore: ...`. Keep commits focused and mention the subsystem when helpful.

Pull requests should describe the behavior change, list manual Foundry verification steps, link related issues, and include screenshots or clips for visible sheet/UI changes. Note any compendium packing performed.

## Agent-Specific Instructions

Before changing PF1e APIs, globals, `CONFIG.PF1` keys, or `system.*` paths, verify against the installed PF1e v11.11 behavior. Treat `CLAUDE.md` as authoritative for hook order and architectural invariants.
