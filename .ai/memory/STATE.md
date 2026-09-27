# Estado actual

_Última actualización: 2026-09-27 por cursor (WS9)_

## En curso
- Rama `cursor/ws9-computer-use-d5af` (WS9): `@openbot/computer` fast loop
  (`runFastLoop`, `ComputerAgentImpl`), `@openbot/computer-docker`
  (`DockerProvider` + LRU `ScreenManager` + control-daemon client),
  `@openbot/computer-local` (`LocalProvider` opt-in, ask-every-time approval
  handler, Linux X11/xdotool driver stub), e `images/desktop` (Xvfb/noVNC/Chromium
  control daemon). Tests contra fake computer + fake-jev; eval live opt-in con
  `JEV_API_KEY`; Docker smoke opt-in con `OPENBOT_DOCKER=1`. PR apilada sobre
  `cursor/ws7-decision-service-43da`.
- Rama `cursor/ws7-decision-service-43da` (WS7): `DecisionService` completo
  (ver entrada anterior). Exporta ahora `bandForAnswer`, `buildDecisionState` desde
  `@openbot/decisions` para WS9.
- Rama `cursor/ws0-contracts-store-fakes-8d1e` (WS0): contratos + fakes ✅.
- Rama `cursor/metaharness-bootstrap-8d1e`: bootstrap metaharness ✅.

## Próximos pasos
1. Integrar WS9 en WS2 runtime (permission broker real), WS4 MCP
   (`computer_task`/`computer_screenshot`), WS5 UI (noVNC panel).
2. CDP/AX/OCR observation pipeline real en control daemon (ahora fixture mínimo).
3. Local provider sidecar real macOS/Windows (GhostDesk/cua-driver spike).
4. Nightly eval suite de 20 tareas contra fake + Jev live.

## Bloqueos / preguntas abiertas
- PAT (`GH_TOKEN`) sigue sin permiso `pull_requests=write` para `gh pr create`.
- Docker no disponible en el VM del agente; tests de integración Docker son
  opt-in (`OPENBOT_DOCKER=1`).
