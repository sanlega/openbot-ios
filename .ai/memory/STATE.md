# Estado actual

_Última actualización: 2026-09-27 por cursor_

## En curso
- Rama `cursor/metaharness-bootstrap-8d1e` (PR draft abierta): bootstrap de
  metaharness (`ADAPTERS="agents claude"`, contexto en inglés) + herramientas del
  monorepo (pnpm 10 + Node 22, TypeScript 6.0.3, ESLint flat config, Prettier,
  Vitest, CI de 3 SO). Plan copiado a `.ai/memory/plans/openbot-v1.md`; decisiones
  D-001..D-014 registradas.
- Siguiente: WS0 (contratos, esquema SQLite/Drizzle, motor/computer/Jev falsos,
  suite de conformidad, stubs de paquete) como PR apilada sobre esta.

## Próximos pasos
1. Terminar WS0 (ver `.ai/memory/plans/openbot-v1.md` §5, WS0) en una rama apilada
   sobre `cursor/metaharness-bootstrap-8d1e`, con CI en verde.
2. Tras WS0, abrir WS1-WS12 en paralelo (uno por workstream) contra los contratos y
   los falsos de WS0.

## Bloqueos / preguntas abiertas
- Ninguno por ahora. El WS3 (motores) tiene un spike sin credenciales ya hecho
  (`internal/engine-spike.md` en el store del proyecto); falta un spike de
  seguimiento con credenciales reales antes del cierre de M1 (no bloquea WS0-WS12).
