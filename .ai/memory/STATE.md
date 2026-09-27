# Estado actual

_Última actualización: 2026-09-27 por cursor_

## En curso
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
  - Siguiente en esta rama: motor/computer/servidor-Jev falsos (usando los
    fixtures ya copiados), reloj controlable, suites de conformidad para
    `EngineDriver`/`ComputerProvider`, stubs de paquete para el resto de
    workstreams (`core`, `runtime`, `mcp`, `cos`, `computer`, `connectors`,
    `remote`, `routines`, `ui`, apps `desktop`/`server`/`pwa`, `e2e`), y un
    arranque mínimo de `apps/server`.

## Próximos pasos
1. Terminar WS0 (ver `.ai/memory/plans/openbot-v1.md` §5, WS0) en la rama
   apilada, con CI en verde.
2. En cuanto el bloqueo de permisos del PAT se resuelva, abrir PR 1
   (`cursor/metaharness-bootstrap-8d1e` → `main`) y PR 2
   (`cursor/ws0-contracts-store-fakes-8d1e` → PR 1, apilada).
3. Tras WS0, abrir WS1-WS12 en paralelo (uno por workstream) contra los
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
