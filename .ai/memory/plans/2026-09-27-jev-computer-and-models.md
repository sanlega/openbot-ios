# Plan: Jev computer control and model discovery

- **Date**: 2026-09-27 · **Author**: Codex · **Status**: in progress
- **Original request**: Research how Jev can control the computer quickly while remaining steerable by configured engines, and expose all models actually available from Claude/Codex tools.

## Objective

Let a Bot delegate fast, low-risk computer actions to Jev while retaining engine/user steering and the existing permission broker. Show model choices derived from the authenticated provider tools rather than a short hard-coded list.

## Scope

**Includes**
- Research Jev's current computer/agent tool capabilities and the existing OpenBot `Computer`, `DecisionService`, and engine model-discovery interfaces.
- Design safe delegation semantics, limits, audit trail, and fallback behavior.
- Implement provider-backed model discovery for Claude Code and Codex where their installed tools expose it, with safe fallback and UI coverage.

**Outside scope**
- Grant Jev direct control of the host OS outside existing `Computer` SPI and permission gates.
- Add models by scraping undocumented/private endpoints or bypassing account entitlements.
- Change user-selected Bot engines/models automatically.

## Acceptance criteria

1. Given a connected engine asks OpenBot to act on the configured computer, when Jev can decide/act within the approved Computer SPI, then the action is fast, bounded, attributed to Jev, and visible to the steering engine and audit trail.
2. Given Jev is unavailable, uncertain, or the requested action is outside policy, then control returns to the configured engine or a human approval path; no action fails open.
3. Given an authenticated Claude/Codex CLI exposes its available models, then the Profile UI lists those models and their provider IDs without a fixed short whitelist.
4. Discovery errors or unsupported CLI versions retain a clearly identified fallback list and do not block chat; bots with a selected model remain unchanged.
5. Tests cover provider discovery parsing, unavailable tools, permission boundaries, and UI model selection.

## Design

- **Components affected**: research notes, `packages/decisions`, `packages/computer`, engine SPIs/providers, server model routes, UI Profile editor, tests, and `.ai` decision/state.
- **Changes of data/contracts**: no database migration expected; SPI/API changes need review before implementation.
- **Flow**: configured engine steers a Computer request; Jev evaluates/executes only through approved computer actions, returning structured observations/results to the engine; provider drivers query their supported model-list capability and server returns normalized options plus source/status metadata.
- **Errors and edge cases**: Jev timeout/429/529, uncertain decision, policy deny, CLI missing or outdated, auth/session expiry, empty model result, provider aliases/deprecations.
- **Compatibility/migration**: retain current model IDs and selected model values; preserve existing defaults if discovery fails.
- **Alternatives**: a model-name hard-coded refresh — rejected because it will drift and omit account-accessible models; direct unrestricted Jev desktop control — rejected because it bypasses the Computer SPI and existing policy.

## Tasks

| # | Task | Likely files | Verification | Depends on | Parallel |
|---|---|---|---|---|---|
| 1 | Clean and audit all reachable Git history/refs after explicit authorization | branch refs, PR metadata, local backup/candidate | zero banned paths/session links/personal identifiers in every rewritten ref; compare current trees | — | no |
| 2 | Research Jev computer/tool API and OpenBot safety integration | `research_notes/` | primary-source citations and current code map | — | yes |
| 3 | Research Claude/Codex CLI model enumeration capabilities | `research_notes/` | official docs/CLI source and verified installed CLI probes | — | yes |
| 4 | Synthesize findings and choose safe implementation | research report, `.ai/memory/DECISIONS.md` | criteria trace to documented capabilities | 2, 3 | no |
| 5 | Implement computer delegation and provider model discovery in small vertical slices | packages/engines, computer, decisions, server, UI | tests, typecheck, lint, build, relevant E2E | 4 | no |
| 6 | Update project state and handoff for Claude | `.ai/memory/STATE.md`, session note | clean `mh check`, commit | 1–5 | no |

Progress:
- [x] T1: all 18 branch heads rewritten and scanned. GitHub pull refs 1–16 remain stale and require Support purge before the repo can safely become public.
- [x] T2/T3: research complete; see `reports/Control Jev y modelos disponibles.md` and `research_notes/Control Jev y modelos/`.
- [x] T4: safe boundary established: Jev makes bounded typed decisions; OpenBot observes/acts through Computer SPI and permissions broker.
- [x] T5 (partial): Codex driver now calls the authenticated app-server `model/list`, maps visible IDs and labels, paginates, and retains its bundled catalog on unsupported/error responses. Added driver coverage. Claude API-key catalog and UI error/source status remain to implement.
- [x] T5 (computer): `ComputerTaskManager` runs tasks in the background;
  MCP `computer_task` (returns progress after `waitSeconds`), `computer_status`,
  `computer_steer` (instruction and/or text), `computer_cancel`; engines author
  text via `inputs` or `needsText`; Jev ops now include scroll, key, blocked;
  risky steps create a real approval card (`PermissionBroker.requireApproval`)
  and wait; Jev failure never auto-acts; UI timeline with Stop and text entry;
  prompt block for bots with a computer. Remaining: live run with a real Jev key
  and Docker desktop to tune questions and measure latency; Claude API-key model
  list still to wire into `/api/models`.
- [ ] T6: handoff remains to commit; local toolchain verification limited to Codex test/typecheck/format because remote current-head CI fails and shell default Node/pnpm are too old.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Jev API does not expose direct computer actions | medium | high | distinguish Jev's decision API from OpenBot's Computer actuation; keep actuator behind SPI |
| CLI model discovery depends on unstable output | medium | medium | prefer documented machine-readable commands/APIs; version-gate parsers and retain fallback |
| Model discovery exposes inaccessible models | low | medium | use authenticated CLI/provider capability, normalize only returned IDs |
| Rewrite misses a remote ref or sensitive commit metadata | medium | high | mirror backup, enumerate all heads and PR refs, scan rewritten objects before force update |

## Open questions

- Which exact Jev service/API is intended by “Jev can do it almost instantly”? Verify against official documentation before choosing a transport or tool shape.
