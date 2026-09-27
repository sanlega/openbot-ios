# Plan: Open connectors (replace Composio)

- **Date**: 2026-09-28 · **Author**: claude · **Status**: in progress
- **Request**: the owner wants Composio removed (closed source, hosted) and more
  connectors, with users and bots able to add their own tools. Research (market
  survey of Claude.ai, ChatGPT, Grok, Cursor, LibreChat, Open WebUI, LobeHub; T3
  Chat has no connectors) recommends vendor-hosted remote MCP servers with OAuth
  plus local stdio servers, a curated gallery, "paste a URL or command" custom
  connectors, per-bot scoping, and approvals for write tools.

## Goal

Bots can use the user's apps (GitHub, Notion, Linear, Slack, Google, …) through
open MCP servers the user connects once, from a gallery, without any hosted
middleman. Each bot only gets the connectors assigned to it, and write actions
still need the user's OK.

## Scope

**In (slice 1)**
- Remove the Composio provider, its setup step/validator, and settings.
- Curated catalogue (versioned data in `packages/connectors`): ~20 entries, each
  with publisher, category, local/remote, auth kind, MCP config template, setup
  help, and read/write classification of tools where known.
- API: catalogue listing (curated + MCP Registry "community" tab), connect with a
  token/env, list connections, disconnect, per-bot assignment (existing
  `bot.connectors`).
- UI: a Connectors screen (gallery, search, categories, connect sheet, connected
  list) and per-bot connector toggles in the Bot profile.

**In (slice 2)**: OAuth 2.1 for remote MCP (discovery from 401, PKCE, `resource`,
client id: bundled static id → client-ID metadata document → dynamic registration
→ user-supplied), tokens in the vault with refresh, loopback callback that hands
off to the `openbot://` deep link.

**In (slice 3)**: custom connectors (paste an `https://` MCP URL or a local command;
show the exact command/env before first run; pin versions; tools are writes
unless annotated `readOnlyHint`), then bot-drafted tools (registered disabled;
activated only by an approval card showing code, command, and permissions; run in
the Docker sandbox; any change resets approval).

**Out**: hosted OAuth brokers (Composio, Pipedream, Arcade runtime); triggers
(routines poll instead).

## API contract (slice 1)

- `GET /api/connectors/catalog?source=curated|community&q=` →
  `{ entries: CatalogEntry[] }` where `CatalogEntry = { id, name, publisher,
  category, description, kind: "remote"|"local", auth: "none"|"token"|"oauth",
  setup?: { fields: [{ key, label, help?, secret: boolean, placeholder? }],
  docsUrl?, steps?: string[] }, tools?: { name, write: boolean }[], verified:
  boolean, connected: boolean }`.
- `POST /api/connectors/connect { catalogId, values: Record<key,string>,
  displayName? }` → `{ connection }` (secrets go to the vault; env/headers are
  filled at MCP spawn time).
- `GET /api/connectors/connections` → `{ connections: [{ id, catalogId, name,
  status, createdAt }] }`; `DELETE /api/connectors/connections/:id`.
- Per bot: `PUT /api/bots/:id/connectors { connectionIds }` (existing route) and
  the turn builder injects only those connections' MCP servers.

## Acceptance criteria

1. No Composio code, setting, wizard step, or env flag remains; tests pass.
2. The Connectors screen lists curated entries by category with search; the
   Community tab lists MCP Registry results marked unverified.
3. Connecting a token-based entry stores the token only in the vault and shows
   the connection as connected; disconnecting removes it and its vault keys.
4. A bot with a connection assigned gets that MCP server in its turn; a bot
   without it does not.
5. Tools classified as write go through the approval card; read tools do not.
6. Works in dark/light and at 390 px; follows `docs/design-system.md`.

## Tasks

| # | Task | Verification |
|---|---|---|
| 1 | Remove Composio (provider, wizard/validator, settings, flags, tests) | tests, typecheck |
| 2 | Curated catalogue data + catalogue/connect/disconnect routes | route tests |
| 3 | Turn builder injects only assigned connections; write tools → broker | unit + E2E |
| 4 | Connectors screen + profile toggles (UI) | UI tests, screenshots |
| 5 | Slice 2: MCP OAuth client + tests against a fake OAuth server | unit + E2E |
| 6 | Slice 3: custom connectors, then bot-drafted tools behind approval | unit + E2E |

Progress:
- [x] T1 · [x] T2 · [x] T3 · [ ] T4 · [ ] T5 · [ ] T6

## Risks

- Google has no dynamic client registration and its MCP servers are a developer
  preview: expect a guided "bring your own Google Cloud client" setup.
- Slack and GitHub don't support dynamic registration: need a published OpenBot
  OAuth app client id, or a user token.
- Registry entries are unvetted and may be wrappers needing third-party keys: keep
  them in a clearly labelled Community tab.
- Prompt injection through connector output: tool results are data; writes stay
  behind approvals.
