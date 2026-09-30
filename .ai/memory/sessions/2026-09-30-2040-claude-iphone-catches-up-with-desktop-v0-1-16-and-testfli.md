# iPhone catches up with desktop v0.1.16 and TestFlight script

- **Fecha**: 2026-09-30 20:40
- **Agente**: claude
- **Rama**: main @ 243bd18

## Done
- Synced host code from sanlega/OpenBot v0.1.16 (build, typecheck, 1234 tests, lint, format pass).
- iPhone: delegations in the requester's chat, engine names in the chat header, failure
  reasons (event-only failures counted), Settings > Saved logins. Verified in the simulator
  with a fake-engine harness (delegation -> worker approval -> approve -> result).
- TestFlight script with push entitlements; archive/export verified, not uploaded.

## Next
- Owner: App Store Connect app record, export-compliance answer, then run the upload.
- Later (owner): Computer/Docker control on the phone; needs a desktop live-view relay.

## Retro
- Worked: driving the simulator through Metro CDP (needs the `ws` package with an
  Origin header and a short delay after open; Hermes doesn't honor awaitPromise, so
  store results in a global and poll).
- Failed: `simctl openurl` for the dev client leaves an "Open in OpenBot?" system alert
  that keeps the app inactive; reboot the simulator and `simctl launch` instead.
- Pairing ignores loopback URLs, so a test harness needs lanAccess in network.json.
