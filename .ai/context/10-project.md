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
  approvals, routines, events, `EngineDriver`, `DecisionService`, `Computer`,
  `ConnectorProvider` SPIs) plus fixtures. Changing this needs a coordinator-reviewed
  PR (see `.ai/memory/plans/openbot-v1.md` §4).
- `packages/store` — SQLite schema, Drizzle migrations (`0001` = all v1 tables),
  repositories.
- `packages/core` — config, event bus, Client API (HTTP+WS), setup validators,
  devices, vault, module host.
- `packages/runtime` — mailbox, chains, delivery, permission broker (incl. dry-run
  simulation), loop guards, caps, usage.
- `packages/engines` — `ClaudeDriver`/`CodexDriver` (`claude/`, `codex/`), `auth.ts`,
  `detect.ts`, `conformance.ts`; `fake/` (WS0) implements the same `EngineDriver`
  interface for CI without credentials.
- `packages/decisions` — `DecisionService`: Jev client, purpose budgets, fallbacks,
  question builders, decision log.
- `packages/cos` — Chief of Staff prompt, `SpawnGate`, `NotifyGate`, caps S1–S10,
  daily digest.
- `packages/computer` — `Computer` SPI, `docker/`/`local/` providers, the fast
  observe→decide→act loop, takeover; `fake/` (WS0) for CI.
- `packages/connectors` — `ConnectorProvider` SPI: raw MCP + MCP Registry, Composio.
- `packages/remote` — pairing, device crypto, E2E framing, Tailscale/Cloudflare
  managers.
- `packages/routines` — scheduler, trigger sources, run orchestration, dry-run
  reports.
- `packages/ui` — the React app shared by `apps/desktop` and `apps/pwa`.
- `apps/desktop` — Electron main/preload, tray, packaging.
- `apps/server` — headless `openbot serve|doctor|pair`.
- `apps/pwa` — PWA build of `packages/ui`.
- `e2e/` — cross-package Playwright scenarios.

Full plan (decisions, contracts, workstream scopes/acceptance criteria, milestones):
`.ai/memory/plans/openbot-v1.md`. Decisions are logged incrementally in
`.ai/memory/DECISIONS.md` (`mh decision`).
