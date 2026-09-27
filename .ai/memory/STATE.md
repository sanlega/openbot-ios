# Project state

_Last updated: 2026-09-28 by Claude_

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

## Latest (Claude, after reviewing Codex's work)
- CI blocker found and fixed locally: the history cleanup replaced the
  outside-workspace path in two approval E2Es with a relative placeholder, which
  the tool classifier correctly treats as an in-workspace write (no card). Tests
  now use a neutral absolute path. Research notes were Prettier-formatted (they
  failed `format:check`). Local: lint, format, build, typecheck, 735 unit tests
  (UI component tests now run from the root Vitest projects), E2E 15/15.
- Desktop: min window size, macOS hidden-inset title bar with draggable headers,
  app menu (Settings Cmd+,), notification clicks navigate the UI.
- Harness serves PWA icons and hashed assets per request (no restart after a UI
  rebuild). Stored theme applies before first paint.
- Design system: `docs/design-system.md` + live gallery at `/app/?design`.
- Connectors: plan `.ai/memory/plans/2026-09-28-connectors.md`, decision D-019
  (open MCP only, Composio removed). UI done: Connectors screen (gallery,
  community, connected, connect dialog) and per-bot toggles in the profile.
  Backend T1–T3 (remove Composio, curated catalogue + routes, per-bot MCP
  injection) is committed on the branch. Plan T4 UI is also implemented; review its
  acceptance checklist before marking complete. OAuth and custom connectors remain later
  slices in that plan.
- Also done: command palette (bots, screens, actions), "Waiting for your
  approval" turn state. Claude Models API discovery is wired into `/api/models`
  for API-key mode. CLI-login bots retain bundled aliases because Claude Code
  exposes no documented model-list endpoint for subscription OAuth.
- Owner approved (2026-09-28): (1) pushing the branch — done, PR #18 head now
  includes the CI fix; CI result not visible from this shell (no `gh`); (2) a LAN
  mode for phone pairing. Design: owner toggle "Allow phones on this Wi-Fi" in
  Devices (off by default) → bind 0.0.0.0 on next start (desktop restarts the
  harness), pairing QR lists private-range LAN IPv4s; non-loopback requests still
  need a paired device token and pairing still needs the QR secret. Starts after
  the connectors backend work lands (same packages).
- The working tree is clean aside from the current model catalog integration task;
  local updates are committed and pushed when validated.

## Jev computer control (owner priority, 2026-09-28)
- Implemented and pushed: background computer tasks the engine can follow,
  steer, supply text to, and cancel (MCP `computer_task/status/steer/cancel`);
  Jev picks click/type/select/scroll/key/wait/done/blocked from DOM/AX/OCR
  observations; OpenBot validates targets, runs broker checks, and risky steps
  wait on a real approval card; Jev unavailable → stop with a clear reason.
  UI: bot profile → Computer shows a live step timeline, pending text, Stop.
- Next: live test with a real Jev key + Docker desktop (tune question wording,
  measure latency, check Spanish pages), then consider streaming step events
  into the chat's turn steps.

## Message sending / desktop diagnosis (2026-09-28)
- The Chief's `o4-mini` turn stayed open after `turn.started`; OpenBot later restarted
  and marked it `turn.interrupted` with "OpenBot restarted before this turn finished."
  A subsequent Claude turn failed immediately with the Claude session-limit message.
  There was no active turn left that continued to hold the composer.
- Root cause of the long-running o4 attempt: the installed `OpenBot.app` was built at
  00:25, before commit `aa028d1` at 00:34 fixed recursive `initialize` waiting in Codex
  app-server startup. The current source has a regression test for initialize + `model/list`.
- Rebuilt and installed the current app after backing up the previous bundle under
  `~/openbot-backups/`. The new app's `/api/models` returns in 36 ms with seven Codex
  models. `/api/computer/tasks` responds; the current task list is empty. The user's
  Application Support data was not modified.
- Jev task timeline and steer/stop controls live inside each bot's Computer tab. That tab
  is shown only for Bots with computer access. No real task was launched during diagnosis.

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
- A real-key Jev + Docker live-use test remains. Current GitHub CI run 75 marked all jobs
  failed, but the connector could not fetch job logs. Local tests/build/typecheck/format/
  lint and desktop E2E pass.
- The GitHub Support purge for closed PR refs and cached views remains outstanding; keep
  the repository private until resolved.
- Desktop packages are unsigned and will show operating-system warnings.
- Follow-up work includes code signing/notarization and deeper end-to-end coverage for
  routine editing and remote pairing.
