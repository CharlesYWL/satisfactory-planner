# AGENTS.md

## Cursor Cloud specific instructions

`satisfactory-planner` is a static front-end SPA (Vite + React + TypeScript, package manager **npm**). There is no backend, database, or secret/env-var requirement — everything runs in the browser with bundled JSON game data.

### Services

Only one service is relevant: the Vite dev server.

- Run dev server: `npm run dev` (serves at `http://localhost:5173`).
- Standard commands live in `package.json`: `npm test` (Vitest), `npm run typecheck`, `npm run build` (runs `tsc -b` then `vite build`), `npm run preview`.

### Notes / caveats

- There is **no lint script / ESLint config** in this repo. Use `npm run typecheck` (or `npm run build`, which typechecks) as the static-analysis gate.
- The README states 47 tests; the suite currently has 72 passing tests across 7 files. `npm test` is the source of truth.
- The Python scripts under `data/` (`normalize.py`, `build_zh_names.py`) are offline/build-time data regeneration only — not needed to run, test, or build the app.
