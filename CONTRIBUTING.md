# Contributing to OpenBot

Thanks for helping improve OpenBot. Issues and focused pull requests are welcome.

## Set up

Use Node.js 22.12 or newer and pnpm 10:

```sh
corepack enable
pnpm install
pnpm build
```

OpenBot tests use fake engines and services by default. Do not add provider keys,
personal account data, or local `.openbot` data to tests or commits.

## Before opening a pull request

Run the checks that match your change:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

For desktop or browser changes, also run the applicable Playwright suite described
in the root README. Keep changes focused, add regression coverage for behavior
changes, and update documentation when user-facing behavior changes.

Cross-package imports must go through `@openbot/contracts` and `CoreContext`.
Database schema changes require a numbered migration; do not edit the initial
migration in place. See [AGENTS.md](AGENTS.md) for the project architecture and
package ownership rules.

## Optional AI-assisted workflow

The repository includes its reusable metaharness workflow in `.ai/`. It is
self-contained; contributors do not need access to another repository or need to
install an AI tool to contribute. Compatible agents can use `AGENTS.md` or
`CLAUDE.md` for project guidance.

To use the included helper from a shell, run:

```sh
bash .ai/bin/mh brief
bash .ai/bin/mh route "your task"
bash .ai/bin/mh check
```

Edit `.ai/` source files instead of generated `AGENTS.md`, `CLAUDE.md`, or skill
copies, then run `bash .ai/bin/mh sync`. The shared memory is public project
documentation: keep it factual and project-focused. Put local notes in the ignored
`.ai/local/` directory, and never record credentials, user conversations, personal
names, or machine-specific paths.
