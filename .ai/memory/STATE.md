# Estado actual

<<<<<<< HEAD
_Última actualización: 2026-09-27 por cursor (WS10 connector catalog)_

## En curso
- Rama `cursor/ws10-connector-catalog-a747` (apilada sobre WS1; PR pendiente),
  **WS10 completo** según el plan §5:
  - `packages/connectors` (`@openbot/connectors`) ✅: `ConnectorProvider` SPI con
    `McpProvider` (Registry + manual stdio/HTTP, secretos en vault),
    `ComposioProvider` (validateKey, catálogo, OAuth pendiente, MCP por bot,
    `sideEffect` en toolMeta, triggers outbound vía `subscribeTrigger`),
    `DefaultConnectorService` (agregador extensible a Pipedream),
    `wireConnectors()` (validador `composio` del wizard + `ctx.connectorService`).
  - Integración mínima en WS1: `CoreContext.connectorService`,
    rutas `/api/connectors/*` ya no devuelven 501 cuando `wireConnectors` corre;
    `apps/server` llama `wireConnectors` en `openbot serve`.
  - `packages/store`: `ConnectionsRepo.update()` para toolMeta/triggers tras OAuth.
  - Tests: mock Composio (herramientas + trigger stream), fixture MCP stdio,
    grep de redacción sobre DB/vault/NDJSON, OAuth loopback callback +
    deep-link completion API; live Composio opt-in
    (`OPENBOT_COMPOSIO_LIVE=1` + `COMPOSIO_API_KEY`).
  - PR https://github.com/sanlega/OpenBot/pull/12 (ready for review, apilada sobre WS1).
  - 212 tests workspace en verde (`format:check`/`lint`/`typecheck`/`build`/`test`/`mh check`).
  - Sin cambios a `@openbot/contracts`.
- Rama `cursor/ws1-core-harness-09d8` (apilada sobre WS0; PR
  https://github.com/sanlega/OpenBot/pull/3, lista para review), **WS1
  completo** según el plan §5:
  - `packages/store`: 17 repos nuevos (uno por entidad del plan que faltaba)
    + `BotsRepo` extendido (`getBySlug`/`list`/`update`/`archive`). 37 tests.
  - `packages/core` (`@openbot/core`) ✅: `config.ts` (`loadConfig`,
    `resolveBindHost` — loopback por defecto, sólo se abre si remoto+device
    auth están ambos activos), `vault.ts` (`FileVault` AES-256-GCM+0600,
    `InMemoryVault`), `device-auth.ts` (token firmado stateless, D-018),
    `event-bus.ts` (persist → NDJSON → fan-out, un `publish()` por evento),
    `context.ts` (`CoreContext`, registro de servicios con campos
    opcionales/enchufables para WS2/WS7/WS9/WS10/WS11/WS12, D-019),
    `module-host.ts` (para que otros workstreams registren rutas/
    validadores), `doctor.ts` (`openbot doctor`: CLIs de motor, Docker/
    Podman, tailscale/cloudflared, permisos del directorio de datos).
  - Client API (plan §4.7) completo en `packages/core/src/http/`: 10
    módulos de rutas (`health`/`bots`/`threads`/`safety`/`devices`/
    `settings-setup`/`computer`/`connectors`/`routines`/
    `remote-and-audit`) + `server.ts` que los ensambla con
    `@fastify/websocket`. CRUD real para bots/threads/messages/approvals/
    rules/devices/routines/settings; lo que depende de un workstream no
    aterrizado (DecisionService de WS7, ComputerProvider de WS9,
    ConnectorProvider de WS10, orquestador de WS12) devuelve
    `501 {error, reason}` en vez de fingir o lanzar 500.
  - WebSocket `/api/ws` (`ws.ts`): `{subscribe, since}` sin huecos (probado
    con un socket real, no `.inject()`); comando `approval.resolve`
    implementado, `message.send`/`turn.stop`/`routine.run` responden
    "not implemented" estructurado hasta que WS2/WS12 aterricen.
  - `apps/server` (`@openbot/server`) ✅: `openbot serve|doctor|pair` real
    (`cli.ts`), reemplaza el esqueleto mínimo de WS0.
  - Los 5 criterios de aceptación de WS1 verificados con tests: CRUD
    (`http/server.test.ts`), replay del WS sin huecos (`ws.test.ts`,
    `event-bus.test.ts`), el harness nunca escucha más allá de loopback sin
    remoto+device-auth (`config.test.ts`), un approver no puede cambiar caps
    (`http/server.test.ts`), p95 publish→WS < 50ms (`ws.test.ts`). Estado
    sobrevive un restart real (`restart.test.ts`) y el vault hace
    round-trip (`vault.test.ts`, corre en las 3 SO vía la matriz de CI).
  - `.github/workflows/ci.yml`: `Build` antes de `Typecheck` (D-017, bug
    real de TS6305 en checkout limpio, no específico de WS1 pero
    descubierto y arreglado en esta rama).
  - 204 tests en 25 archivos, todo el workspace en verde
=======
_Última actualización: 2026-09-27 por cursor (WS11 remote access and pairing)_

## En curso
- Rama `cursor/ws11-remote-pairing-1f8c` (apilada sobre WS1; PR pendiente de
  abrir), **WS11 implementado** según el plan §4.8 / §5 WS11:
  - `packages/remote` ✅: `PairingService` (QR payload, `pairSecret`
    single-use 10 min), X25519 + libsodium `secretstream` E2E framing
    (`DeviceE2ESession`/`ClientE2ESession`), `TailscaleManager`
    (`tailscale serve --bg`), `CloudflareManager` (`cloudflared tunnel run
    --token` + Access warning), `attachRemoteServices` /
    `registerRemoteIntegration`.
  - `apps/pwa` ✅: PWA estática servida en `/app` (manifest, service worker,
    pantalla de pairing, clave de dispositivo en IndexedDB).
  - Integración en `@openbot/core`: `buildServer()` cablea WS11 por defecto;
    rutas `POST /api/devices/pair/qr` y `/api/devices/pair/complete`;
    `remote/tailscale/*` y `remote/cloudflare` operativos; E2E en HTTP
    (respuestas remotas) y WebSocket; revocación sigue siendo inmediata.
  - 216 tests en 30 archivos, todo el workspace en verde
>>>>>>> origin/cursor/ws11-remote-pairing-1f8c
    (`format:check`/`lint`/`typecheck`/`build`/`test`/`mh check`).
  - Sin cambios a `@openbot/contracts` ni `@openbot/store`.
- Rama `cursor/ws1-core-harness-09d8` (PR https://github.com/sanlega/OpenBot/pull/3):
  WS1 completo, base de esta rama WS11.

## Bloqueos
- PRs #1/#2 del bootstrap/WS0 aún sin abrir (token sin permiso `gh pr create`;
  usar GitHub MCP).

## Próximos pasos
- WS5 (`@openbot/ui`): sustituir el shell PWA mínimo por la app React compartida.
- WS13: E2E Playwright mobile pairing sobre red real (Tailscale/Cloudflare).
- Retarget PR WS11 a `main` cuando mergee WS1/WS0.
