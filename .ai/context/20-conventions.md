# Conventions

- **Language**: all prose (docs, commit messages, `.ai/memory/*`, code comments) is
  English, even though the metaharness framework itself is Spanish-language upstream.
- **Commits**: small and descriptive, one logical change per commit. Push often —
  don't let local work sit unpushed, so another agent can pick up mid-task if credits
  run out. Keep `.ai/memory/STATE.md` current and run `mh handoff` before a long gap.
- **Package boundaries**: cross-package imports go only through `@openbot/contracts`
  and `CoreContext` (see `.ai/context/10-project.md`). Never import another
  package's internals (e.g. `packages/engines/claude/src/...` from `packages/cos`).
  Each workstream (WS0–WS13 in the plan) owns its own directories; don't edit another
  workstream's package without a coordinator-reviewed PR when the change touches
  shared contracts.
- **Schema changes**: any change to `packages/store/src/schema.ts` needs a new
  numbered Drizzle migration (`pnpm --filter @openbot/store db:generate`; never edit
  `migrations/0000_init.sql` in place) and a coordinator-reviewed PR.
- **Code style**: TypeScript strict mode everywhere (`tsconfig.base.json`), ESLint
  flat config + Prettier, enforced in CI. Node 22, pnpm workspaces — no npm/yarn
  lockfiles, no global installs assumed by scripts.
- **Testing**: Vitest for unit/contract tests (`:memory:` SQLite + fake clock where
  relevant), Playwright (`_electron` included) for E2E. Fakes first: every package
  that depends on `EngineDriver`, `Computer`, or `DecisionService` must pass its
  tests against the WS0 fakes with zero real credentials; real-engine/real-Jev runs
  are opt-in (`OPENBOT_E2E_REAL=1`) and never gate CI.
- **Secrets**: never log, print, or persist a real API key/token in test fixtures,
  fixtures directories, or commit messages. `packages/engines/fixtures/` holds only
  the pre-auth/structural spike transcripts (`internal/engine-fixtures/` in the
  project's shared store) — no live credentials were ever involved in producing them.
