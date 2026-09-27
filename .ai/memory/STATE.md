# Estado actual

_Last updated: 2026-09-27 by codex (continued Claude's product-polish branch)_

## En curso
- PRs #15 (v1 integration, WS0–WS13) and #16 (review fixes) are merged into
  `main` (40d8a23). What works end to end (with fakes; E2E in `e2e/tests/`):
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

- First real run by the user (desktop app, real Claude + Codex keys): onboarding
  worked, but no Bot could be created. Fixed in `da0f0ca` on `claude/product-polish`:
  - The server seeds the Chief of Staff once setup is complete (and at startup
    for installs already past setup): `apps/server/src/chief-of-staff.ts`, wired
    in `bootstrap.ts`.
  - Roster has a "+ New bot" form (`packages/ui/src/components/roster/BotList.tsx`);
    the UI rehydrates on `bot.created` (a new Bot's DM thread had no event, so
    new Bots, including CoS spawns, never showed without a reload).
  - Wizard: Claude and Codex each optional, at least one engine required.
  - Mock server supports `POST /api/bots`; new E2E "First run in the real UI".
  - Verified: typecheck, lint 0 errors, E2E 11/11, unit tests 670 pass.
- Chat format fixed in `da0f0ca`: Claude replies were stored twice (the parser
  appended both `stream_event` deltas and the full `assistant` line;
  `packages/engines/claude/src/parse-stream-json.ts` + test). Bot messages render
  as Markdown (`react-markdown` + `remark-gfm`, no raw HTML;
  `packages/ui/src/components/thread/MessageText.tsx`); Electron opens links in
  the system browser. Messages stored before the fix stay duplicated.
- Bots working together (in `da0f0ca`, verified: typecheck, lint, 676 unit, E2E 14/14):
  - No approval cards for OpenBot's own tools: turns pass `--allowedTools mcp__openbot`
    and `permission_prompt` allows `mcp__openbot__*` (their handlers carry the gates).
  - A `send_message` wakes the recipient: `wakeOnBotMessages` (turn-mailbox.ts) runs
    its turn on the same chain on `handoff.sent`. `send_message` also resolves a Bot
    by its display name (user-created slugs have a random suffix).
  - Engine turns no longer die after 30 s wall-clock: idle timeout of 35 min
    (`@openbot/engines-common` `waitForTurnComplete`), longer than approval expiry.
  - Claude parser now emits `tool_started`/`tool_completed` (before: none for Claude).
    Claude CLI sends thinking blocks with EMPTY text, so the UI shows a folded
    "Worked for Ns · N steps" block (tool steps) and a live "Thinking…" instead.
  - CoS-spawned Bots get their engine/model pinned by Jev at creation
    (`apps/server/src/bot-models.ts`); `/api/models` lists real models; Profile tab
    is editable (name, description, model dropdown incl. "Auto", effort,
    permissions, computer). `bot.updated` now carries the full bot.
  - Chat reads oldest→newest (API lists newest first; hydrate sorts) and follows
    new messages unless the user scrolled up.
  - Messages sent before these fixes are not replayed: the "Research Helper" task
    from the CoS stays unanswered until someone messages that Bot again.
- Approvals (in `da0f0ca`, verified: typecheck, lint, 693 unit, E2E 14/14 x3):
  - `classifyToolCall` (`packages/runtime/src/tool-classifier.ts`) shared by the
    mailbox and `permission_prompt`: read tools and read-only shell pipelines are
    read-only; Write/Edit inside the workspace are allowed (`workspace_write`/`full`).
    Jev's risk gate now gets the action detail (command/path), not just the tool.
  - Approval cards render at the bottom of the chat.
  - CoS tool `archive_bot` (reversible; user-created bots only with
    `user_requested`); profile has "Archive bot". CoS prompt says never touch
    OpenBot files/DB to change the team.
  - Markdown: a blank line is inserted before list items that follow a text line.
- Fixed flakes: UI turn tracking tolerates out-of-order bus events (the "Turn
  steps" flake); E2E harness uses OS-assigned free ports (EADDRINUSE flake).
- Digest timezone bug is fixed in `da0f0ca`; the suite passes outside UTC.
- The UI product polish is pushed to `origin/claude/product-polish` at `2ff0e0b`; plan:
  `.ai/memory/plans/2026-09-27-ui-product-polish.md`. Setup, Activity, Routines,
  Settings, and Devices/Remote were redesigned. The UI reconnects after a lost
  WebSocket; a failed Settings load now offers retry. The mock serves harness
  status. Verified on macOS: build, typecheck, lint (0 errors, 6 existing warnings),
  format, 726 unit tests, 15 integration E2E, `mh check`.
- Local dev needs Node >=22.12 (user's default is 20; installed 22 via nvm) and
  `corepack pnpm`. After `rebuild:native` for Electron, run
  `corepack pnpm rebuild better-sqlite3` before Node unit tests.

## Próximos pasos
0. Structured user inputs (`ask_user` forms, secrets to vault, "Waiting on you")
   are implemented in `da0f0ca`; the draft plan
   `.ai/memory/plans/2026-09-27-user-inputs.md` still needs its status and boxes
   updated to match the implementation.
0b. User wants Composio removed (closed source) and replaced by tools that users
   and agents create themselves. Proposed: (A) declarative HTTP tools (JSON spec +
   vault secret, no code), then (B) script tools in Docker; agent-created tools
   need an approval card to activate. Awaiting the user's choice, then write the
   plan in `.ai/memory/plans/` (touches contracts `ConnectorProvider`, D-009,
   setup wizard, connectors package).
0c. Manually inspect the redesigned desktop UI and exercise routine editing,
    device pairing, and remote provider actions with real providers. The E2E suite
    currently smoke-tests screen loading and the existing core flows.
1. Close superseded PRs #1–#14 if still open.
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
