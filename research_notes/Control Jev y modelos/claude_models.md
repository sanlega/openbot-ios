# Claude Code model discovery

## Is there a supported way to enumerate models for an authenticated Claude Code CLI account?

### Takeaway
Anthropic documents model selection (`--model`, `/model`) and an account-aware interactive picker, but I found no documented CLI command or machine-readable CLI interface that lists the models available to a Claude Code login. The official Models API lists models available to an Anthropic API credential; it is not documented as enumerating a Claude.ai/Claude Code subscription login's selectable models.

### Cited Findings
- The CLI reference documents `--model` accepting an alias (e.g. `sonnet`, `opus`, `haiku`, `fable`) or full model name, and print output formats; it does not document a model-list CLI command. [CLI reference](https://code.claude.com/docs/en/cli-usage)
- Claude Code offers an interactive `/model` picker; aliases resolve by provider and their targets can change over time. [Model configuration](https://code.claude.com/docs/en/model-config)
- Anthropic's API `GET /v1/models` returns a paginated catalog described as models available for use in the API. Its example authenticates using `X-Api-Key: $ANTHROPIC_API_KEY`. [List Models API](https://platform.claude.com/docs/en/api/models/list)
- `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` fills the picker from an Anthropic-compatible gateway's `/v1/models`; the setting is off by default because a shared gateway key could expose every model it can access to all users. This is gateway discovery, not documented Claude subscription-account discovery. [Environment variables](https://code.claude.com/docs/en/env-vars)
- The installed CLI's `claude --help` includes `--model` and `auth` but no models-list subcommand. Repository detection invokes `claude auth status --json` and parses login status, auth method, email, and subscription type, not a model catalog. [Repository Claude detection](../../packages/engines/claude/src/detect.ts)
- OpenBot's Claude driver returns the hard-coded `CLAUDE_MODELS` from `listModels()`, currently three entries. The Profile picker is fed by `GET /api/models` → driver `listModels()`; routing also consumes this list. [Claude catalog](../../packages/engines/claude/src/models.ts); [Claude driver](../../packages/engines/claude/src/driver.ts); [Profile model API](../../apps/server/src/bot-models.ts); [routing](../../apps/server/src/turn-mailbox.ts)
- Enterprise `availableModels` policy can restrict what users see/select in Claude Code, including by alias, family prefix, or exact ID. Existence in a global catalog does not imply account availability. [Model configuration: restrictions](https://code.claude.com/docs/en/model-config#restrict-model-selection)

### Inferences
- For subscription login, no supported machine-readable “list exactly what this account can select” API appears in the documented CLI/API surface. Scraping the TUI or calling undocumented endpoints would be brittle and unsupported.
- In API-key mode, OpenBot could query `GET /v1/models` using the user's existing vault-held key, paginate/cache IDs and display names. Do not extract or reuse CLI OAuth credentials.
- A safe UX can keep aliases for CLI login and optionally show API-returned IDs only for explicit API-key mode. Treat discoverability as tentative because policy/access may change before use.
- Quota exhaustion is distinct from model access: a selectable model may still fail because usage limits are exhausted.

### Gaps
- Public Anthropic docs do not say whether `GET /v1/models` works with Claude Code OAuth/subscription credentials; don't assume it does.
- I did not open the interactive picker or inspect credentials/config files; neither is needed to determine documented interfaces.
- Public docs and CLI help cannot establish the account-specific model list for an individual login.

## Which model identifiers and aliases should OpenBot expose, and what gates availability?

### Takeaway
Use provider-recognized aliases or current full IDs, not fabricated display IDs. OpenBot's fixed catalog is stale against Anthropic's published catalog; present discovery provenance and handle unavailable/retired IDs rather than claiming a definitive account-specific list.

### Cited Findings
- Claude Code aliases include `default`, `best`, `fable`, `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opus[1m]`, and `opusplan`; aliases resolve differently by provider and evolve. [Model aliases](https://code.claude.com/docs/en/model-config#model-aliases)
- CLI supports aliases or full model names through `--model`. [CLI reference](https://code.claude.com/docs/en/cli-usage)
- Anthropic's lifecycle page distinguishes Active, Legacy, Deprecated, and Retired. It currently lists active IDs including `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`; retired IDs are no longer usable through Claude API. [Model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations)
- Availability may depend on provider, managed `availableModels` restrictions, account access, and, for some models, plan/seat tier or usage credits. [Model configuration](https://code.claude.com/docs/en/model-config)
- The API `/v1/models` is paginated (default 20, max 1000) and returns IDs, display names, and capability metadata. [List Models API](https://platform.claude.com/docs/en/api/models/list)

### Inferences
- Aliases like `sonnet`/`opus` are more compatible with CLI subscription login and track recommended provider versions, but they are not an inventory of all concrete options or account policy.
- In API-key mode, retain API-returned canonical IDs and metadata; don't derive version IDs from marketing names. Mark source (“API account”, “CLI aliases”, or “static fallback”).
- OpenBot routes and pins using driver `listModels()`. Dynamic results must feed both routing and profile picker through one refresh/cache path.
- Avoid probe generations to test access: they may spend quota and successful model existence doesn't guarantee remaining quota.

### Gaps
- API model catalog equivalence with Claude Code subscription picker choices is undocumented.
- A universal complete list cannot be inferred because provider aliases and entitlements vary.

## Can OpenBot query models without exposing user credentials?

### Takeaway
OpenBot can keep credentials away from Jev/UI by querying from the local server and returning sanitized model metadata. For CLI OAuth login, credentials should stay inside Claude Code; no documented account-specific list API is available. API-key mode may use the existing vault-held key server-side for the official Models API.

### Cited Findings
- OpenBot's turn builder retrieves provider API keys from the vault and passes them only into the chosen engine's child-process environment; CLI-login mode doesn't pass an OpenBot API key. [Turn auth selection](../../apps/server/src/turn-mailbox.ts); [Claude transport](../../packages/engines/claude/src/transport.ts)
- Claude subprocess receives `--model <input.model>` and Claude CLI owns session behavior. [Claude transport](../../packages/engines/claude/src/transport.ts)
- Anthropic's documented Models API request authenticates with `X-Api-Key`. [List Models API](https://platform.claude.com/docs/en/api/models/list)
- Claude Code gateway discovery is constrained by `availableModels`; Anthropic warns shared-key discovery can expose the key's model catalog to users. [Environment variables](https://code.claude.com/docs/en/env-vars)

### Inferences
- Server-side API-key discovery can request only `GET /v1/models`, validate response schema, return ID/name/capabilities, and never expose headers, raw errors, credentials, or auth state to UI/Jev.
- In CLI-login mode, use aliases or user-entered IDs and surface sanitized request-time errors. Don't inspect Claude config files, process memory, or reuse OAuth tokens with undocumented calls.
- Model IDs themselves are not credentials, but a private provider/gateway's catalog could be sensitive; keep discovery local to each user.
- If discovery is offline, fall back clearly, preserve the bot's current model, and distinguish selectable model from runtime quota/authorization.

### Gaps
- No supported public endpoint for enumerating the CLI OAuth session's selectable models was found.
- No supported method to call an internal account service using subscription credentials was established.
