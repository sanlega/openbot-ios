# Project state

_Last updated: 2026-09-27 by Codex_

## In progress
- Prepare the first downloadable GitHub release (`v0.1.0`) and polish the public repository.
  Plan: `.ai/memory/plans/2026-09-27-github-release.md`.
- Current tree cleanup, contributor documentation, README download link, release notes,
  and tagged release workflow are prepared. Local lint, format, `mh check`, build,
  typecheck, and tests pass.
- Remaining: review/scan the complete branch diff, push/open PR and await CI, then prepare
  a cleaned-history rewrite. Historical versions of local session notes still exist in
  Git; do not make the repository public until the rewrite is reviewed and approved.
- A credential-pattern scan found no real credentials; the few credential-shaped matches
  were synthetic test fixtures. This is not a guarantee against every possible leak.

## Product status
- OpenBot is an early desktop preview for managing persistent Claude Code and Codex Bots.
- The app includes chat, team delegation, approvals, routines, local computer use, a PWA,
  and optional remote pairing.
- Users supply their own provider accounts and keys. OpenBot has no hosted backend and
  ships no bundled credentials.
- Computer Live View uses a Docker-backed virtual desktop; local-computer mode is
  available with explicit permissions.
- The README includes screenshots generated with mock data.

## Recent change
- Chat now retains an engine failure reason and shows it beside the latest failed turn,
  including failures that happen before any tool step. The chat error view redacts common
  bearer and API-key formats. The PWA static assets are rebuilt and served locally.

## Validation on the product-polish branch
- UI test suite, UI typecheck, build, formatting, and lint passed after the latest UI fix.
- The local `/app` route serves the rebuilt bundle. The branch still needs pull-request CI;
  do not merge until required checks pass on the exact PR head.
- After repository polish: 733 tests passed (18 skipped), build and typecheck passed,
  format and `mh check` passed. Lint has three pre-existing warnings and no errors.

## Known gaps
- Real Claude/Codex and Jev credentials, Docker on other operating systems, and
  remote-provider integrations need broader manual testing.
- Desktop packages are unsigned and will show operating-system warnings.
- Follow-up work includes code signing/notarization and deeper end-to-end coverage for
  routine editing and remote pairing.
