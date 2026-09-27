# Estado actual

_Última actualización: 2026-09-27 por claude (review + fixes on `claude/openbot-dev-review-vi6h4j`)_

## En curso
- `cursor/v1-integration` (PR #15 → `main`) integrates WS0–WS12; CI green there.
  `main` still has only the initial commit; PRs #1–#14 are superseded by #15.
- `claude/openbot-dev-review-vi6h4j` = `cursor/v1-integration` + review fixes
  (not yet in a PR; CI only runs on PRs, so the 3-OS matrix has not run on it):
  - Jev: no silent fake in production (`KeyedDecisionService`): conservative
    fallback without a key, key read from vault per call, `validateKey` always
    probes Jev. `JEV_BASE_URL` overrides the endpoint.
  - CoS spawn caps: S2 counted refused attempts (1 spawn/day), S3 never
    enforced, `SpawnGate` clock frozen at startup. Fixed.
  - `message.send` wired end to end (`apps/server/src/turn-mailbox.ts`): Jev
    routing / pin / override, vault key or CLI login, OpenBot MCP server injected
    per turn (runtime `prepareTurn` hook), user + bot messages stored, engine
    session resumed from `engine_sessions`, CoS system prompt. Fixed duplicate
    chain insert (crash) and `RepoChainStore` not persisting chain counters.
  - Approvals: `permission_prompt` now waits for the card; HTTP/WS resolution
    wakes the broker (`ctx.onApprovalResolved` → `broker.settleResolved`).
  - Routines: 15-min minimum enforced for every cron form.
  - E2E M1–M4 rewritten to exercise real flows (7 pass, 1 `fixme`).
- Verified locally: 653 unit tests, lint (0 errors), typecheck, format, E2E.
  `apps/desktop` could not be installed here (proxy blocks codeload.github.com).

## Próximos pasos
1. Open a PR from `claude/openbot-dev-review-vi6h4j` (into #15's branch or
   `main` after #15) so the 3-OS CI runs; then merge #15 and close #1–#14.
2. Routine dry run is a stub (`packages/routines/src/runtime-adapter.ts`): it
   never runs the Bot and returns a fixed "Would run routine…" line. Run the
   turn in the `dry_run` chain and collect `action.simulated` as
   `plannedActions` (E2E `test.fixme` in `e2e/tests/m4-routines.spec.ts`).
   Live routine runs still use `engine ?? "fake"`, no MCP servers, fixed auth:
   reuse the turn preparation from `turn-mailbox.ts`.
3. UI ↔ server protocol mismatch: `packages/ui/src/transport/types.ts` sends
   `{type:"message.send", threadId, …}`; the server expects
   `{type:"command", command:"message.send", payload:{botId, text, …}}`.
   Desktop renderer still shows only the harness status shell.
4. Settings (caps S1–S10) are read once at startup (`loadAutonomyCaps`); PUT
   `/api/settings` needs a restart to apply. CoS spawn/notify counters are
   in-memory and reset on restart.
5. WS3 follow-up spike with real Claude/Codex credentials (M1 sign-off).

## Bloqueos / preguntas abiertas
- Real engines, Jev, Docker, Composio, Tailscale/Cloudflare untested with credentials.
- Code signing / notarization not set up.
