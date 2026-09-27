# Estado actual

_Última actualización: 2026-09-27 por WS13 integration builder_

## En curso
- Rama `cursor/v1-integration` — merge de todos los workstreams WS0–WS12 +
  cableado real en `openbot serve` / desktop / PWA.
- PRs base: #1 bootstrap, #2 WS0, #3 WS1, #4 WS2, #5 WS7, #6 WS3, #7 WS4,
  #8 WS9, #9 WS6, #10 WS5, #11 WS8, #12 WS10, #13 WS11, #14 WS12.

## Próximos pasos
1. Completar merges y resolver conflictos.
2. Reemplazar fakes con cableado real (WS2/WS4/WS8/WS9/WS10/WS12).
3. E2E Playwright M1–M4 con fakes en CI.
4. Abrir PR `cursor/v1-integration` → `main`.

## Bloqueos / preguntas abiertas
- PAT puede push pero no `gh pr create` — usar GitHub MCP para abrir PR.
- Spike WS3 con credenciales reales pendiente para M1 sign-off (no bloquea CI).
