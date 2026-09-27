# Jev Computer UI and Codex o4 turn diagnosis

## Completed

- Reviewed the current branch and prior Claude handoff. Jev computer control is implemented and pushed: MCP task/status/steer/cancel; Jev selects bounded click/type/select/scroll/key/wait/done/blocked actions from observations; OpenBot validates targets and uses the permission broker; risky steps wait for approval; failures stop safely. The UI is the bot's **Computer** tab, visible when `bot.computer !== "none"`, with a task timeline, text input, and Stop. Current two bots have computer access; `/api/computer/tasks` returns an empty task list because no task is running.
- Diagnosed the user's stuck `o4-mini` attempt from the local DB. Event `turn.started` for Codex/o4-mini had no completion until app restart, which emitted `turn.interrupted` with "OpenBot restarted before this turn finished." The later Claude attempt failed immediately with the session quota message. Source cause: installed app bundle timestamp 00:25 predated `aa028d1` (00:34), which fixes recursive `initialize` waiting in `CodexAppServer.start()`; the fixed code has a regression test.
- Rebuilt, signed, backed up, installed, and relaunched the current macOS app. Existing user data was not modified. Its `/api/models` responds in 36 ms and returns seven Codex model IDs; Claude returns bundled aliases because this machine is using CLI login, with no documented OAuth catalog endpoint. `/api/computer/tasks` responds normally.
- Wired Claude's API-key model discovery into `modelLister`; the API key is read from `ANTHROPIC_API_KEY` or the vault and is only passed to the Anthropic Models API helper. Added server tests for vault-key vs CLI mode.
- Root test suite: 767 passed, 17 skipped; typecheck, lint (three pre-existing warnings), format, build, `mh check`, and desktop E2E pass. The desktop E2E requires the installed single-instance app to be closed; first attempts while OpenBot was open failed at launch, then passed after closing it. The app was reopened.
- The Linux-only `smoke:packaged` script cannot find a Linux `*-unpacked` directory when run against a macOS-only pack; the mac package itself built and the native SQLite Electron runtime probe passed.
- GitHub run 75 for `aa028d1` shows ten failed jobs, but the connector returns no job steps/logs (`BlobNotFound`). Recheck CI after the next push; do not merge before exact-head required checks pass.
- Follow-up commit `6568bf7` was pushed; run 76 also reports ten failed jobs with no job steps or logs. The currently authenticated Codex catalog does not include `o4-mini`; the Chief is now set to Auto. Pin one of the seven visible catalog IDs if a fixed Codex model is desired.

## Remaining

1. Ask the user to confirm they can now send a message using the Chief pinned to Codex/o4-mini. Do not send a real prompt on their behalf.
2. Let the user test an actual Jev task with their configured Jev key and running Docker computer. We verified app wiring and local test coverage but did not start a real computer task.
3. Investigate why all ten jobs fail on run 76; obtain GitHub Support/Actions access that exposes logs or reproduce each job locally.
4. Keep the repository private until GitHub Support purges stale closed PR refs 1–16.

## Retro

- What worked: SQLite turn/events plus build timestamps tied the long-running o4 turn to the stale installed app and separated it from Claude's quota error.
- What failed: the first Electron smoke attempt collided with the running single-instance app; the Linux-only package smoke script was invoked on macOS and therefore could not run.
- Improve next time: check for an already-running Electron instance before desktop E2E, verify a smoke script's platform assumptions before invoking it, and compare the installed bundle timestamp with the source commit before debugging current code.
