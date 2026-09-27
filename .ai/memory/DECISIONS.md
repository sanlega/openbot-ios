# Registro de decisiones

Decisiones de arquitectura y convenciones. La más reciente, al final.
Formato: fecha, contexto, decisión, consecuencias.

## D-001 · U1: Jev is core and required

- **Fecha**: 2026-09-27

- **Context**: OpenBot v1 plan §2.1. Jev routes engine/model, handles triage/delegation, and runs the spawn/notify/risk/loop/trigger gates and computer-control policy.
- **Decision**: Jev sits behind a `DecisionService`, pinned to `jev-1.13.0`; outages (429/529/timeouts) degrade conservatively (never fail open) per §4.4.
- **Alternatives discarded**: per-purpose ad hoc LLM calls with no shared abstraction; skipping Jev and hard-coding heuristics.
- **Consequences**: every gate call goes through `packages/decisions` (WS7); WS0 ships a fake Jev server so every other workstream can build against the same contract with zero credentials.

## D-002 · U2: Clients are Electron desktop + public Client API

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: an Electron desktop app with the harness embedded, plus a public Client API (HTTP+WS, §4.7) consumed by the phone PWA and other apps.
- **Consequences**: `packages/core` hosts the API; `apps/desktop` and `apps/pwa` are separate thin shells over `packages/ui`.

## D-003 · U3: Remote access has no custom relay

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.8.
- **Decision**: Tailscale is the default (harness on the tailnet, `tailscale serve` for HTTPS); Cloudflare Tunnel is the alternative (`cloudflared` outbound-only + Cloudflare Access). OpenBot's own QR pairing, device tokens, and E2E framing sit on top of either.
- **Consequences**: `packages/remote` (WS11) never runs a server-side relay; Cloudflare's edge TLS termination is why the E2E layer is mandatory, not optional.

## D-004 · U4: Desktop OS parity

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: macOS, Windows, and Linux ship together in v1 with equal priority.
- **Consequences**: CI runs a three-OS matrix from WS0 onward; no OS-specific feature gating in v1 scope.

## D-005 · U5: Bring your own keys and accounts

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: a first-run wizard collects/validates the TypeSafe key (required), Claude login-or-key, Codex login-or-key, Composio (optional), Tailscale/Cloudflare (optional); secrets live in the OS keychain (Electron `safeStorage`) or a 0600 file when headless. The user's own Claude Code CLI login is accepted with no extra policy gate.
- **Consequences**: OpenBot ships no backend and no bundled keys; `packages/engines/auth.ts` supports both login and API-key modes per engine, overridable per Bot.

## D-006 · U6: Computer use behind a Computer SPI

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.5.
- **Decision**: Docker desktop is the default provider (noVNC live view, takeover); the local machine is opt-in, cross-platform, and 'ask every time' by default. Jev runs the fast loop and escalates to the engine or the user.
- **Consequences**: `packages/computer` (WS9) implements both providers behind one SPI; WS0 ships a fake computer with DOM fixtures so other workstreams don't need Docker to build against it.

## D-007 · U7: Isolation follows Grok Bot (shared computer)

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §9 Risks.
- **Decision**: one shared computer and workspace, with a separate screen per Bot. Bots are not a security boundary and the UI says so explicitly. Per-Bot presets still apply.
- **Consequences**: the permission broker (WS2), 'ask' rules, and a persistent UI notice are the actual mitigations, not process isolation.

## D-008 · U8: Chief of Staff is autonomous but selective

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.9, §11.1-11.3 (external report).
- **Decision**: three independent layers, none trusted alone: (1) a prompt ladder ('handle it yourself first'), (2) Jev gates on every create_bot/message_user call, (3) hard caps in code (S1-S10) that Bots cannot see. A refusal is a structured result `{allowed:false, reason, suggestion}`, never an error.
- **Consequences**: `packages/cos` (WS8) owns SpawnGate/NotifyGate; the caps live in Settings and are never exposed to Bots or the model.

## D-009 · U9: Connectors come from a big catalog

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.6.
- **Decision**: a `ConnectorProvider` SPI; v1 ships raw MCP + the MCP Registry, plus Composio. Pipedream is out of scope for v1. Tokens never enter model context.
- **Consequences**: `packages/connectors` (WS10) implements both providers behind the SPI; the `sideEffect` flag on every tool drives the permission broker.

## D-010 · U10: Routines are in v1

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.9 (routines table), workstream WS12.
- **Decision**: Bots run routines on a schedule or event trigger, with a mandatory first dry run, spend caps (O7), and run history.
- **Consequences**: `packages/routines` (WS12) and the `routines`/`routine_runs`/`trigger_events`/`cap_counters` tables are part of WS0's migration 0001, not deferred to a later migration.

## D-011 · U11: Build from scratch

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: study prior art (Grok Bot and others), copy no code. Third-party libraries/images used as dependencies are fine.
- **Consequences**: no vendored code from Grok Bot or similar products; only npm/pip/image dependencies declared normally in package manifests.

## D-012 · Harness setup: metaharness with agents+Claude adapters

- **Fecha**: 2026-09-27

- **Context**: OpenBot is developed with metaharness ([private metaharness repository URL removed]). Agents expected to work here: Claude Code, Codex, and Cursor.
- **Decision**: `.ai/` is the single source of truth. `ADAPTERS="agents claude"`: `AGENTS.md` covers Codex, Cursor, and other agent-file readers; `CLAUDE.md` + `.claude/` cover Claude Code (hooks: brief at session start, guard before risky tools, stop-check at the end). Skills are generated into `.claude/skills/` and `.agents/skills/`. Hooks and `.mcp.json` invoke `bash .ai/bin/mh ...` (not the file directly) so they still work if the executable bit on `.ai/bin/mh` is ever lost (e.g. some archive/zip extraction or Windows checkouts).
- **Alternatives discarded**: all five adapters (gemini, copilot, cursor too) — more generated files with no current user; add later with `mh sync` after editing `.ai/config`.
- **Consequences**: after editing `.ai/context`, skills, or `.ai/config`, run `bash .ai/bin/mh sync`; CI runs `mh check` and fails on adapter drift.

## D-013 · TypeScript 6.0.3 instead of 7.x

- **Fecha**: 2026-09-27

- **Context**: TypeScript 7 (the native/Go port) is `latest` on npm, but `typescript-eslint`@8.70.1's peer range is `>=4.8.4 <6.1.0`.
- **Decision**: pin `typescript@6.0.3` in the root and every package until typescript-eslint supports TS 7.
- **Alternatives discarded**: TS 7 now with a bare `tsc`-only lint setup (loses type-aware ESLint rules, not worth it for a project this size).
- **Consequences**: revisit this decision once `typescript-eslint` publishes TS 7 support; track via `npm view typescript-eslint peerDependencies`.

## D-014 · pnpm lockfile is committed from the bootstrap onward

- **Fecha**: 2026-09-27

- **Context**: an earlier bootstrap attempt on this project had no git push credentials and had to write files through the GitHub API one by one, which cannot include a generated `pnpm-lock.yaml` (it would need a real `pnpm install` run first, then a byte-exact upload).
- **Decision**: this bootstrap has real `git`/`gh` credentials (fine-grained PAT with Contents+PRs+Workflows write), so `pnpm install` runs for real and `pnpm-lock.yaml` is committed like any normal Node project. CI uses `pnpm install --frozen-lockfile`.
- **Consequences**: every future dependency change must run through `pnpm add`/`pnpm install` locally (or in CI with lockfile checks) so the committed lockfile stays exact; no manual hand-edits to `pnpm-lock.yaml`.
