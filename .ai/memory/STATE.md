# Estado actual

_Última actualización: 2026-09-27 por claude (review + fixes, PR #16)_

## En curso
- `cursor/v1-integration` (PR #15 → `main`) integrates WS0–WS12. `main` still has
  only the initial commit; PRs #1–#14 are superseded by #15.
- PR #16 (`claude/openbot-dev-review-vi6h4j` → `cursor/v1-integration`) carries the
  review fixes. What now works end to end (with fakes; E2E in `e2e/tests/`):
  - **Jev**: never a silent fake in production (`KeyedDecisionService`); key read
    from vault per call; `validateKey` probes Jev; `JEV_BASE_URL` override.
  - **Chat turns** (`apps/server/src/turn-mailbox.ts`, `createTurnBuilder`): Jev
    routing / pin / override, vault key or CLI login, OpenBot MCP server injected
    per turn (runtime `prepareTurn`), user + bot messages stored, engine session
    resumed from `engine_sessions`, CoS system prompt, stop via
    `POST /api/threads/:id/stop`.
  - **Approvals**: `permission_prompt` waits for the card; HTTP/WS resolution
    wakes the broker (`ctx.onApprovalResolved`).
  - **CoS caps**: S2/S3 fixed; S1–S10 settings apply live (no restart); spawn
    history and S4/S5 counts survive restarts (derived from the store).
  - **Dry runs** never execute (simulated engine tools are refused; side-effect
    OpenBot tools only record `action.simulated`).
  - **Routines**: runs are real Bot turns; dry run lists planned actions; per-run
    cap interrupts (`runBudget`); allowing the `routine_live` card enables live;
    15-min minimum for every cron form.
  - **Digest**: posted once a day at the digest hour as a CoS message, from the
    store (`apps/server/src/digest.ts`).
  - **UI ↔ harness**: WS protocol, `GET /api/threads`, `PATCH /api/settings`,
    adapters for activity/audit/computer/remote/pairing/runs
    (`packages/ui/src/api/adapters.ts`); the mock speaks the harness protocol.
    Browser E2E (`e2e/tests/m1-ui.spec.ts`) drives the PWA at `/app`.
  - **WS**: events flow only after `subscribe`; no duplicates across replay.
  - Fake engine directives for tests: `@tool <name> <json>`, `@approve <tool> <json>`.
- Verified locally: 669 unit tests, lint 0 errors, typecheck, format, E2E 10/10
  (`OPENBOT_E2E_CHROMIUM=/opt/pw-browsers/chromium` for a preinstalled browser).
  `apps/desktop` cannot be installed in the cloud sandbox (codeload blocked); CI
  covers it.

## Próximos pasos
1. Get PR #16 green and reviewed; merge it into #15, merge #15, close #1–#14.
2. WS3 follow-up spike with real Claude/Codex credentials (M1 sign-off): check
   that the injected OpenBot MCP server works with both CLIs, that approvals
   round-trip, and the tool names each engine reports (the runtime mailbox
   special-cases bare `message_user`/`send_message` tool events).
3. Nightly real-credential runs (`OPENBOT_E2E_REAL=1`), Docker computer, Composio,
   Tailscale/Cloudflare.
4. Smaller gaps: `/api/computer/tasks` has no step timeline; `/api/usage` and
   `/api/decisions` are not shown in the UI; code signing/notarization.

## Bloqueos / preguntas abiertas
- Real engines, Jev, Docker, Composio, Tailscale/Cloudflare untested with credentials.
