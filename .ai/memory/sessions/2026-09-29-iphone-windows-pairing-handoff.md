# iPhone to Windows pairing handoff

## Verified state
- The physical iPhone launches the native app and pairs with the macOS harness.
  The connected Home screen shows host data and the host lists the device.
- The iPhone can reach the Windows host's LAN status endpoint in Safari.
  A fresh Windows QR scanned inside the native app returns
  `Pairing failed: invalid_request`.
- A deliberately malformed, non-secret `sealed` POST with the public-key header
  returns `invalid_request` from the Windows host. The compatible macOS host
  reaches the sealed-payload decrypt path instead. This isolates a server
  protocol mismatch rather than a cable, iOS permission, or LAN failure.
- The sibling OpenBot repo's `packages/remote/src/integration.ts` expects clear
  `pairSecret`, `devicePub`, and `name` fields and returns a clear token. The
  native client sends `{sealed}` and `x-openbot-pair-pub`, then expects a sealed
  response. Its framing code also differs: the native client uses independent
  scoped E2E sessions for HTTP and WebSocket, while the sibling host retains an
  older per-device session. Updating only the pairing route is insufficient.

## Local work
- Earlier iPhone crypto/native/UI fixes are committed as `6149dc6`.
- Pending iPhone changes at handoff: pass `Uint8Array` to Expo Crypto digest;
  skip loopback URLs in phone pairing; time out unreachable addresses after
  eight seconds; show the server's pairing error. Focused tests, mobile
  typecheck, and lint passed before handoff.
- Preserve unrelated pre-existing deletions under `.agents/skills`, generated
  mobile environment files, and older untracked session notes when committing.

## Next
1. Update the sibling OpenBot repo's pairing route and E2E framing according to
   its protocol plan, preserving legacy PWA behavior where required.
2. Verify native-format sealed pairing and an encrypted HTTP/WS flow against the
   updated desktop server. Then rebuild and install Windows and repeat with a
   fresh QR on the physical phone.
3. Avoid writing actual QR payloads, credentials, device names, LAN addresses,
   or machine-specific paths to public memory, fixtures, or logs.

## Retro
- Comparing the two source trees and sending a harmless malformed request to
  each host identified the protocol mismatch without exposing a pairing secret.
- The initial network-timeout symptom obscured the real server response;
  surfacing the response code made the failure actionable.
- Future cross-platform pairing changes need a wire-level compatibility check
  against the packaged desktop version, not only the macOS development server.
