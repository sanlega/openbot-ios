# Session handoff: repository cleanup, Jev research, and model discovery

## Completed

- Rewrote and scanned all 18 branch heads after explicit authorization. GitHub's closed PR refs 1–16 remain stale and require GitHub Support purge before making the repository public. Keep it private until this is resolved.
- Researched Jev computer-use capabilities and Claude/Codex model enumeration. Sourced report: `reports/Control Jev y modelos disponibles.md`; detailed notes: `research_notes/Control Jev y modelos/`.
- Implemented Codex model discovery locally through the existing authenticated app-server `model/list`, including cursor pagination, visible model ID/label normalization, and bundled-catalog fallback. Added focused mapping/fallback tests.
- Codex discovery test, package typecheck, and formatting passed using installed Node 22.23.3. Default shell Node 20.11.0/pnpm 8.15.4 do not satisfy the repository's Node 22/pnpm 10 requirement.
- Checked PR #18's rewritten remote head: CI run 66 cancelled, run 67 failed. Do not merge until CI passes for the exact final head.

## Next steps for Claude

1. Review the local changes on `claude/product-polish`; they are not pushed. Run `pnpm vitest run packages/engines/codex/src/models.test.ts`, full package and repository checks with Node 22/pnpm 10, then commit and push when appropriate.
2. Continue implementation from `.ai/memory/plans/2026-09-27-jev-computer-and-models.md`.
3. For Jev computer control, do not treat Jev as an actuator. Route engine-originated intent through bounded Jev typed decisions; OpenBot must observe/execute only via Computer SPI, broker/policy, and audit events. Add task IDs, steering, cancellation, and tests before claiming completion. See the report's code map and design recommendations.
4. Implement account-aware Claude model discovery only for documented API-key mode via Anthropic Models API; preserve CLI aliases/manual IDs for subscription OAuth. Do not scrape TUI or undocumented OAuth endpoints.
5. Inspect/fix current PR CI. GitHub Support purge for stale PR refs remains outstanding; do not expose repository publicly before it is cleared.

## Retro

- What worked: the Codex CLI's authenticated app-server avoids reading credentials and provides a machine-readable visible catalog.
- What failed: the default shell selected an unsupported Node/pnpm pair; `gh` is unavailable, so GitHub status required the connector. Current PR CI still fails.
- Improve next time: select the repository's pinned Node/pnpm toolchain at the start and fetch actionable CI job details as soon as a new run fails.
