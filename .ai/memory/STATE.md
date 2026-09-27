# Estado actual

<<<<<<< HEAD
_Última actualización: 2026-09-27 por WS13 integration builder_

## En curso
- Rama `cursor/v1-integration` — merges WS0–WS12 completos; cableado real en curso.
=======
_Última actualización: 2026-09-27 por cursor (WS12 routines & scheduling)_

## En curso
- Rama `cursor/ws12-routines-scheduling-a90f` (apilada sobre WS4 PR #7 /
  `cursor/ws4-mcp-server-d8cd`), **WS12 completo** según plan §5 / M4:
  - `packages/routines` (`@openbot/routines`) ✅: `RoutineOrchestrator`
    (scheduler con `croner` + `FakeClock`, storm control/coalescing,
    caps O7, dry-run reports, `routine_live` approval), trigger matching
    (dedupe, filter, Jev `trigger` gate), webhook route `POST /hooks/:id`,
    OpenBot event trigger source, `integrateRoutines()`, `RoutineRuntime`
    SPI + `SimulatedRoutineRuntime` hasta que WS2 aterrice.
  - `packages/mcp`: `McpRoutineServiceAdapter` reemplaza `FakeRoutineService`
    cuando `integrateRoutines` + `integrateMcp` se cablean en `openbot serve`.
  - `packages/core`: `RoutineOrchestratorLike` en `CoreContext`,
    `/api/routines/:id/run` y WS `routine.run` cableados cuando el
    orquestador está presente.
  - `packages/store`: `RoutineRunsRepo.update` acepta `triggerEventIds`.
  - 227 tests workspace en verde (`pnpm lint typecheck build test`, `mh check`).
  - Sin cambios a `@openbot/contracts`.
  - Pendiente: WS2 `RoutineRuntime` real (mailbox + dry-run broker), WS10
    connector `subscribeTrigger`, file-watch (`chokidar`) en producción,
    restart idempotency e2e, property tests adicionales.
- Rama `cursor/ws4-mcp-server-d8cd` (PR #7, base de WS12), WS4 completo.
- WS0/WS1 según entradas previas.

## Próximos pasos
1. Abrir PR WS12 → WS4 (`cursor/ws12-routines-scheduling-a90f` →
   `cursor/ws4-mcp-server-d8cd`).
2. WS2 runtime: implementar `RoutineRuntime` real y sustituir
   `SimulatedRoutineRuntime`.
3. WS10: cablear `subscribeTrigger` al orquestador.
4. WS13: escenarios M4 E2E.

## Bloqueos
- PAT sin permiso `pull_requests=write` para `gh pr create` — usar GitHub MCP.
>>>>>>> origin/cursor/ws12-routines-scheduling-a90f
