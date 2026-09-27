# Estado actual

_Última actualización: 2026-09-27 por WS13 integration builder_

## En curso
- Rama `cursor/v1-integration` lista para PR → `main`.
- Merges WS0–WS12 completos; `bootstrapHarness()` cablea runtime, CoS, MCP, connectors, remote, routines.
- E2E M1–M4 pasan con fakes (Playwright, 4 tests).
- 621 tests unitarios + `mh check` verdes.

## Próximos pasos
1. CI verde en las 3 SO en el PR.
2. Spike WS3 con credenciales reales para M1 sign-off.
3. UI Playwright contra Electron (M1 wizard) cuando WS5 use API real en desktop.
