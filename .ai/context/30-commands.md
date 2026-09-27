# Commands

```sh
# install (Node 22, pnpm 10 — see package.json "engines"/"packageManager"):
pnpm install

# build every package/app that has a build script:
pnpm build

# unit/contract tests (Vitest, root config discovers packages/**, apps/**):
pnpm test
pnpm test:watch

# typecheck every package/app that has a typecheck script:
pnpm typecheck

# lint / format:
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check

# metaharness adapter drift check (also runs in CI):
bash .ai/bin/mh check
pnpm mh:check          # same thing, via package.json
```

No packages exist yet (see `.ai/memory/plans/openbot-v1.md`, WS0 is next); the
`build`/`typecheck` scripts are `pnpm -r --if-present` fan-outs that succeed as
no-ops until `packages/*`/`apps/*` start adding their own `build`/`typecheck`
scripts. `pnpm test` and `pnpm lint` already work at the root (Vitest is configured
with `passWithNoTests`; ESLint's flat config lints every root TS/JS file).
