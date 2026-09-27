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
## D-015 · WS0 fakes for engine/computer live in nested packages/<ws>/fake sub-packages

- **Fecha**: 2026-09-27

- **Contexto**: plan §3 lists `engines/` (WS3) and `computer/` (WS9) as single packages with `(fake/ = WS0)` noted inline, without specifying whether the fake is its own npm package or a subfolder of the same one.
- **Decisión**: `packages/engines/fake` and `packages/computer/fake` are their own npm packages (`@openbot/engines-fake`, `@openbot/computer-fake`) rather than subfolders inside a single `@openbot/engines`/`@openbot/computer` package. `pnpm-workspace.yaml` gained a `packages/*/*` glob for this.
- **Alternativas descartadas**: cramming `fake/` as a subfolder of a not-yet-existing `@openbot/engines`/`@openbot/computer` package, which would force WS3/WS9 to either reuse WS0's package.json (coupling their release/dep graph to the fake) or restructure it when they land.
- **Consecuencias**: WS3/WS9 add sibling packages (`packages/engines/claude`, `packages/engines/codex`, `packages/computer/docker`, `packages/computer/local`, etc.) without touching or moving the fakes; each engine/provider backend can have its own dependencies.

## D-016 · apps/desktop's WS0 skeleton stubs the electron dependency

- **Fecha**: 2026-09-27

- **Contexto**: plan §5 WS0 requires "An Electron shell and a headless shell" with acceptance "the desktop shell shows harness connected", while the full desktop shell (utilityProcess host, tray, notifications, packaging) is explicitly WS6's job. The real `electron` npm package downloads a large (~100 MB+), OS-specific binary via its postinstall script.
- **Decisión**: `apps/desktop` ships real, structurally-correct main/preload/renderer code (one window, one IPC handler) typechecked against a local ambient `electron-shim.d.ts` instead of depending on the real `electron` package. The actual "is the harness connected" logic is extracted into `harness-client.ts` and unit-tested with Vitest; the Electron window itself cannot be driven headlessly in this sandboxed environment. See `apps/desktop/README.md`.
- **Alternativas descartadas**: adding the real `electron` devDependency now, which would make `pnpm install`/CI depend on a large binary download (repeated across the 3-OS CI matrix) for a skeleton WS6 will rewrite anyway, with no way to verify the display output in this environment either way.
- **Consecuencias**: WS6 adds the real `electron` dependency and deletes `electron-shim.d.ts` when it lands; until then, `apps/desktop`'s build/typecheck/test are fast and 100% reliable in CI, but the GUI itself is unverified end-to-end.

## D-017 · WS6 harness host forks `@openbot/server` dist/main.js; preload is CommonJS

- **Fecha**: 2026-09-27

- **Contexto**: plan §5 WS6 requires the harness in an Electron `utilityProcess` with auto-restart. WS0's desktop skeleton used a local `electron-shim.d.ts` (D-016). Electron preload scripts cannot reliably use ESM `import` under `contextIsolation` when the app package is `"type": "module"`.
- **Decisión**: `HarnessHost` forks `@openbot/server/dist/main.js` via `utilityProcess.fork` (not a separate worker shim). Preload compiles to `dist/preload.cjs` (CommonJS) via `tsconfig.preload.json`. Main waits on `waitForHarnessReady()` before showing the window.
- **Alternativas descartadas**: bundling the whole harness into the main process (violates E3); keeping preload as ESM (broke IPC bridge in Playwright `_electron` smoke tests).
- **Consecuencias**: `apps/server/package.json` exports must include `require`/`default` conditions so `createRequire` can resolve the entry at runtime; desktop `build` runs two `tsc` passes.

## D-018 · Desktop runtime must bundle Node 22 for better-sqlite3 13

- **Fecha**: 2026-09-27

- **Context**: `better-sqlite3@13.0.3` declares Node `>=22`, while Electron 34.2.0 embeds Node 20.18.2. On macOS arm64, `rebuild:native` succeeded but loading SQLite under Electron crashed the packaged harness with SIGSEGV. The packaged app never opened its Client API.
- **Decision**: Pin `apps/desktop` to Electron 38.8.0, which embeds Node 22.22.0. After rebuilding the native module, run a real SQLite query with `ELECTRON_RUN_AS_NODE=1` before packaging.
- **Alternatives discarded**: keep Electron 34 and downgrade SQLite; this would widen the package's dependency divergence and leave the embedded runtime behind the monorepo's Node 22 baseline.
- **Consequences**: desktop packaging requires an Electron runtime compatible with the store's native SQLite package. `rebuild:native` now fails if that runtime cannot load and query SQLite.
