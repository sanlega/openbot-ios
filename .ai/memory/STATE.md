# Estado actual

_Última actualización: 2026-09-27 por cursor (continuación WS1)_

## En curso
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
    (`format:check`/`lint`/`typecheck`/`build`/`test`/`mh check`).
  - Sin cambios a `@openbot/contracts` (ver el handoff de esta sesión para
    el detalle del `DecisionService.route()` del plan que no existe en el
    contrato real).
  - Pendiente: un hook en `CoreContext` para que WS12 conecte el
    orquestador de rutinas/turnos (hoy 501); `apps/desktop` (WS6) todavía no
    consume `buildServer`/`createCoreContext`.
- Rama `cursor/metaharness-bootstrap-8d1e` (PR 1 aún sin abrir, ver Bloqueos):
  bootstrap de metaharness (`ADAPTERS="agents claude"`, contexto en inglés) +
  herramientas del monorepo (pnpm 10 + Node 22, TypeScript 6.0.3, ESLint flat
  config, Prettier, Vitest, CI de 3 SO). Plan copiado a
  `.ai/memory/plans/openbot-v1.md`; decisiones D-001..D-014 registradas.
- Rama `cursor/ws0-contracts-store-fakes-8d1e` (apilada sobre la anterior; PR 2
  aún sin abrir, ver Bloqueos), WS0 en curso:
  - `packages/contracts` ✅: zod para todas las entidades del plan §4.1, el
    contrato de eventos §4.2 (`OBEvent`/`EventType`, 58 tipos con un fixture
    cada uno), las SPI `EngineDriver`/`ComputerProvider`/`ConnectorProvider`/
    `TriggerSource`, y el contrato de cable de Jev (`packages/contracts/src/jev.ts`)
    ajustado a `internal/jev-spike.md`: respuestas choice/score llevan
    `confidence`, noul nunca; error 422 es un array de validación, 401 (y demás
    errores de API) es un objeto; constante `x-typesafe-request-id` exportada.
    Fixtures reales copiados a `packages/decisions/fixtures/jev/` y
    `packages/engines/fixtures/`. 70 tests.
  - `packages/store` ✅: esquema Drizzle/SQLite para las 19 tablas del plan
    (incluye `decisions.request_id`), `migrations/0000_init.sql` generado con
    `drizzle-kit generate`, `openDb()` + `EventStore` + `BotsRepo`. 8 tests
    nuevos (78 en total en el workspace). `pnpm-workspace.yaml` con
    `onlyBuiltDependencies` para que `better-sqlite3`/`esbuild` compilen sin
    interacción en CI.
  - Todo el workspace en verde: `format:check`, `lint`, `typecheck`, `build`,
    `test`, `bash .ai/bin/mh check`.
  - `@openbot/testkit` ✅: `FakeClock` (determinista) y `FakeTriggerSource`
    (scripteable), más las suites de conformidad para `EngineDriver` y
    `ComputerProvider` (WS3/WS9 las reutilizarán contra sus implementaciones
    reales).
  - `@openbot/engines-fake` ✅: `EngineDriver` con modo "loop" (siempre
    responde) y "chatty" (llama `message_user` varias veces antes de
    responder).
  - `@openbot/computer-fake` ✅: `ComputerProvider` con fixtures DOM (flujo
    inbox → compose → sent); rechaza índices no observados/obsoletos.
  - `@openbot/decisions` ✅ (aporte de WS0; la implementación completa de
    `DecisionService` es de WS7): `FakeJevServer` (servidor HTTP real que
    implementa `/v1/systemone` y `/v1/models` exactamente igual que la API
    real, sembrado con los fixtures copiados, con `scriptedAnswers` y
    `scheduleRateLimit()` para 429 inyectables) + `FakeDecisionService`
    (implementación en proceso de `DecisionService` para quien solo necesite
    una en sus tests).
  - Stubs de paquete (`package.json`/`tsconfig.json`/placeholder) para el
    resto de workstreams de un solo paquete: `core` (WS1), `runtime` (WS2),
    `mcp` (WS4), `cos` (WS8), `connectors` (WS10), `remote` (WS11),
    `routines` (WS12), `ui` (WS5) — así `pnpm -r` los descubre antes de que
    aterrice cada workstream.
  - `apps/server` (`@openbot/server`) ✅: arranque real y mínimo con Fastify
    (`GET /health`, `GET /api/harness/status`); WS1 lo sustituye por la API
    completa (plan §4.7) y `openbot serve|doctor|pair`.
  - `apps/desktop` (`@openbot/desktop`) ✅ (alcance reducido, ver su
    `README.md`): esqueleto de Electron (main/preload/renderer reales,
    tipados contra un shim ambiental local en vez de depender del paquete
    `electron` real, para no arriesgar la fiabilidad de CI con su descarga
    binaria de ~100 MB por SO en una matriz de 3 SO que WS6 reescribirá de
    todos modos). La lógica real "¿está conectado el harness?" está extraída
    a `harness-client.ts` y probada con Vitest; la ventana de Electron en sí
    no se puede verificar sin pantalla en este entorno.
  - `apps/pwa`, `e2e/`: stubs de paquete (WS11 y WS13 respectivamente).
  - 147 tests pasando en 19 archivos de test en todo el workspace;
    `format:check`/`lint`/`typecheck`/`build`/`test`/`mh check` en verde.
  - **WS0 está funcionalmente completo** según el plan §5 (contratos +
    esquema/migración + los 5 falsos + suites de conformidad + shells
    Electron/headless). Falta abrir las PRs (ver Bloqueos) y, opcionalmente,
    confirmar el pipeline de CI en una corrida real de GitHub Actions en las
    3 SO (no se puede ejecutar Windows/macOS localmente en este entorno;
    `pnpm install --frozen-lockfile` se verificó localmente en Linux).

## Próximos pasos
1. En cuanto el bloqueo de permisos del PAT se resuelva, abrir PR 1
   (`cursor/metaharness-bootstrap-8d1e` → `main`) y PR 2
   (`cursor/ws0-contracts-store-fakes-8d1e` → PR 1, apilada), y verificar el
   pipeline de CI en una corrida real de GitHub Actions (3 SO).
2. Tras la PR 2, abrir WS1-WS12 en paralelo (uno por workstream) contra los
   contratos y los falsos de WS0.

## Bloqueos / preguntas abiertas
- **El PAT (`GH_TOKEN`) puede leer/empujar pero no crear pull requests.**
  `gh pr create` y `POST /repos/sanlega/OpenBot/pulls` devuelven 403 con
  cabecera `x-accepted-github-permissions: pull_requests=write`, es decir al
  token le falta el permiso de **escritura** en "Pull requests" (aunque sí
  puede leerlos). Acción pendiente del usuario: en la página de permisos del
  PAT de grano fino, poner **"Pull requests" → "Read and write"** y guardar.
  No bloquea el trabajo en las ramas (push/pull funcionan); solo bloquea abrir
  las PRs. Se reintentará `gh pr create` en cuanto se corrija.
- El WS3 (motores) tiene un spike sin credenciales ya hecho
  (`internal/engine-spike.md` en el store del proyecto); falta un spike de
  seguimiento con credenciales reales antes del cierre de M1 (no bloquea
  WS0-WS12).
