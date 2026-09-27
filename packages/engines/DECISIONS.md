# Engine adapters decisions (WS3)

## E-WS3-001 · One shared Codex app-server, per-thread MCP

- **Date**: 2026-09-27
- **Context**: Engine spike (`internal/engine-spike.md`) confirmed `thread/start` `config.mcp_servers` isolates MCP between threads in one process.
- **Decision**: `CodexDriver` keeps a single shared `codex app-server` child process; each Bot gets its own thread with MCP injected at `thread/start`. No per-Bot `CODEX_HOME`.
- **Consequences**: WS4's `McpComposer` passes `McpServerSpec[]` into `TurnInput`; `mcpServerStatus/list` is always scoped with `{ threadId }`.

## E-WS3-002 · Claude long-lived stream-json session per Bot

- **Date**: 2026-09-27
- **Context**: Plan §5 WS3 / spike fixture `claude-long-lived-process-two-turns.jsonl`.
- **Decision**: `ClaudeDriver` keeps one long-lived `claude -p --input-format stream-json --output-format stream-json` subprocess per active session key (`sessionId ?? bot.id`). Idle processes may exit; resume via `--resume <sid>`.
- **Consequences**: steering writes stream-json user lines to stdin; interrupt sends SIGINT; `permission_prompt` is wired via `--permission-prompt-tool` but not advertised to the model.

## E-WS3-003 · Golden fixture replay gates CI without credentials

- **Date**: 2026-09-27
- **Context**: Spike fixtures under `packages/engines/fixtures/` have no live credentials; real CLI behavior is unverified until M1 follow-up spike.
- **Decision**: `@openbot/engines-conformance` runs the shared `runEngineDriverConformance` suite against fixture-backed drivers, plus parser golden tests on every JSONL transcript. Real CLI conformance is opt-in via `OPENBOT_E2E_REAL=1`.
- **Consequences**: Codex schema drift is checked against committed `fixtures/codex-schema/ServerRequest.json` oneOf method enums.
