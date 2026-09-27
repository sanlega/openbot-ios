# Commands

```sh
# install (Node >=22.12, pnpm 10 via corepack):
pnpm install

pnpm build              # tsc/vite build of every package/app (pnpm -r --if-present)
pnpm typecheck          # builds @openbot/contracts first, then typechecks everything
pnpm test               # Vitest from the root config; runs packages/** and apps/**
pnpm test:watch
pnpm lint               # ESLint flat config; lint:fix to autofix
pnpm format:check       # Prettier; `pnpm format` to write
bash .ai/bin/mh check   # metaharness adapter drift check (also in CI; = pnpm mh:check)

# single test file / single test (always from the repo root, which owns the config):
pnpm vitest run packages/runtime/src/broker.test.ts
pnpm vitest run packages/runtime/src/broker.test.ts -t "resolves approval"

# run the app:
pnpm --filter @openbot/server dev serve        # headless harness; UI at http://127.0.0.1:4577/app
pnpm --filter @openbot/desktop start           # Electron (needs `pnpm build` first)

# cross-package milestone E2E (Playwright, fakes only; builds e2e/ then runs dist/tests):
pnpm build && pnpm --filter @openbot/e2e test:e2e
# use a preinstalled Chromium instead of `playwright install`:
OPENBOT_E2E_CHROMIUM=/path/to/chromium pnpm --filter @openbot/e2e test:e2e

# Electron smoke E2E (CI order):
pnpm build && pnpm --filter @openbot/desktop run rebuild:native && pnpm --filter @openbot/desktop test:e2e

# store migrations (Drizzle; packages/store/migrations):
pnpm --filter @openbot/store db:generate
pnpm --filter @openbot/store db:check
```

Notes:
- Vitest resolves workspace packages through the `development` export condition
  (`src/*.ts`), so unit tests need no build; `tsc` and Playwright use `dist/`, so
  run `pnpm build` before typechecking an app or running E2E after changing a
  dependency package.
- `rebuild:native` recompiles the shared `better-sqlite3` binary for Electron's
  ABI; Node-side Vitest suites that open SQLite then fail until you run
  `pnpm rebuild better-sqlite3`.
- Real-credential suites are opt-in and skipped by default: `*.live.test.ts` need
  `JEV_API_KEY` (the CoS gate suite also `OPENBOT_LIVE_JEV=1`); engine conformance
  against real CLIs needs `OPENBOT_E2E_REAL=1`. CI runs everything against fakes.
- CI (`.github/workflows/ci.yml`): lint → format:check → build → typecheck → test →
  mh check on macOS/Windows/Linux, plus desktop E2E, integration E2E, and unsigned
  desktop packaging (`pack` + `smoke:packaged`).
