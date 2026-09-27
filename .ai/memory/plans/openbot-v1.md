# OpenBot v1 implementation plan

Source: the OpenBot v1 planning pass (Grok Bot feature research, kept outside this
repo). Revised 2026-09-26 to follow both rounds of user decisions on the decision
tables below, sections 9–10, and section 11 (Chief of Staff selectivity). Routines
are back in v1.

- **Repo**: https://github.com/sanlega/OpenBot.
- **This is the working plan.** Update it, and log a decision (`mh decision`), when
  scope changes. Decisions U1–U11 below are logged individually in
  `.ai/memory/DECISIONS.md` as D-001 onward, alongside the engineering decisions
  the bootstrap itself made (harness setup, TypeScript pin, lockfile policy).

## 1. Goal

OpenBot is a desktop app for **macOS, Windows, and Linux**, with the harness embedded, where you chat with a small roster of persistent Bots.
- **Engines**: each Bot runs on **Claude Code or Codex**, and **Jev picks the engine and model**.
- **Chief of Staff (CoS)**: creates and delegates to Bots on its own, but is **deliberately selective**. It creates only the Bots and sends only the messages that are genuinely needed.
- **Messaging**: Bots message each other and can **message you directly**, through a notify gate.
- **Routines**: Bots run **routines** on a schedule or when an event arrives, with a dry-run mode and spend caps.
- **Computer**: Bots share one computer. By default it is a Docker desktop with a live view; your own machine is opt-in. Jev drives it with an ultra-fast, cheap control loop.
- **Phone**: you control everything from your phone through the same Client API, over the LAN or your own **Tailscale or Cloudflare Tunnel**.
- **Bring your own**: you supply every key and account. OpenBot has no backend and ships no keys.

Safety and selectivity are enforced in code, not only in prompts:
- deterministic rules
- Jev gates for risk, bot spawning, and notifications
- approvals
- loop guards
- hard caps on spawns, messages, turns, and spend

## 2. Decisions

### 2.1 User decisions (fixed)
| # | Decision |
|---|---|
| U1 | **Jev is core and required.** It routes engine and model, handles triage and delegation, runs the spawn, notify, risk, loop, and trigger gates, and is the computer-control policy. It sits behind a `DecisionService`, so outages (429/529 errors or timeouts) degrade conservatively instead of failing. Pinned to `jev-1.13.0`. |
| U2 | **Clients**: an Electron desktop app with the harness embedded, and a public Client API used by the phone PWA and by other apps. |
| U3 | **Remote access has no custom relay.** Tailscale is the default, with the harness on the tailnet and `tailscale serve` for HTTPS. Cloudflare Tunnel is the alternative: `cloudflared` runs outbound-only, with Cloudflare Access in front. On top of either, OpenBot keeps its own QR device pairing, device tokens, and end-to-end (E2E) encrypted framing. |
| U4 | **Desktop OS**: macOS, Windows, and Linux ship together in v1, with equal priority. |
| U5 | **Bring your own keys and accounts.** A first-run wizard collects and validates the keys and accounts; secrets live in the OS keychain.<br>• TypeSafe key: required.<br>• Claude: login or Anthropic key.<br>• Codex: ChatGPT login or OpenAI key.<br>• Composio key: optional.<br>• Tailscale or Cloudflare: optional.<br>Engine auth can be set per engine and overridden per Bot. The user's own Claude Code CLI login is fine, with no extra policy gate. |
| U6 | **Computer use is in v1** behind a `Computer` SPI.<br>• Docker desktop: the default provider, with noVNC live view and takeover.<br>• Local machine: opt-in, cross-platform, and "ask every time" by default.<br>Jev runs the fast loop and escalates to the engine or the user. |
| U7 | **Isolation follows Grok Bot**: one shared computer and workspace, with a separate screen per Bot. Bots are not a security boundary, and the UI says so. Per-Bot presets still apply. |
| U8 | **The CoS creates Bots autonomously, but selectively**, and any Bot can message the user directly. There are three layers, and no single layer is trusted alone: (1) a prompt with a "handle it yourself first" ladder, (2) Jev gates on every `create_bot` and `message_user` call, and (3) hard caps in code that Bots cannot see (section 2.2, S1–S10). A refusal is a structured result, not an error. |
| U9 | **Connectors come from a big catalog** behind a `ConnectorProvider` SPI. v1 ships raw MCP plus the MCP Registry, and **Composio**. Pipedream is a later plug-in. Tokens never enter model context. |
| U10 | **Routines are in v1**, triggered by a schedule or an event, with a dry-run mode, spend caps, and run history. |
| U11 | **Build from scratch.** Study prior art, but copy no code. Third-party images and libraries used as dependencies are fine. |

### 2.2 Defaults (overridable)
| # | Topic | v1 default |
|---|---|---|
| O1 | Docker | **Optional.** The app detects Docker or Podman. If one is present, the default computer is the Docker desktop. If not, the app offers an install link or the local-machine provider (with approvals). Chat, engines, connectors, routines, and remote access all work without Docker. |
| O2 | Remote setup | OpenBot detects the `tailscale` CLI and offers "Enable remote" (`tailscale serve --bg` pointing at the loopback port). For Cloudflare, the user pastes a tunnel token and OpenBot runs `cloudflared tunnel run --token` as a child process. Caveat for the UI: Tailscale Personal is free for non-commercial use only. |
| O3 | Managed catalog | **Composio** (free tier: 100K tool calls and 50K triggers a month). Users can register their own OAuth apps to avoid the managed-app limits. |
| O4 | **Jev rate budgets** (separate budgets) | Per-purpose token buckets, sized from the user's key limit (default: 1,000 of the 1,200 req/min).<br>• **Gates**: 250, reserved. Covers risk, spawn, notify, and loop. Nothing else may borrow from it; gates may borrow unused capacity from any bucket.<br>• **Interactive**: 200. Covers triage, delegation, and routing.<br>• **Computer**: 450. Each computer task gets at most 120 req/min, with at most 3 concurrent tasks. It may borrow only from background. When exhausted, the loop slows down rather than skipping gates.<br>• **Background**: 100. Covers trigger matching, attention, and the digest. |
| O5 | Autonomy caps (report §11.4) | S1–S10 below. They live in settings and are never exposed to Bots. |
| O6 | Spawn and notify thresholds (report §11.2–11.3) | Spawn and notify thresholds as in the report; they are starting points, tuned from logged decisions. The uncertain middle band is denied without asking the user. |
| O7 | Routine guardrails | At most 10 routines per Bot and 30 in total. The shortest schedule interval is 15 min. Event cooldown is 60 s. Per-run defaults: $0.50, 200K tokens, 10 turns, 50 computer steps, and 15 min. Per routine: $2 and 24 runs per day. Auto-pause after 3 consecutive failures or capped runs, or after 14 days of user absence. Missed runs are skipped (`catchUp: 'none'`). Every routine's first run is a dry run. |

**Hard caps (S1–S10, from report §11.4)**
| # | Cap | Default |
|---|---|---|
| S1 | CoS-created Bots in the roster (user-created Bots don't count) | 6. At the cap, the refusal reads "reuse or ask the user to archive a bot". |
| S2 | New Bots per rolling 24 h | 2 |
| S3 | Cooldown between spawns | 30 min |
| S4 | Proactive messages per Bot | 3 per hour, 8 per day |
| S5 | Proactive messages across all Bots | 6 per hour |
| S6 | Duplicate window per `dedupe_key` | 6 h |
| S7 | Quiet hours | Off. When set, only time-sensitive messages push; the rest wait. |
| S8 | Spend per Bot per day, and globally per day | Set in the wizard. Suggested: $5 / 1M tokens per Bot, $20 / 5M tokens globally. At the cap, the Bot pauses and sends one blocker message. |
| S9 | Idle Bot review | CoS-created Bots idle for 7 days are listed in the digest as "archive?". |
| S10 | Merge window for the same Bot | 10 min: messages within it are merged into one. |

### 2.3 Engineering defaults
| # | Default |
|---|---|
| E1 | **Stack**: TypeScript throughout.<br>• Runtime and desktop: Node 22, pnpm workspaces, Electron plus `electron-builder`.<br>• UI: React 19, Vite, TanStack Query.<br>• Server and storage: Fastify plus `ws`, better-sqlite3 plus Drizzle, zod, `croner`, `chokidar`.<br>• Integrations: `@modelcontextprotocol/sdk`, `@typesafe-ai/sdk`, `dockerode`, Playwright (CDP), `libsodium-wrappers`.<br>• Tests: Vitest, Playwright Test (including `_electron`).<br>• CI: a macOS, Windows, and Linux matrix. |
| E2 | **Engines** (confirmed by the spike):<br>• Claude: `claude -p` with stream-json input and output, one long-lived process per active Bot session; `--resume` after idle.<br>• Codex: **one shared** `codex app-server` stdio process, with per-Bot MCP set through `thread/start` `config.mcp_servers`.<br>• Both run **on the host** and reuse the host CLI logins.<br>• Their working directory is the shared workspace, which the Docker desktop mounts at `/workspace`.<br>• `--bare` is never used. |
| E3 | **Harness process**: the harness runs in an Electron `utilityProcess`. It also runs headless with `openbot serve`. |
| E4 | **Secrets**: Electron `safeStorage` (Keychain, DPAPI, or libsecret), or a 0600 file when headless. Secrets are injected only as env vars or headers, never into prompts, events, or logs. |
| E5 | **Jev confidence bands**: `auto ≥ 0.9`, `confirm ≥ 0.5`, otherwise `human`, matching metaharness `.ai/jev.json`. Gate-specific thresholds are in O6. |
| E6 | **Permission broker order**: built-in deny → user and always-allow rules → preset → Jev risk gate (it may auto-allow only in the `auto` band with `external_side_effect < 0.2`) → user card. A deny always wins. Computer actions, connector actions, and dry-run simulation all go through the broker. |

## 3. Architecture and repo layout

Each workstream owns its directories. Cross-package imports go only through `@openbot/contracts` and the `CoreContext` service registry.

```
openbot/
  .ai/                         metaharness
  packages/
    contracts/     WS0   zod schemas + TS types for everything in section 4; fixtures
    store/         WS0 schema/migration 0001 · WS1 repositories
    core/          WS1   config, event bus, Client API (HTTP+WS), setup validators, devices, vault, module host
    runtime/       WS2   mailbox, chains, delivery, broker (incl. dry-run simulation), guards, caps, usage
    engines/       WS3   claude/, codex/, auth.ts, detect.ts, conformance.ts   (fake/ = WS0)
    mcp/           WS4   openbot MCP stdio shim + tool handlers + MCP config composer
    decisions/     WS7   DecisionService: Jev client, purpose budgets, fallbacks, question sets, router, log
    cos/           WS8   CoS prompt, spawn gate, notify gate, caps S1–S10, digest
    computer/      WS9   Computer SPI, docker/ + local/ providers, fast loop, takeover   (fake/ = WS0)
    connectors/    WS10  ConnectorProvider SPI, raw MCP + Registry, Composio (tools + triggers)
    remote/        WS11  pairing, device crypto, E2E framing, Tailscale/Cloudflare managers
    routines/      WS12  scheduler, trigger sources, run orchestration, dry-run reports
    ui/            WS5   React app shared by desktop and phone PWA
  apps/
    desktop/       WS6   Electron main/preload, utilityProcess host, tray, notifications, packaging
    server/        WS1   headless `openbot serve|doctor|pair`
    pwa/           WS11  PWA build of packages/ui, served by the harness
  images/desktop/  WS9   Docker desktop image
  e2e/             WS13
```

The data dir (`OPENBOT_HOME`, default `~/.openbot`) holds:
- `openbot.db`
- `logs/threads/*.ndjson`
- `workspace/` (shared; the Docker desktop mounts it at `/workspace`)
- `uploads/`, `trash/`, `vault.bin`, `models.json`
- `screens/<botId>/`
- `routines/<rtnId>/runs/` (dry-run reports and artifacts)

## 4. Shared contracts (WS0 delivers; changes need a coordinator-reviewed PR)

### 4.1 Entities
IDs are prefixed ULIDs: `bot_ thr_ msg_ turn_ evt_ apr_ chn_ rule_ dec_ dev_ con_ ctask_ rtn_ rrun_ tev_`.

- **Bot**:
  - Profile: `id, slug, name, label?, description, avatar, pinned, hidden, isChiefOfStaff, createdBy ('user'|botId), lastActiveAt, archivedAt?`.
  - Engine routing: `routing {mode:'auto'|'pinned', engine?, model?, effort?}`.
  - Auth override: `auth? {claude?, codex?: 'login'|'api_key'}`.
  - Access: `permissionPreset ('read_only'|'workspace_write'|'full')`, `computer ('none'|'docker'|'docker+local')`, `connectors: con_[]`.
  - Limits: `limits {dailyUsd?, dailyTokens?}`.
  - `justification?`, for CoS-created Bots: `{responsibility, whyNotExisting, lifetime, boundary[], userRequested, spawnDecisionId}`. This backs the "Why does this bot exist?" panel.
- **Thread**: one DM thread per Bot (`kind:'dm'`).
- **Message**:
  - `id, threadId, author {type:'user'|'bot'|'system'|'routine', id}, text, attachments[], chainId, hop, replyTo?, createdAt`.
  - Proactive-message fields: `proactive, kind? ('result'|'decision'|'blocker'), options?, deadline?, dedupeKey?`.
  - Delivery fields: `delivery ('delivered'|'held'|'merged'), pushed, notifyDecisionId?`.
  - Held messages appear only under the activity log's "Not delivered" filter and in the digest.
- **Chain**: `id, origin ('user'|'bot'|'routine'), mode ('live'|'dry_run'), routineRunId?, status ('active'|'paused'|'stopped'|'done')`.
  - Counters and limits: `botMessages, turns, usd, tokens, computerSteps, wallMin`.
  - `routineDepth`: a routine run triggered by another routine's events is at depth 1 or more; the maximum is 2.
- **Turn**: `id, botId, chainId, engine, model, effort, routeDecisionId?, sessionId, status, usage`.
- **Approval**: `kind ('tool'|'computer_action'|'connector_action'|'chain_limit'|'bot_request'|'local_computer'|'routine_live'), id, botId, chainId, summary, detail, risk?, status, resolution, expiresAt`.
  - There is no `create_bot` kind: spawns are either allowed or refused, and the user is never asked.
- **Rule**: `scope, match {tool|computerOp|connectorAction: glob, args?}, effect ('allow'|'ask'|'deny'), source`.
- **Device**: `id, name, role ('owner'|'approver'), publicKey, via ('lan'|'tailscale'|'cloudflare'), pairedAt, lastSeenAt, revokedAt?`.
- **Connection**: `id, provider ('mcp'|'composio'), appId, displayName, status, toolMeta {tool: {sideEffect}}, triggers[]`.
- **ComputerTask**: `id, botId, chainId, goal, provider, status, steps, usd`.
- **Routine**:
  - Fields: `id, botId, name, prompt, createdBy ('user'|botId), enabled, liveApproved, pausedReason?, consecutiveFailures, lastRunAt`.
  - Trigger, one of:
    - `{type:'schedule', cron?, at?, timezone, catchUp:'none'|'last'}`
    - `{type:'event', source:'connector'|'webhook'|'file'|'openbot', connectionId?, triggerSlug?, path?, eventType?, filter?, matchInstructions?}`
  - `limits {perRun {usd, tokens, turns, computerSteps, wallMin}, dailyUsd, maxRunsPerDay, cooldownSec}`.
  - Deterministic filter syntax: a JSON path and a regex, `{path, regex}[]`.
  - `matchInstructions` is optional; when set, a Jev `trigger` gate is also applied.
- **RoutineRun**:
  - Fields: `id, routineId, chainId, cause ('schedule'|'event'|'manual'|'test'), triggerEventIds[], dryRun`.
  - `status`: `'queued'|'running'|'done'|'failed'|'skipped'|'capped'`, with `skipReason?`.
  - Results: `usage, resultSummary, plannedActions[]` (dry run only), `startedAt, endedAt`.
- **TriggerEvent**: `id, source, routineId, payloadHash, payloadRef, matched, matchDecisionId?, receivedAt`. The payload hash is used for dedupe.
- **Also**: `EngineSession`, `Decision` (`purpose, provider, model, stateHash, answers, thresholds, band, outcome, feedback?`), `CapCounter` (a rolling-window counter for S1–S10 and O7), `Settings`, and `SetupState`.

### 4.2 Canonical events
Events are persisted with a monotonic `seq`, mirrored to NDJSON, and streamed over the Client API WebSocket.

```ts
type OBEvent<T extends EventType = EventType> = { id; seq; ts; type: T; botId?; threadId?; turnId?; chainId?; payload: EventPayloads[T] };
type EventType =
  | 'message.created' | 'message.delta' | 'message.completed' | 'message.held' | 'message.merged'
  | 'turn.queued' | 'turn.started' | 'turn.completed' | 'turn.failed' | 'turn.interrupted'
  | 'tool.started' | 'tool.completed' | 'action.simulated'
  | 'approval.requested' | 'approval.resolved'
  | 'handoff.sent' | 'handoff.received'
  | 'bot.created' | 'bot.updated' | 'bot.archived' | 'bot.archive_suggested' | 'route.decided'
  | 'gate.decided'                                    // spawn | notify | trigger — allowed/refused, reason, suggestion
  | 'chain.limit_reached' | 'guard.tripped' | 'cap.hit' | 'chain.resumed' | 'chain.stopped'
  | 'attention.changed' | 'notify.requested' | 'digest.posted' | 'usage.recorded' | 'decision.made'
  | 'computer.status' | 'computer.task_started' | 'computer.step' | 'computer.escalated'
  | 'computer.takeover_requested' | 'computer.takeover_ended' | 'computer.task_completed'
  | 'routine.created' | 'routine.updated' | 'routine.deleted' | 'routine.paused' | 'routine.resumed'
  | 'trigger.received' | 'routine.run_queued' | 'routine.run_started' | 'routine.run_completed' | 'routine.run_skipped'
  | 'device.paired' | 'device.revoked' | 'remote.status' | 'connector.connected' | 'connector.disconnected'
  | 'setup.changed' | 'engine.status' | 'error';
```

### 4.3 EngineDriver (WS3 implements; WS2 calls)
```ts
interface EngineDriver {
  id: string;                                              // 'claude' | 'codex' | 'fake'
  detect(): Promise<EngineStatus>;                         // {installed, version, login:{ok, account?}, apiKey:{ok}}
  validateKey(key: string): Promise<{ ok: boolean; reason? }>;   // used by the setup wizard
  listModels(): Promise<ModelInfo[]>;
  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle;
  dispose(): Promise<void>;
}
interface TurnInput {
  bot: Bot; sessionId?: string; text: string; attachments: string[];
  systemPrompt: string; cwd: string; addDirs: string[];
  auth: { mode: 'login'|'api_key'; env: Record<string,string> };
  mcpServers: McpServerSpec[];
  permission: PermissionPreset; allowTools: string[]; denyTools: string[];
  model: string; effort?: 'low'|'medium'|'high';
  limits: { maxSteps: number; maxUsd?: number; maxTokens?: number };
}
interface TurnHooks { emit(e: EngineEvent): void; requestApproval(r: ToolApprovalRequest): Promise<'allow'|'deny'>; }
interface TurnHandle { steer(text: string): Promise<void>; interrupt(): Promise<void>; done: Promise<TurnResult>; }
```
Drivers never touch the DB or the bus. In a dry-run chain, the broker answers approval requests: reads are allowed, and writes and side effects are simulated (see WS2).

### 4.4 DecisionService (WS7 implements; WS2, WS8, WS9, and WS12 call)
```ts
type Purpose = 'route'|'triage'|'delegate'|'risk'|'spawn'|'notify'|'loop'|'attention'|'trigger'|'computer';
type Budget  = 'gates'|'interactive'|'computer'|'background';     // O4; purpose → budget is fixed in code
interface DecisionService {
  decide(req: { purpose: Purpose; state: string; questions: Record<string, Question>; timeoutMs?: number }):
    Promise<{ answers: Record<string, Answer>; provider: 'jev'|'llm'|'heuristic'; model: string; latencyMs: number; decisionId: string }>;
  route(bot: Bot, task: string, ctx: RouteContext): Promise<RouteDecision>;
  band(confidence: number, purpose: Purpose): 'auto'|'confirm'|'human';
  budgets(): Record<Budget, { limitRpm: number; usedRpm: number; queued: number }>;
  validateKey(key: string): Promise<{ ok: boolean; rpmLimit?: number }>;
}
```
`Question` and `Answer` follow Jev's three types: `choice`, `score`, and `noul`. Question sets live in `decisions/questions/*.ts` as typed builders. Every call writes a `Decision` row.

When Jev is unavailable, the conservative fallbacks from report §11.3 apply:
- Spawns are refused unless `user_requested` is true.
- A message is delivered only if its declared `kind` is valid, and the per-Bot message caps are halved.
- Risk never returns `auto`.
- Trigger matching falls back to the deterministic filter only.

### 4.5 Computer SPI (WS9 implements; WS2, WS4, and WS5 consume)
```ts
interface ComputerProvider { id: 'docker'|'local'|'fake'; status(); ensureStarted(); screen(botId): Promise<Screen>; }
interface Screen {
  observe(o?: { mode?: 'dom'|'ax'|'ocr'|'auto' }): Promise<Observation>;  // indexed elements, url, title, screenshotPath
  act(a: Action): Promise<ActResult>;                      // target MUST be an observed element index (or url)
  liveView(): Promise<{ url; token; expiresAt }>;
  takeover(on: boolean): Promise<void>;
}
type Action = { op:'click'|'type'|'key'|'scroll'|'select'|'navigate'|'wait'|'done'|'blocked'; target?: number; text?: string; url?: string };
interface ComputerAgent { runTask(t: { botId; chainId; goal; startUrl?; maxSteps?; provider? }): Promise<ComputerTaskResult>; }
```

### 4.6 ConnectorProvider SPI (WS10 implements; WS4 and WS12 consume)
```ts
interface ConnectorProvider {
  id: 'mcp'|'composio'|string;
  validateKey?(key: string): Promise<{ ok: boolean }>;
  searchCatalog(q: string, page?: number): Promise<CatalogApp[]>;
  connect(appId: string): Promise<{ authUrl?: string; connectionId: string }>;
  listConnections(): Promise<Connection[]>;
  mcpServerFor(botId: string, connectionIds: string[]): Promise<McpServerSpec>;
  toolMeta(connectionId: string): Promise<Record<string, { sideEffect: boolean }>>;
  listTriggers?(connectionId: string): Promise<TriggerDef[]>;                 // e.g. Composio triggers
  subscribeTrigger?(connectionId: string, slug: string, config: unknown,
                    onEvent: (e: { id: string; payload: unknown }) => void): Promise<() => void>;  // outbound only
}
```

### 4.7 Client API (WS1 hosts; WS5, the PWA, and other apps consume)
- **HTTP (`/api`, zod-validated)**:
  - Basics: `health`, `engines`, `models`, `settings` (caps S1–S10 and O7, budgets, and quiet hours; owner devices only).
  - Setup wizard: `setup` returns the status, and `setup/validate {kind:'typesafe'|'anthropic'|'openai'|'claude_login'|'codex_login'|'composio'|'tailscale'|'cloudflare', value?}`.
  - Bots:
    - `bots`: CRUD, plus `duplicate`.
    - `bots/:id/route`: preview or override the engine and model choice.
    - `bots/:id/why`: the justification plus the spawn decision.
  - Threads: `threads/:id/messages?delivery=`, `threads/:id/stop`, `messages/:id/promote|mute` (both recorded as notify-gate feedback), and `uploads`.
  - Activity: `activity?botId&delivery=held`, the "Not delivered" view.
  - Safety: `approvals`, `chains/:id/resume|stop`, `rules`.
  - Computer: `computer/status|start`, `computer/screens/:botId/live|takeover`, `computer/tasks`.
  - Connectors: `connectors/catalog?q=`, `connectors/connect`, `connectors/connections`, `connectors/:id/triggers`, `bots/:id/connectors`.
  - Routines:
    - CRUD: `routines`.
    - Actions: `routines/:id/run {dryRun}`, `routines/:id/pause|resume`, `routines/:id/enable-live`.
    - History: `routines/:id/runs`, `runs/:id` (with `plannedActions`).
    - Webhooks: `POST /hooks/:routineId`. It needs the `X-OpenBot-Hook-Secret` header and is reachable over the LAN, Tailscale, or Cloudflare.
  - Devices: `devices/pair` (QR payload), `devices`, `devices/:id` revoke.
  - Remote: `remote/status`, `remote/tailscale/enable|disable`, `remote/cloudflare {token}`.
  - Audit and usage: `usage`, `audit`, `decisions?purpose&cursor`.
- **WebSocket `/api/ws`**: `{subscribe, since}` gives replay from that point plus live events. It also accepts commands: `message.send`, `approval.resolve`, `turn.stop`, and `routine.run`. Remote devices wrap every frame in E2E encryption (section 4.8).
- **Internal**: `POST /internal/tools/:name`, authenticated with a per-turn `X-OpenBot-Session` token that encodes `{botId, turnId, chainId, mode}`.
- **Device roles**: `approver` devices can read, send messages, resolve approvals, and run routines. Only `owner` devices can change settings, caps, rules, devices, the vault, or remote setup.

### 4.8 Remote access and pairing (WS11)
- **Transports**:
  - `lan`: a direct WebSocket.
  - `tailscale`: the harness is reachable on its tailnet address, or at the `tailscale serve` HTTPS URL.
  - `cloudflare`: through the `cloudflared` hostname, protected by Cloudflare Access.
  - OpenBot runs no relay of its own.
- **QR payload**: `https://<host>/app#pair={hostPub, pairSecret, urls[]}`. The pairing data sits in the URL fragment, so it never reaches any server. `pairSecret` is single-use and expires after 10 min.
- **Handshake and framing**: an X25519 handshake, authenticated by `pairSecret`, issues the device key and token. After that, every HTTP body and WebSocket frame from a remote device is wrapped in libsodium `secretstream`. The E2E layer matters because Cloudflare terminates TLS at its edge.
- **Harness binding**: the harness binds to loopback by default. It serves LAN and tailnet only when remote access is enabled and device auth is on.

### 4.9 OpenBot MCP tools (WS4; injected into every engine session)
Tools marked **CoS only** are injected only into the CoS session. When a gate or cap refuses a call, the tool returns `{allowed:false, reason, suggestion}` rather than an error.

| Tool | Behavior |
|---|---|
| `list_bots`, `get_bot_status` | Roster and per-Bot state. |
| `create_bot {name, description, responsibility, why_not_existing, lifetime:'recurring'\|'project'\|'one_off', boundary[], user_requested, routing?, preset?}` **CoS only** | Runs the caps (S1–S3), then the Jev spawn gate (report §11.2). If allowed, the Bot is created with a Jev route. If refused, the suggestion says which Bot to delegate to, or `cos_itself`. |
| `send_message {bot, text}` | Asynchronous Bot-to-Bot message, with `hop+1`. In dry-run chains it is recorded, not delivered. |
| `message_user {kind:'result'\|'decision'\|'blocker', body, options?, deadline?, dedupe_key}` | Runs the caps (S4–S6, S10), then the Jev notify gate (report §11.3). Outcomes:<br>• Delivered, with a push only if `is_time_sensitive ≥ 0.7`.<br>• Merged into an earlier message from the same Bot.<br>• Held: the tool returns "logged, not delivered". |
| `request_approval {summary, detail}` | Skips the notify gate, but is rate-limited and batched. |
| `computer_task {goal, startUrl?, maxSteps?}`, `computer_screenshot` | Runs the Jev fast loop on the Bot's own screen, or returns a screenshot for escalation. |
| `create_routine {name, prompt, trigger, limits?}` | For the calling Bot. The CoS may also pass `botId` to create one for another Bot. Enforces the O7 caps. Always runs a dry run first. |
| `list_routines`, `update_routine {id, patch}`, `run_routine {id, dryRun}` | Limited to the Bot's own routines; the CoS may act on any. A Bot cannot raise limits above the O7 defaults. |
| `report_done {summary, artifacts?}` | Feeds the CoS digest. |
| `permission_prompt` | Claude `--permission-prompt-tool` only. Routed to the broker. |

## 5. Workstreams

**Order**:
1. **WS0 first** (small, blocking).
2. **WS1–WS12 in parallel**, against the contracts and the fakes: the fake engine, fake computer, fake Jev, fake trigger source, and fake clock.
3. **WS13 integrates** continuously and gates each milestone.

Each workstream gets its own metaharness worktree (`mh session new ws12-routines`) and edits only its own directories.

### WS0: Contracts and skeleton (blocking)
- **Scope**:
  - Monorepo and CI on a **macOS, Windows, and Linux matrix**.
  - `contracts`: all of section 4, including routines, gates, caps, and remote, plus fixtures for every event.
  - `store` migration `0001` with **all v1 tables** (including `routines`, `routine_runs`, `trigger_events`, and `cap_counters`).
  - Fakes:
    - A scripted engine, including an "always reply" loop mode and a "chatty" mode that calls `message_user` often.
    - A computer with DOM fixtures.
    - `fake-jev` (`/v1/systemone` and `/v1/models`, with scriptable answers and injectable 429 responses).
    - A trigger source.
    - A controllable clock.
  - Conformance suite skeletons.
  - An Electron shell and a headless shell.
- **Acceptance**:
  - The build and tests pass on all three OSes.
  - The fakes pass conformance.
  - The desktop shell shows "harness connected".
- **Rule**: after WS0 merges, schema changes need a new numbered migration, reviewed by the coordinator.

### WS1: Core harness
- **Scope**:
  - Config, repositories, and the event bus (persist → NDJSON → fan-out, one transaction per event).
  - The section 4.7 API and WebSocket.
  - Setup-wizard validation endpoints, which call each module's `validate*`.
  - Device tokens and roles, the vault, and the module host (lets other workstreams register routes, e.g. WS12's `/hooks`).
  - `openbot serve|doctor|pair`. `doctor` checks the CLIs and logins, Docker or Podman, `tailscale` and `cloudflared`, and OS permissions.
- **Acceptance**:
  - CRUD works for every entity.
  - The WebSocket replay has no gaps.
  - State survives a restart.
  - The harness never listens beyond loopback unless remote access and device auth are on.
  - An `approver` device cannot change caps.
  - p95 latency from publish to client is under 50 ms.
- **Tests**:
  - `inject` route tests.
  - Bus replay and reconnect.
  - The auth and role matrix.
  - Vault round-trip on all three OSes.

### WS2: Runtime and safety
- **Scope**:
  - **Mailbox and delivery**:
    - The mailbox runs one active turn per Bot, with FIFO queues, user-driven steer or interrupt, and stop.
    - Bot-to-Bot delivery tracks hops.
    - Bot-to-user delivery calls WS8's `NotifyGate` and never sends directly.
  - **Routing hook, sessions, and prompt**:
    - A per-turn routing hook: within the same engine, a model or effort switch is allowed; switching engines needs the `auto` band and seeds a new session.
    - Session mapping.
    - Prompt assembly: the Bot description, the non-CoS rule block from report §11.1, and the shared-computer notice.
  - **Permission broker** (E6):
    - Built-in denies: credential paths, the DB and vault, `sudo`, and `rm -rf` outside the workspace.
    - "Ask" rules: sensitive computer targets (`/pay|buy|send|delete|transfer|submit order|confirm/i`), `sideEffect` connector actions, and local-machine actions.
    - Approvals time out after 30 min.
  - **Dry-run simulation** (`chain.mode = 'dry_run'`):
    - The broker allows read-only tools, `sideEffect:false` connector actions, and computer `observe`, `navigate`, and `scroll`.
    - Everything else is **not executed**. It is recorded as `action.simulated`, and the engine gets "simulated: not executed (dry run)".
    - `message_user`, `send_message`, `create_bot`, and `create_routine` are recorded, not performed.
  - **Loop protection**:
    - Chain limits: `maxHops 4`, `maxBotMessages 20`, `maxTurns 25`, `maxComputerSteps 200`, `maxWallMin 60`, and `routineDepth ≤ 2`.
    - Bot pairs are rate-limited, repeated content trips the guard, and the Jev `loop` check runs.
    - When a guard trips, the chain pauses and a card is shown.
  - **Spend and turn caps (S8)**:
    - Scope: per turn, per Bot per day, and global.
    - Checked before each turn and on every usage event.
    - At a Bot's cap, the Bot pauses and sends one blocker message (through the notify gate, as `kind: 'blocker'`).
  - **`CapCounter` service**: rolling windows, used by WS8 and WS12.
- **Acceptance**:
  - Looping fake Bots get paused.
  - A deny rule beats an always-allow rule.
  - Clicking a "Pay" target always raises a card.
  - A dry-run chain with a fake engine that tries to write, send, and click produces zero side effects, and every attempt appears as an `action.simulated` event.
  - Caps interrupt runs.
- **Tests**:
  - Scenario tests with the fakes and `:memory:` SQLite.
  - Rule-precedence tables.
  - Property tests on the guards.
  - A dry-run leak test that asserts from the fake engine's and fake computer's action logs.

### WS3: Engine adapters and auth
- **Spike status**: done without credentials; results in `internal/engine-spike.md`, fixtures in `internal/engine-fixtures/`. The spike used Claude Code v2.1.283 and codex-cli v0.157.1. Copy the fixtures to `packages/engines/fixtures/` and the decisions to `DECISIONS.md` when the repo exists.
- **Scope**:
  - **`ClaudeDriver`** (confirmed by the spike):
    - **Process**: one long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --replay-user-messages` process per active Bot session. It serves multiple turns over stdin, reusing the same `session_id`.
    - **Resume**: the process can exit when the Bot is idle. `--resume <sid>` in a new process restores the session, which Claude keeps on disk under `~/.claude/projects/`.
    - **MCP and permissions**: `--mcp-config <tmp> --strict-mcp-config` plus `--permission-prompt-tool mcp__openbot__permission_prompt`.
      - Claude's permission system calls `permission_prompt` out of band. It is not in the model's `tools` list, so the driver must not filter or advertise it.
      - Reply format: `content:[{type:'text', text: JSON.stringify({behavior:'allow'|'deny', …})}]`.
    - **Other flags**: preset tools (`--allowedTools`/`--disallowedTools`), `--add-dir`, `--append-system-prompt`, `--model`, `--max-turns`, and `--max-budget-usd` (API-key mode).
    - **Steer and interrupt**: steering writes a user line to stdin; interrupt sends SIGINT.
  - **`CodexDriver`** (confirmed by the spike):
    - **One shared `codex app-server`** for all Bots, with one `CODEX_HOME` and one login. There is no per-Bot `CODEX_HOME`.
    - **Handshake**: `initialize`, then the `initialized` notification. Capture the real `thread.id` from each `thread/start` response; never use a placeholder ID.
    - **Per-Bot MCP**: pass the Bot's `McpServerSpec[]` from WS4 as `thread/start` `config.mcp_servers.<name>`. The spike confirmed these are isolated between threads in the same process. `config` accepts any `config.toml` key path, so the sandbox and approval settings go through it as well.
    - **MCP health**: always call `mcpServerStatus/list({threadId})`. Called without a `threadId`, it returns an empty list.
    - **Resume**: `thread/resume {threadId, excludeTurns:true}`, then page through history with `thread/turns/list` and `thread/items/list`. Full-history hydration is deprecated and slow.
    - **Approvals**: handle the v2 server requests `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and `item/permissions/requestApproval`, and answer with `accept`, `acceptForSession`, `decline`, or `cancel`. Ignore the legacy `execCommandApproval` and `applyPatchApproval`, which `turn/start` turns never send. `item/tool/requestUserInput` and `mcpServer/elicitation/request` become question cards.
    - **Turns**: `turn/start`, `turn/steer`, and `turn/interrupt`.
    - **Protocol types**: generate them at build time with `codex app-server generate-ts --experimental`, and fail CI if they drift from the pinned version.
  - **`detect()`**:
    - Claude: parse `claude auth status --json`.
    - Codex: **text-parse** `codex login status` (it has no JSON output; for example `"Not logged in"`).
    - Runtime signal, which marks the engine unauthenticated: Claude's `result.is_error` / `"error":"authentication_failed"`; Codex's `error` notifications carrying `codexErrorInfo.responseStreamDisconnected.httpStatusCode: 401`. For Codex, stop its retry loop by calling `turn/interrupt`.
  - **`auth.ts`**: login mode or API-key mode, per engine and per Bot.
  - **Wizard support**: `validateKey` and `detect`. On Windows, handle the `claude.cmd` and `codex.cmd` shims. The `doctor` check covers npm-global permission errors: install with a user-owned `npm config set prefix`.
- **Follow-up spike (needs credentials; blocks M1 sign-off, not development)**: run live checks against a real login or key.
  - (a) The Claude `permission_prompt` round trip, including that `deny` actually blocks the tool call.
  - (b) Codex `item/*/requestApproval` actually fires, and which response shape it expects.
  - (c) Codex `turn/steer` and `turn/interrupt`, and Claude stdin steering and SIGINT, during a real running turn.
  - (d) How fine-grained `--include-partial-messages` deltas are.
  - Until these pass, the drivers are built against the schemas and the golden fixtures.
- **Acceptance**: the engine conformance suite passes on all three OSes: stream, resume after a restart, steer, interrupt in under 3 s, approvals, per-thread MCP isolation (Codex), usage, unauthenticated state, and both auth modes.
- **Tests**:
  - Golden replays of the spike fixtures in CI, plus the unauthenticated, 401, and resume fixtures.
  - Schema-drift check against the generated Codex types.
  - Real-CLI conformance with `OPENBOT_E2E_REAL=1`, which covers the follow-up spike items.

### WS4: OpenBot MCP server
- **Scope**:
  - An `openbot-mcp` stdio shim that forwards section 4.9 calls to `/internal/tools/*`.
  - Handlers that delegate to runtime, the CoS gates (WS8), computer, and routines (WS12).
  - `McpComposer.forTurn` injects the CoS-only tools only into the CoS, and adds connector MCP servers.
- **Acceptance**:
  - Every tool works end to end from a fake engine.
  - Forged or expired tokens are rejected.
  - A non-CoS Bot cannot call `create_bot`, even by name.
  - Refusals match `{allowed:false, reason, suggestion}`.
  - Dry-run tokens route to simulation.
- **Tests**: shim-to-server integration, tamper tests, schema snapshots.

### WS5: Chat UI (shared by the desktop app and phone PWA)
- **Scope**:
  - **First-run setup wizard**: collect and validate the TypeSafe key (required), the Claude login or key, the Codex login or key, Composio (optional), remote access (optional), and daily spend caps.
  - **Roster**: badges, a "created by CoS" mark, and archive suggestions.
  - **DM thread**: streaming, tool chips, files, stop and steer, proactive messages with their `kind` and one-tap options, and routine runs labeled "Routine: X".
  - **Cards**: approvals (with a rule preview), chain limits, `routine_live`, handoffs, and a route chip that shows confidence and can be overridden.
  - **Bot profile**: a "Why does this bot exist?" panel showing the justification and spawn probabilities.
  - **Activity log**: includes a "Not delivered" filter, with promote and mute actions.
  - **Daily digest**: rendered as one CoS message.
  - **Computer panel**: noVNC live view, a step timeline, takeover, and the shared-computer banner.
  - **Routines**:
    - List and editor: a schedule builder, plus event-trigger pickers for connector triggers, webhook URL and secret, file path, and OpenBot event.
    - "Test run" and "Dry run" buttons, and "Enable live".
    - Run history: status, cost, and planned actions.
    - Pause and resume.
  - **Other screens**: Approvals, Usage, Audit, Decisions, Connector catalog, Devices and Remote (QR, Tailscale and Cloudflare status), and Settings (caps S1–S10 and O7, budgets, quiet hours).
  - Mobile-first, with Cmd+K.
- **Contract**: only section 4.7, through a `Transport` (`local`, `lan`, `tailscale`, or `cloudflare`, with E2E framing from WS11). State is a reducer over `OBEvent`s. Development uses MSW plus fixture replay.
- **Acceptance**:
  - Every event type renders.
  - At phone width, the wizard, approvals, takeover, routine dry-run reports, and "Not delivered" all work.
  - No duplicates after a reconnect.
- **Tests**: Vitest plus Testing Library, and Playwright at desktop and mobile widths (in WS13).

### WS6: Desktop shell (Electron, three OSes)
- **Scope**:
  - Harness in a `utilityProcess`, restarted automatically if it crashes.
  - Preload bridge.
  - Tray on each OS, with start at login.
  - OS notifications only for `notify.requested` with `pushed:true`. Deep links use `openbot://`.
  - `safeStorage` vault.
  - OS permission prompts for the local provider: macOS Screen Recording and Accessibility, and Linux Wayland portal notes.
  - `electron-builder` packages:
    - macOS: dmg, universal build.
    - Windows: nsis, x64 and arm64.
    - Linux: AppImage and deb.
  - Signing and notarization from CI secrets.
- **Acceptance**:
  - On each OS: closing the window keeps the Bots running, a killed harness restarts, and a notification click opens the right thread.
  - Installers build for all three OSes in CI.
- **Tests**: Playwright `_electron` smoke tests on the three-OS matrix.

### WS7: Jev DecisionService and model router
- **Scope**:
  - **`JevClient`**:
    - Pinned model, with 429/529 retry plus jitter.
    - Timeouts: 1.5 s, or 400 ms for `computer`.
    - **Purpose budgets (O4)**: separate token buckets, borrowing rules, and a reserved share for gates. The limit is auto-sized from the key's reported limit or from 429 responses.
  - **Fallbacks**:
    - An LLM one-shot through `claude -p --json-schema` or `codex exec --output-schema`, used only for route, triage, and delegate.
    - Heuristics.
    - The conservative fallback rules from section 4.4.
  - **Question-set builders**:
    - Route: a `choice` over `models.json`, plus `complexity` and `needs_computer`.
    - Triage, delegate, risk, loop, attention, and computer.
    - Trigger: the `matches_trigger` noul.
    - The **spawn** and **notify** question sets from report §11.2–11.3. WS8 owns their decision rules.
  - **State builders** that mark untrusted text.
  - The decision log, with `outcome` and `feedback`.
- **Acceptance**:
  - During a fake-jev outage, every purpose degrades conservatively.
  - In a load test with 50 Bots and 3 concurrent computer tasks, **gate p95 latency stays under 600 ms**, and no gate request is ever queued behind computer requests.
  - All decisions are logged.
- **Tests**:
  - Budget and borrowing unit tests.
  - Retry tests against fake-jev.
  - Labeled eval sets: route, triage, and delegate, plus the **spawn gate** (about 40 cases: one-off vs. recurring, duplicate, user-requested) and the **notify gate** (about 60 cases: result, decision, blocker, chatter, duplicate). They run with real Jev when a key is present. They report scores but don't gate CI.

### WS8: Chief of Staff and selectivity
- **Scope**:
  - **First-run CoS**: the report's §11.1 system prompt, with the ladder "answer, then do it yourself, then delegate to an existing Bot, then create". The roster and remaining limits are filled in each turn.
  - **Inbound pipeline**: triage, then either a DB-answered status reply, stop, or delegate hint to the engine.
  - **`SpawnGate`**: checks S1–S3 through `CapCounter`, then the Jev spawn questions, then the §11.2 rule in code. Refusals carry a suggestion.
  - **`NotifyGate`**: checks S4–S7 and S10, then the Jev notify questions, then the §11.3 rule in code. The result is delivered (push only if time-sensitive), merged, or held.
  - **Daily digest** (default 18:00, configurable): one CoS message listing silent completions, held messages, routine results, and archive candidates (S9).
  - **Tunability**: promote and mute actions are recorded as gate feedback, and every threshold is a setting.
- **Acceptance**:
  - A one-off request leads to no spawn: the CoS does it itself or delegates.
  - An explicit user request, or recurring work with a distinct boundary, leads to a spawn.
  - A third spawn within 24 h, or one within 30 min of the last, is refused.
  - Progress chatter is held, and a result is delivered.
  - A duplicate `dedupe_key` within 6 h is held.
  - A seventh proactive message within an hour, across all Bots, is held.
  - One digest per day.
- **Tests**:
  - Pipeline and gate scenarios with the chatty fake engine and scripted fake-jev.
  - A property test that no sequence of calls can exceed S1–S6.

### WS9: Computer use
- **Scope**:
  - **`images/desktop`**: Xvfb, noVNC, Chromium, xdotool, AT-SPI, and OCR. A Node control daemon runs per-Bot displays (`maxScreens 4`, LRU). `/workspace` is a bind mount. Built for amd64 and arm64. The spike compares it against `trycua/cua-xfce`.
  - **`DockerProvider`**: `dockerode` against Docker or Podman, with loopback ports, tokenized noVNC through the harness proxy, and stop after idle. On macOS and Windows the first start is slower (a VM); the UI shows progress.
  - **`LocalProvider`** (opt-in, **cross-platform**):
    - A sidecar driver for macOS, Windows, and Linux (X11; Wayland is best-effort). The spike picks cua-driver or GhostDesk.
    - "Ask every time" through the broker.
  - **Observation**: DOM over CDP, then the accessibility tree (AX, UIA, or AT-SPI), then OCR.
  - **Fast loop**:
    - Steps: observe, one Jev op-and-target choice among observed indices, an LLM only for free text, broker check, execute, verify.
    - Escalation: below `confirm`, on a stall, on `blocked`, or at `maxSteps`, it hands off to the engine with a screenshot.
    - Passwords, 2FA, CAPTCHAs, and payments go to takeover.
    - The loop runs only against the **computer** Jev budget.
- **Acceptance**:
  - The eval suite reaches at least 80% of 20 tasks, with a median under $0.01 and under 1 s per step.
  - No action ever targets an element that wasn't observed.
  - A "Pay" action raises a card.
  - Live view works on desktop and phone.
  - The local provider works on all three OSes (Linux X11), and never acts without approval by default.
- **Tests**:
  - Tests against the fake computer.
  - The nightly eval suite with real Jev.
  - An image smoke test.
  - Local-provider smoke tests per OS.

### WS10: Connector catalog
- **Scope**:
  - **`McpProvider`**: manual stdio or HTTP servers, MCP Registry browsing, and vault-injected secrets.
  - **`ComposioProvider`**:
    - `validateKey`, toolkit search, per-user OAuth (with bring-your-own OAuth app), and per-Bot MCP servers with only the enabled actions.
    - The `sideEffect` flag drives the broker.
    - **Triggers**: `listTriggers` and `subscribeTrigger` over Composio's outbound realtime subscription, so no inbound port is needed; polling is the fallback.
- **Acceptance**:
  - A Bot uses one raw MCP app and one Composio app.
  - Disabling a connector removes its tools on the next turn.
  - A Composio trigger delivers an event to `onEvent` within 10 s.
  - A secrets grep over the DB, logs, and NDJSON is clean.
- **Tests**: mock Composio (tools and trigger stream), a local MCP test server, and a redaction grep.

### WS11: Remote access and pairing
- **Scope**:
  - **`packages/remote`**: pairing, the X25519 handshake, device tokens, and `secretstream` framing (section 4.8).
  - **`TailscaleManager`**: detect the CLI, report status, enable or disable `tailscale serve --bg` to loopback, and list tailnet URLs.
  - **`CloudflareManager`**: take a tunnel token, supervise `cloudflared` as a child process, and check the Access policy (show a warning if Access is missing).
  - **`apps/pwa`**: the UI build served by the harness at `/app`, with a manifest, service worker, pairing screen, and the device key in IndexedDB.
  - Device revocation.
- **Acceptance**:
  - A phone pairs by QR and approves a card over the LAN, over Tailscale, and over Cloudflare Tunnel.
  - Frames sent through Cloudflare are unreadable without the device key, verified with a proxy capture test.
  - A revoked device is refused within 1 s.
  - The pairing secret works only once.
  - The PWA installs over `tailscale serve` HTTPS.
- **Tests**:
  - Crypto test vectors and tamper and replay tests.
  - Manager tests against faked CLIs.
  - A Playwright mobile pairing flow.
  - Optional real-network runs nightly.

### WS12: Routines and scheduling
- **Scope**:
  - **Scheduler**: `croner` in the user's timezone, with `once-at`, and missed runs handled per `catchUp`.
  - **Trigger sources**, all behind one `TriggerSource` interface:
    - Connector triggers, through the WS10 `subscribeTrigger`.
    - Webhooks: the `/hooks/:routineId` route with a secret, rate-limited to 60 per minute.
    - Workspace file watch (`chokidar`, debounced).
    - OpenBot events: for example `routine.run_completed` or `report_done` from another Bot. Events from a routine's own chain are ignored.
  - **Matching**:
    1. Dedupe by `payloadHash`.
    2. Apply the deterministic `filter`.
    3. If `matchInstructions` is set, run the Jev `trigger` gate (background budget). `auto` runs the routine; anything lower is skipped and logged.
  - **Storm control**:
    - Cooldown per routine.
    - At most 1 queued run per routine; later events coalesce into it, up to 20 event IDs.
  - **Runs**:
    - Each run creates a chain with `origin: 'routine'`, the per-run limits, and `routineDepth`.
    - The prompt includes the trigger payload, marked `UNTRUSTED`.
    - Results go through the **notify gate**. Routine results are silent by default and appear in the digest, unless the Bot sends a `result`, `decision`, or `blocker` that passes the gate.
  - **Dry-run mode**:
    - The run uses `chain.mode = 'dry_run'` (WS2 simulation).
    - The report lists planned actions, reads performed, and estimated cost.
    - Every routine's **first run is a dry run**.
    - A routine goes live automatically if its dry run planned no side-effect actions. Otherwise it raises a `routine_live` approval card.
    - The user can run a dry run at any time.
    - "Test run" executes live, once, under the same caps.
  - **Spend caps (O7)**:
    - Before a run, check the per-routine, per-Bot (S8), and global remaining budgets. If any remaining budget is below the per-run cap, the run is `capped` and skipped.
    - During a run, the per-run limits interrupt the chain.
    - `maxRunsPerDay` applies.
    - Auto-pause after 3 consecutive failures or capped runs, or after 14 days of user absence.
    - All routine spend counts toward the Bot and global caps.
  - **History**: the last 50 runs per routine, with trigger events kept for 7 days.
- **Acceptance**:
  - With a fake clock, a cron routine fires within 1 s of its scheduled time.
  - A new routine's first run is a dry run, with zero side effects and a planned-actions report.
  - A routine whose dry run shows a side effect needs the `routine_live` card.
  - A run that hits the per-run cap is interrupted and marked `capped`.
  - With the daily budget exhausted, the next run is `skipped: capped`.
  - Ten webhook events in 5 s produce one run.
  - A non-matching event is dropped, with a logged `trigger` decision.
  - A routine that triggers itself through OpenBot events stops at depth 2.
  - Restarts neither lose nor double-fire runs.
- **Tests**:
  - Fake-clock scheduler tests.
  - A fake trigger source.
  - Dry-run leak tests using WS2's harness.
  - Cap and storm property tests.
  - Restart tests.

### WS13: Integration, E2E, release
- **Scope**:
  - Wire the modules into the desktop app and the headless server.
  - Own the milestone scenarios as Playwright E2E tests: with fakes in CI on all three OSes, and nightly with real engines, Jev, Docker, Composio, and Tailscale.
  - Release CI: three-OS installers and the desktop image.
  - A README quickstart, organized around the setup wizard.
  - Prior-art acknowledgements.
- **Acceptance**: every milestone passes.

## 6. Milestones (integration gates)

| Milestone | Scenario that must pass | Workstreams involved |
|---|---|---|
| **M0 Skeleton** | The monorepo builds and tests on macOS, Windows, and Linux. The fakes pass conformance. The Electron shell shows "harness connected". | WS0 |
| **M1 One bot on desktop** | On each OS, the setup wizard validates the TypeSafe key and either the engine logins or the API keys. Create a Bot; Jev picks its engine and model, shown in a route chip that can be overridden. Chat with a Claude Bot and a Codex Bot. Approve and deny a file write. Stop or steer mid-turn. Restart the app and the session resumes. The WS3 follow-up spike (live approvals, steering, and interrupts) passes with real credentials. | WS1, WS2, WS3, WS5, WS6, WS7 |
| **M2 Selective team and phone** | A one-off request is done by the CoS or an existing Bot, with no spawn. A recurring request with a distinct boundary spawns a Bot, and its "why" panel shows the justification. A third spawn within 24 h is refused, with a suggestion. A chatty Bot's progress messages are held; its result is delivered, and it pushes only if time-sensitive. The daily digest lists what was held. Looping Bots pause, and a daily spend cap blocks new turns. A phone pairs by QR and approves a card over Tailscale and over Cloudflare Tunnel. | + WS4, WS8, WS11 |
| **M3 Computer** | A Bot finishes a browser task on its own Docker screen through the Jev fast loop, with live view on desktop and phone. A login page triggers takeover, and a blocked task escalates. The local provider works when opted in, asking every time, on all three OSes. During a heavy computer loop, gate latency stays within budget. | + WS9 |
| **M4 Routines** | The user asks for a daily 08:00 summary, and the owning Bot calls `create_routine`. The first run is a dry run: planned actions such as "would send email" are listed, and nothing is executed. Because a side effect was planned, the user taps "Enable live". A live run that exceeds its per-run cap is interrupted and marked `capped`. An event routine fires on a Composio "new GitHub issue" trigger and on a webhook. Jev drops a non-matching event, and a burst of 10 events coalesces into one run. Results arrive through the notify gate or the digest. Run history shows the status and cost of every run. | + WS10, WS12 |
| **M5 v1** | A Bot uses a Composio app and a raw MCP server, and no secrets leak. Installers ship for macOS, Windows, and Linux. The computer eval suite and the spawn and notify gate evals meet their targets. | + WS13 |

## 7. Test strategy (cross-cutting)
- **Fakes first**: engine (including loop and chatty modes), computer, fake-jev (with injectable 429s), trigger source, and clock. CI needs no real credentials.
- **Unit tests**: Vitest in every package, on `:memory:` SQLite with a fake clock, across the three-OS CI matrix.
- **Contract tests**: zod fixtures, conformance suites for `EngineDriver` and `ComputerProvider`, and MCP schema snapshots.
- **Golden tests**: recorded CLI transcripts (`pnpm fixtures:record`).
- **Scenario and property tests**: loops, caps S1–S10, the spawn and notify gates, approvals, dry-run leak tests, trigger storms, routine depth, restarts, and engine switches.
- **Evals** (reported, not gating): Jev routing, triage, and delegation; the spawn and notify gates; and the computer task suite. Held-message promote and mute feedback is folded back into these sets.
- **End-to-end**: Playwright `_electron` and mobile viewports. Fakes run in CI on all three OSes; the real stack runs nightly.
- **Security**: deny-rule tables, token and pairing tamper tests, E2E framing through a Cloudflare-style proxy, webhook-secret tests, and a secrets grep.

## 8. Out of scope for v1
- Native iOS and Android apps, and push services beyond OS notifications plus the PWA.
- Messaging bridges.
- Group chats, threads, and reactions.
- Skills and teach-by-demo.
- Pipedream.
- More engines and computer providers (E2B, cua cloud, VMs).
- A custom or hosted relay.
- Long-term memory and search.
- Templates and sharing.
- Multi-user teams.
- OpenTelemetry export.

## 9. Risks
- **One Jev key serves every purpose**: separate budgets (O4) protect the gates. Computer loops slow down instead of starving the gates, and the load test in WS7 enforces this.
- **Cross-platform local control**: Wayland input restrictions, Windows UIPI and UAC prompts, and the macOS TCC permission prompts. Mitigations: an X11-first Linux target, guided permission flows, and keeping the provider opt-in.
- **Docker Desktop on macOS and Windows**: VM startup time and image size. Mitigations: arm64 and amd64 images, a 4-screen cap, idle stop, and Podman support.
- **Remote access**: Tailscale Personal is non-commercial only, and Cloudflare terminates TLS at its edge. Mitigations: app-level pairing plus E2E framing, and the warning when Cloudflare Access is missing.
- **Gate thresholds are guesses**: they are logged with probabilities, tunable in Settings, and backed by promote and mute feedback and eval sets.
- **Unattended routine spend and side effects**: first-run dry runs, a `routine_live` approval for side effects, per-run and daily caps, auto-pause, and storm control.
- **Codex MCP per Bot**: *resolved by the spike.* `thread/start` `config.mcp_servers` is isolated per thread, so one shared app-server is enough and a per-Bot `CODEX_HOME` is unnecessary.
- **Live engine behavior is not yet verified**: approval round trips (the Claude `permission_prompt` and Codex `item/*/requestApproval`), steering, interrupts, and delta granularity have only been checked structurally, because the spike VM had no credentials. Mitigation: the WS3 follow-up spike and `OPENBOT_E2E_REAL` conformance runs gate M1 sign-off. If a gap shows up, fallbacks are available: Claude's Agent SDK `canUseTool` for approvals, and interrupt-then-requeue for steering.
- **CLI protocol drift**: two legacy Codex approval methods (`execCommandApproval`, `applyPatchApproval`) sit alongside v2, and full-history resume is deprecated. Mitigations: pinned minimum versions in `doctor` (Claude Code 2.1.283, codex-cli 0.157.1), types generated from `codex app-server generate-ts`, a schema-drift check in CI, and golden fixtures.
- **Shared computer blast radius** (accepted in U7): mitigated by the broker, "ask" rules, presets, and a UI notice.
