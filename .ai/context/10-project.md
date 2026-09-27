# Project

- **Name**: OpenBot
- **Goal**: an open harness like Grok Bot — a messenger-style desktop app (macOS,
  Windows, Linux) for managing a small roster of persistent AI Bots, each on a
  configurable engine (Claude Code CLI or Codex CLI), led by a selective Chief of
  Staff Bot, with Jev (TypeSafe AI System One) as the fast decision layer behind
  every spawn, notify, risk, and loop gate. Bring-your-own keys/accounts; no backend,
  no bundled keys.
- **Stack**: TypeScript throughout. Node 22 + pnpm workspaces + Electron
  (`electron-builder`) for the desktop shell. React 19 + Vite + TanStack Query for
  the UI (shared by desktop and the phone PWA). Fastify + `ws` for the server and
  Client API. `better-sqlite3` + Drizzle for storage. `zod` for schemas/validation.
  `@modelcontextprotocol/sdk`, `dockerode`, Playwright (CDP) for connectors/computer
  use. Vitest + Playwright Test for tests. CI runs a macOS/Windows/Linux matrix.

## Architecture

Monorepo, `packages/*` + `apps/*`, one directory per workstream (WS0–WS13). Cross-
package imports go only through `@openbot/contracts` (zod schemas + TS types for
every entity, event, and SPI) and a `CoreContext` service registry — no package
reaches into another package's internals directly.

Key paths:
- `packages/contracts` — shared zod schemas/types (bots, threads, messages, chains,
  approvals, routines, events, connector catalogue shapes, `EngineDriver`,
  `DecisionService`, `Computer` SPIs) plus fixtures. Changing this needs a coordinator-reviewed
  PR (see `.ai/memory/plans/openbot-v1.md` §4).
- `packages/store` — SQLite schema, Drizzle migrations (`migrations/0000_init.sql` = all v1 tables),
  repositories.
- `packages/core` — config, event bus, Client API (HTTP+WS), setup validators,
  devices, vault, module host.
- `packages/runtime` — mailbox, chains, delivery, permission broker (incl. dry-run
  simulation), loop guards, caps, usage.
- `packages/engines/*` — separate workspace packages: `claude/`, `codex/`
  (`@openbot/engines-claude|codex`), `common/`, `conformance/` (shared driver
  test suite), and `fake/` (WS0), which implements `EngineDriver` for CI without
  credentials. Fakes sit one level deep (`packages/*/*` is a workspace glob).
- `packages/decisions` — `DecisionService`: Jev client, purpose budgets, fallbacks,
  question builders, decision log.
- `packages/cos` — Chief of Staff prompt, `SpawnGate`, `NotifyGate`, caps S1–S10,
  daily digest.
- `packages/computer` — broker, the fast observe→decide→act loop, takeover;
  providers are their own packages: `docker/`, `local/`, `fake/`
  (`@openbot/computer-docker|local|fake`).
- `packages/mcp` — the OpenBot MCP server that is injected into every engine turn:
  stdio shim (`shim/stdio.ts`) → internal HTTP tool routes on the harness, session
  tokens per turn, tool definitions (base vs CoS-only tools), per-turn MCP config
  composer.
- `packages/testkit` — fake clock, fake trigger source, conformance helpers.
- `packages/connectors` — connector service: curated MCP catalogue, MCP Registry (community), per-Bot MCP servers.
- `packages/remote` — pairing, device crypto, E2E framing, Tailscale/Cloudflare
  managers.
- `packages/routines` — scheduler, trigger sources, run orchestration, dry-run
  reports.
- `packages/ui` — the React app shared by `apps/desktop` and `apps/pwa`.
- `apps/desktop` — Electron main/preload, tray, packaging.
- `apps/server` — headless `openbot serve|doctor|pair`.
- `apps/pwa` — PWA build of `packages/ui`.
- `e2e/` — cross-package Playwright scenarios.

### How it is wired at runtime

`apps/server/src/bootstrap.ts` (`bootstrapHarness`) is the composition root. Both
`openbot serve` and the Electron main process call it: it takes a `CoreContext`
(from `@openbot/core`: store repos, event bus, vault, config, Fastify HTTP+WS API)
and plugs in the runtime, CoS gates/caps, MCP services, connectors, routines,
remote, and the digest. A chat turn goes UI → Client API → `turn-mailbox.ts`
(`createTurnMailbox`/`createTurnBuilder`: Jev routing, engine auth, session resume
from `engine_sessions`, CoS system prompt) → runtime mailbox → `EngineDriver`. The
engine calls back into OpenBot only through the injected MCP server; tool calls
that need a human go through the runtime permission broker, which parks the turn
until an approval card is resolved over HTTP/WS (`ctx.onApprovalResolved`). All
state changes are published as events on the bus and streamed to UI clients after a
WS `subscribe` (ordering is not guaranteed; see LESSONS.md).

The UI (`packages/ui`) talks only to the Client API; `packages/ui/src/api/adapters.ts`
maps harness responses to UI shapes, and the UI's mock server must speak the same
protocol as the real one (the browser E2E in `e2e/tests/` runs the UI against the
real server). The fake engine understands directives in messages for tests:
`@tool <name> <json>` and `@approve <tool> <json>`.

Full plan (decisions, contracts, workstream scopes/acceptance criteria, milestones):
`.ai/memory/plans/openbot-v1.md`. Decisions are logged incrementally in
`.ai/memory/DECISIONS.md` (`mh decision`).
