# Estado actual

_Última actualización: 2026-09-27 por cursor (WS2 rebase onto WS0)_

## En curso
- PR #1 (`cursor/metaharness-bootstrap-8d1e` → `main`): CI verde en las 3 SO.
- PR #2 (`cursor/ws0-contracts-store-fakes-8d1e` → PR #1): CI verde en las 3 SO
  (fix: build de `@openbot/contracts` antes de `typecheck`; matrix Windows
  `windows-2022` + `npm_config_msvs_version=2022` para `better-sqlite3`).
- Rama `cursor/ws2-runtime-safety-955e` (PR 4, draft, apuntando a
  `cursor/ws0-contracts-store-fakes-8d1e`), WS2 (runtime y seguridad) **completo**
  (criterios de aceptación del plan §5 + tests) contra los falsos de WS0 y SQLite
  `:memory:`:
  - `packages/runtime/src/`: mailbox, broker E6, dry-run simulation, chain limits,
    loop guards, spend/turn caps S8, CapCounter (memoria + SQLite), delivery,
    routing/sessions/prompt, `createRuntime()`.
  - 127 tests nuevos en `packages/runtime` (274 en total en el workspace).
  - D-018: brecha de contratos señalada (`capCounter` prefix) — PR separada.
  - Rebaseada sobre WS0 con CI verde; pendiente confirmar CI en PR 4 tras rebase.

## Próximos pasos
1. Confirmar CI verde en PR 4 tras el rebase sobre WS0.
2. Retarget PR 4 a `main` una vez mergeen PRs #1/#2.

## Bloqueos / preguntas abiertas
- PAT puede push pero no crear PRs (permiso pull_requests=write pendiente).
- WS3 follow-up spike con credenciales reales antes de M1 (no bloquea WS2).
