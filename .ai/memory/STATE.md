# Estado actual

_Última actualización: 2026-09-27 por cursor (WS3 builder)_

## En curso
- Rama `cursor/ws3-engine-adapters-6820` (WS3, apilada sobre
  `cursor/ws0-contracts-store-fakes-8d1e`): adaptadores de motor + auth.
  - `@openbot/engines-common` ✅: `auth.ts`, resolución de CLI (incl. shims
    `.cmd`), cargador de fixtures JSONL.
  - `@openbot/engines-claude` ✅: `ClaudeDriver` (proceso stream-json de larga
    duración, `--resume`, MCP + `permission_prompt`, steer/interrupt).
  - `@openbot/engines-codex` ✅: `CodexDriver` + `CodexAppServer` compartido,
    MCP por hilo vía `thread/start`, aprobaciones v2 `item/*/requestApproval`,
    tipos generados + comprobación de deriva de esquema.
  - `@openbot/engines-conformance` ✅: suite compartida + replays dorados de
    fixtures; conformidad CLI real opt-in (`OPENBOT_E2E_REAL=1`).
  - `packages/engines/DECISIONS.md` ✅ (E-WS3-001..003).
  - 177 tests (169 pasando + 8 omitidos real-CLI); `format:check`/`lint`/
    `typecheck`/`test`/`mh check` en verde en Linux.
- Rama `cursor/ws0-contracts-store-fakes-8d1e` (PR #2, base apilada): WS0
  completo (ver historial abajo).

## Próximos pasos
1. Abrir PR WS3 → `cursor/ws0-contracts-store-fakes-8d1e` (draft).
2. Spike de seguimiento WS3 con credenciales reales antes de M1
   (`OPENBOT_E2E_REAL=1`): aprobaciones, steer/interrupt en vivo, deltas
   `--include-partial-messages`.
3. WS2/WS1 pueden importar `ClaudeDriver`/`CodexDriver` cuando integren el
   runtime y el wizard de setup.

## Bloqueos / preguntas abiertas
- Aprobaciones Codex/Claude en vivo no verificadas (spike sin credenciales);
  drivers construidos contra esquemas + fixtures dorados.
- CI real en matriz 3 SO pendiente de corrida en GitHub Actions.

## Histórico WS0 (rama base)
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

## Bloqueos / preguntas abiertas (histórico)
- **El PAT (`GH_TOKEN`) puede leer/empujar pero no crear pull requests.**
  Acción pendiente del usuario: permiso "Pull requests" → "Read and write".
- El WS3 (motores) tiene un spike sin credenciales ya hecho
  (`internal/engine-spike.md` en el store del proyecto); falta un spike de
  seguimiento con credenciales reales antes del cierre de M1 (no bloquea
  WS0-WS12).
