# Estado actual

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
