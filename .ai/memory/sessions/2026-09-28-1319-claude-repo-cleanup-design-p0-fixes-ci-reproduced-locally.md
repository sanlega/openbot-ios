# Repo cleanup, design P0 fixes, CI reproduced locally

- **Fecha**: 2026-09-28 13:19
- **Agente**: claude
- **Rama**: claude/product-polish @ 25e2425

## Done
- Deleted 15 merged cursor/* branches and the stale PR #16 branch (its README diagrams now live in docs/architecture.md; local tag archive/openbot-dev-review keeps the commits).
- Untracked the built PWA (apps/pwa/static) and removed the dead vanilla UI.
- Design P0: approval card wording, phone composer, Computer tab redesign, Routines responsive layout. Installed app updated.
- CI reproduced in a clean clone: everything passes.

## Pending
- Owner to run `gh auth login`; then read failing run logs / Actions billing and fast-forward main.
- P1/P2 design audit items.

## Retro
- Worked: screenshot scripts against a fake-seeded harness caught real layout bugs quickly.
- Failed: zsh doesn't word-split $VAR, so a multi-branch delete silently ran on one bogus name; use xargs.
- Improve: CI with no job logs should be checked first for billing/minutes before debugging code.
