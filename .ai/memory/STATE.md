# Estado actual

_Última actualización: 2026-09-27 por cursor (WS9)_

## En curso
- Rama `cursor/ws9-computer-use-d5af` (WS9) — PR #8 **ready for review**, apilada sobre
  `cursor/ws7-decision-service-43da`.
  - **Observation pipeline** (`@openbot/computer/observation`): CDP DOM → CDP AX → AT-SPI → OCR (tesseract), wired into bundled `desktop-daemon.js`.
  - **Local providers**: Linux (xdotool + AT-SPI), macOS (osascript/System Events), Windows (PowerShell UIA).
  - **20-task eval suite** (`packages/computer/evals/` + `src/evals/run-eval.ts`): offline scripted ≥80% pass; live opt-in all 20 tasks with `JEV_API_KEY`.
  - **Docker**: multi-stage `images/desktop/Dockerfile`; smoke test passes (`OPENBOT_DOCKER=1 bash images/desktop/smoke.sh`).

## Próximos pasos
1. WS2 runtime broker integration, WS4 MCP tools, WS5 noVNC UI panel.
2. Full end-to-end eval with live Jev driving full fast loops (not just first decide).

## Bloqueos
- Ninguno para WS9 v1 scope.
