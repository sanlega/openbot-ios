# Codex CLI model discovery

## Which supported Codex interface can enumerate models for the signed-in CLI?

### Takeaway

The Codex CLI version installed for this research (`0.157.1`) has no `codex models` command, but its experimental `codex app-server` exposes a machine-readable JSON-RPC `model/list` request. Calling it through the user's already-authenticated CLI returned the visible account catalog without reading or printing credentials.

### Cited Findings

- OpenAI's Codex app-server protocol has a `model/list` client request, and its parameters include `limit`, `cursor`, and `includeHidden`; the upstream protocol serialization test demonstrates the JSON-RPC request shape. — [Codex app-server protocol source](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)
- The official Codex Python SDK calls `model/list` with `includeHidden` and parses a typed `ModelListResponse`, confirming machine-readable support in a first-party client. — [OpenAI Codex Python SDK](https://github.com/openai/codex/blob/main/sdk/python/src/openai_codex/client.py)
- Upstream app-server tests verify visible-only results by default, optional inclusion of hidden models, pagination, and returning the account/provider catalog; they also test model catalog refresh/auth behavior. — [Codex app-server model-list tests](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/model_list.rs)
- The local `codex --help` lists no `models` subcommand; the CLI labels `app-server` experimental. A current open feature request also asks for a separate `codex models list --json` command, corroborating that the CLI has no dedicated model-list command. — [Codex CLI feature request #47059](https://github.com/openai/codex/issues/47059)
- The OpenAI API's `GET /v1/models` is an API-key API catalog. It is not the appropriate source for the user's ChatGPT-authenticated Codex picker; issue #47059 explicitly notes that this API model list is not equivalent to ChatGPT-authenticated Codex availability. — [OpenAI API Models reference](https://developers.openai.com/api/reference/cli/resources/models); [Codex CLI feature request #47059](https://github.com/openai/codex/issues/47059)
- API-key model discovery is not universally on: upstream app-server tests show it depends on the `api_key_model_discovery` feature setting and an explicitly configured catalog URL; otherwise the bundled model catalog is used. — [Codex app-server model-list tests](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/model_list.rs)
- A read-only probe of the installed `codex-cli 0.157.1` used `initialize` followed by `model/list` with `includeHidden:false`. It returned seven visible model entries, each with matching `id` and `model`, a `displayName`, `hidden:false`, and supported reasoning efforts; one was marked `isDefault:true`. This is a point-in-time result for the currently configured local Codex session, not a catalog to hardcode or publish.

### Inferences

- For OpenBot's model picker, use the same user's configured `codex app-server` and issue `model/list` with `includeHidden:false`, following the returned `nextCursor` until it is absent if a limit is used. Prefer the returned `id`/`model` value as the selection sent to `thread/start`; use `displayName` only as presentation text.
- Treat `model/list` as experimental/version-dependent because Codex labels app-server experimental. Handle unsupported method, authentication, provider, and network errors explicitly; don't turn errors into an empty model list or silently substitute a hardcoded catalog.
- Catalog presence is evidence the active Codex picker exposes the model, not a guarantee every future inference will succeed: access, account state, rollout, and service availability can change after discovery.
- Do not read `~/.codex/auth.json`, extract bearer tokens, or query `/v1/models` with an inferred credential. The app-server already owns provider selection and authentication, and the `model/list` request itself needs no secret-bearing parameter.

### Gaps

- I found no official public per-plan matrix that maps ChatGPT plan tiers to every Codex `model/list` result. The per-session probe establishes current visible catalog only, not why each model is enabled for that account.
- The protocol is actively versioned and the public documentation available here does not promise that model IDs or the app-server wire schema are immutable. OpenBot should pin/test supported CLI versions and refresh generated protocol types as it updates that minimum.

## What in OpenBot currently limits the Codex picker, and what should change?

### Takeaway

OpenBot currently hardcodes only `gpt-6-astra` and `o4-mini` for Codex, so the profile picker cannot reflect the locally authenticated Codex catalog. `CodexDriver.listModels()` is the narrow integration point; it can delegate to a typed `model/list` call on the existing app-server process.

### Cited Findings

- OpenBot's Codex model catalog contains exactly two hardcoded entries, `gpt-6-astra` and `o4-mini`. — [packages/engines/codex/src/models.ts](../../packages/engines/codex/src/models.ts)
- `CodexDriver.listModels()` returns that static `CODEX_MODELS` array. — [packages/engines/codex/src/driver.ts](../../packages/engines/codex/src/driver.ts)
- The profile endpoint delegates model listing to each available engine's `listModels()` method, and the UI populates its picker from `/api/models`. — [apps/server/src/bot-models.ts](../../apps/server/src/bot-models.ts); [BotProfileEditor.tsx](../../packages/ui/src/components/profile/BotProfileEditor.tsx)
- OpenBot already runs a shared `codex app-server`, initializes it with `experimentalApi:true`, and sends JSON-RPC requests through `CodexAppServer.request()`. — [packages/engines/codex/src/app-server.ts](../../packages/engines/codex/src/app-server.ts)
- The committed generated protocol types currently contain thread start, turn start, and MCP status results but no `model/list` types. Its generator invokes the installed CLI's `app-server generate-ts --experimental`. — [generated/protocol.ts](../../packages/engines/codex/src/generated/protocol.ts); [generate-types.mjs](../../packages/engines/codex/scripts/generate-types.mjs)
- The shared `ModelInfo` contract currently carries only `id`, `label`, and optional `contextWindow`; it has no default-model or reasoning-effort fields. — [packages/contracts/src/engine-driver.ts](../../packages/contracts/src/engine-driver.ts)

### Inferences

- Minimal implementation path: add request/response types for `model/list`, add a paginated method to `CodexAppServer`, map visible entries into the current `ModelInfo` shape, and make `CodexDriver.listModels()` use it. Keep a short in-memory cache to avoid reloading for every profile request, but allow refresh and distinguish cached results from discovery failures.
- If the UI should let users choose only supported reasoning levels or identify the provider's default, extend the shared `ModelInfo` schema and picker rather than trying to encode those properties into labels. That touches `@openbot/contracts` and needs the project's coordinator-reviewed contract change.
- Update the protocol fixture/schema drift coverage and fake app-server to exercise pagination, hidden filtering, malformed data, unsupported method, and auth/network errors without live credentials. Keep local catalog results out of logs and persistent memory.

### Gaps

- The current app-server CLI probe verified `model/list` on the installed version only. It does not establish which older supported Codex versions first implemented this request; compatibility should be tested against the repository's minimum version and a current release before choosing fallback behavior.
- The repository's committed Codex protocol fixture tracks server-initiated approval requests rather than all client requests, so its present schema drift test does not by itself validate `model/list` result shapes. A dedicated protocol response fixture or typed schema is needed.
