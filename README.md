# OpenBot

OpenBot is a self-hosted, messenger-style desktop app (macOS, Windows, Linux) for
managing a small roster of persistent AI **Bots**. Each Bot runs on Claude Code or
Codex; a selective **Chief of Staff** Bot creates and delegates to the roster on its
own; **Jev** (TypeSafe AI System One) is the fast decision layer behind every
engine/model route and every spawn, notify, risk, and loop gate.

You bring your own keys and accounts — OpenBot has no backend and ships no keys.

> **Status**: v1 integration in progress ([PR #15](https://github.com/sanlega/OpenBot/pull/15)).
> Desktop app, harness, setup wizard, and milestone E2E tests are wired; see
> [Run OpenBot v1 on your machine](#run-openbot-v1-on-your-machine) below.

## Run OpenBot v1 on your machine

You need Node 22, pnpm, and your own Claude/Codex logins (or API keys) plus a
TypeSafe (Jev) key. Optional: Docker Desktop for computer use, Tailscale for
phone access.

```sh
corepack enable
pnpm install
pnpm build
pnpm --filter @openbot/desktop start
```

On first launch, the **setup wizard** walks you through TypeSafe, Claude, Codex,
and optional Composio/Tailscale. Keys are stored in a local vault under
`~/.openbot`.

**Try the M1 milestone:** create a bot from the sidebar, open its thread, send a
message, and wait for a reply.

| Step | Action |
|------|--------|
| Install | `pnpm install && pnpm build` |
| Launch | `pnpm --filter @openbot/desktop start` |
| Setup | Complete the wizard (Jev + Claude + Codex) |
| First bot | New bot → name it → send a message |
| Docker (optional) | Install Docker Desktop; set bot computer access to Docker |
| Phone (optional) | Tailscale + Pair device QR in settings |

Headless / browser UI: `pnpm --filter @openbot/server dev serve` then open
[http://127.0.0.1:4577/app](http://127.0.0.1:4577/app).

## Why

Like Grok Bot, but open, local-first, and yours: your keys, your machine (or your own
Docker Desktop / VM for computer use), your Tailscale or Cloudflare Tunnel for remote
access. No custom relay, no vendor lock-in on the model or engine.

## Stack

TypeScript throughout, Node 22 + pnpm workspaces:

| Layer         | Choice                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Desktop shell | Electron + `electron-builder` (macOS dmg, Windows nsis, Linux AppImage/deb)   |
| UI            | React 19, Vite, TanStack Query — shared by the desktop app and the phone PWA  |
| Server        | Fastify + `ws` (HTTP + WebSocket Client API)                                  |
| Storage       | `better-sqlite3` + Drizzle ORM, numbered migrations                           |
| Validation    | `zod` schemas shared as the single source of truth (`packages/contracts`)     |
| Connectors    | `@modelcontextprotocol/sdk` (raw MCP + MCP Registry), Composio                |
| Computer use  | `dockerode` (Docker Desktop provider), Playwright/CDP for browser observation |
| Tests         | Vitest (unit/contract), Playwright Test incl. `_electron` (E2E)               |
| CI            | macOS + Windows + Linux matrix                                                |

See [`.ai/context/10-project.md`](.ai/context/10-project.md) for the package layout
and [`.ai/memory/plans/openbot-v1.md`](.ai/memory/plans/openbot-v1.md) for the full
plan: decisions, shared contracts, every workstream's scope/acceptance criteria, and
the milestone list.

## Development

This repo is developed with [metaharness]([private metaharness repository URL removed]), a
shared AI-agent development harness. If you're a human:

```sh
corepack enable            # or: npm i -g pnpm@10
pnpm install
pnpm build
pnpm test
pnpm lint && pnpm format:check
```

If you're an AI agent (Claude Code, Codex, Cursor, ...): read `AGENTS.md` (or
`CLAUDE.md` for Claude Code) first — it points at `.ai/protocol.md` and the rest of
`.ai/`. Every session should end with `bash .ai/bin/mh handoff` so the next agent (or
the next session) can resume from `.ai/memory/STATE.md` even if this one runs out of
credits.

```sh
bash .ai/bin/mh check       # verifies AGENTS.md/CLAUDE.md/.claude/.agents are in sync
bash .ai/bin/mh brief       # session brief: state, recent decisions, open questions
```

## Repository layout

```
openbot/
  .ai/                metaharness: context, memory, skills, evals, decisions
  packages/           one directory per workstream (see the plan, §3)
  apps/               desktop (Electron), server (headless), pwa
  e2e/                cross-package Playwright scenarios
  images/desktop/     the Docker Desktop computer-use image (WS9)
```

## Roadmap

Workstreams and milestones are tracked in
[`.ai/memory/plans/openbot-v1.md`](.ai/memory/plans/openbot-v1.md). High level:

- **WS0 — Contracts and skeleton** (this PR / the one after bootstrap): shared zod
  contracts, the SQLite/Drizzle schema, fake engine/computer/Jev implementations so
  every other workstream can build and test against the same interfaces with zero
  real credentials, and the package skeletons for WS1–WS13.
- **WS1–WS12**, in parallel against WS0's contracts and fakes: core harness, runtime
  safety, engine adapters, the OpenBot MCP server, the chat UI, the desktop shell,
  the Jev decision service, the Chief of Staff, computer use, the connector catalog,
  remote access/pairing, and routines.
- **WS13** integrates continuously and gates milestones **M0–M5** (skeleton → one Bot
  on desktop → a selective team reachable from the phone → computer use → routines →
  v1).

## Prior art

OpenBot is built from scratch (no vendored code), informed by studying Grok Bot and
similar products. See `.ai/memory/plans/openbot-v1.md` §8–9 for explicit out-of-scope
items and known risks for v1.

## License

MIT.
