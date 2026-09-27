# Project state

_Last updated: 2026-09-27 by Codex_

## In progress
- Prepare the first downloadable GitHub release (`v0.1.0`) and polish the public repository.
  Plan: `.ai/memory/plans/2026-09-27-github-release.md`.
- Public-release README, contributor guide, issue/PR templates, changelog, and installer
  workflow are in the product-polish branch. PR #18 targets `main`; do not merge before
  exact-head CI passes.
- The user approved history cleanup. All 18 branch heads were rewritten; old local session
  notes, machine paths, a personal email, a private metaharness URL, a private Claude
  session URL, and identifying sample names were scrubbed. PR #17 metadata was edited.
  GitHub's read-only `refs/pull/1..16/head` still point to old commits; contact GitHub
  Support to purge those refs and cached views before changing repository visibility.
- After the history rewrite, PR #18's rewritten head has CI run 66 cancelled and run 67
  failed. The fetched branch head is `6ea37d5fd91baea2c645d2edf73636289f3acb46`;
  inspect CI again after the local follow-up is pushed. `gh` is not installed in this
  shell; the GitHub connector is available for read-only status checks.
- A protected local history backup exists outside the repository. Its location and
  recovery notes are in ignored `.ai/local/history-cleanup.md`.
- Credential-pattern scan found no real credentials. One synthetic credential-shaped
  match remains in the deliberately fake 401 fixture; this scan is not exhaustive.

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
- Research found Jev is a typed decision API, not a computer-using agent: OpenBot must
  execute Jev's bounded decisions through the existing Computer SPI and permission broker.
  The Codex app-server exposes `model/list` and returned seven visible model options in a
  local read-only probe; the static OpenBot list currently shows two. Anthropic does not
  document subscription-session model enumeration for Claude Code; its Models API is
  available to API-key mode. Full sourced findings: `reports/Control Jev y modelos disponibles.md`.
- Codex model discovery is partially implemented locally: the authenticated app-server
  now calls paginated `model/list`, maps model IDs/labels, and falls back to the bundled
  catalog if discovery fails or is unsupported. Focused tests and package typecheck pass.
- Active implementation/research plan: `.ai/memory/plans/2026-09-27-jev-computer-and-models.md`.

## Validation on the product-polish branch
- UI test suite, UI typecheck, build, formatting, and lint passed after the latest UI fix.
- The local `/app` route serves the rebuilt bundle. GitHub Actions runs 62 and 63 failed in
  all jobs and the connector could not fetch logs. Recheck CI after the rewritten PR head
  and obtain logs before diagnosing; do not merge until required checks pass.
- After repository polish: 733 tests passed (18 skipped), build and typecheck passed,
  format and `mh check` passed. Lint has three pre-existing warnings and no errors.

## Known gaps
- Real Claude/Codex and Jev credentials, Docker on other operating systems, and
  remote-provider integrations need broader manual testing.
- Jev computer steering and account-aware Claude model discovery are researched but not
  yet implemented. Codex discovery needs full CI after its local changes are pushed.
- The GitHub Support purge for closed PR refs and cached views remains outstanding; keep
  the repository private until resolved.
- Desktop packages are unsigned and will show operating-system warnings.
- Follow-up work includes code signing/notarization and deeper end-to-end coverage for
  routine editing and remote pairing.
