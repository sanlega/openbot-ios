# iPhone pairing crypto and UI repair

## Completed
- Reproduced the pairing Base64 failure: the host emits standard padded Base64,
  while the mobile libsodium binding defaults to unpadded URL-safe Base64.
- Made the mobile wire format explicit and replaced unavailable `crypto.randomUUID`
  with a native random session ID. Added a focused regression test.
- Found that the installed native libsodium binding does not export X25519 scalar
  multiplication or secretstream despite its web API doing so. Added a pnpm patch
  for both primitives, rebuilt CocoaPods and the iOS app, and installed it on the
  physical device. The rebuilt static library contains the new JSI exports.
- Fixed dark scroll surfaces, tab icons, and the scanner error retry state. A
  physical-device screenshot confirms the unpaired Home screen is readable.
- Focused Vitest, iOS build, monorepo typecheck, lint, and targeted formatting pass.
  Lint reports only three existing warnings in unrelated files.
- The first physical QR scan exposed a separate native Expo Crypto argument error:
  `digest` rejected an `ArrayBuffer`. A native-shaped regression mock failed before
  the fix; passing a `Uint8Array` made it pass. The app was reloaded for a fresh QR.
- A subsequent QR paired with the macOS host. The iPhone showed a connected Home
  screen populated from that host, and the host listed one paired device.
- Pairing now skips loopback addresses advertised in QR payloads and limits each
  network attempt to eight seconds. Failures retain a useful server error code.

## Next
- In the sibling OpenBot repo, implement the current iPhone's sealed pairing
  request/response and scoped E2E sessions while preserving supported PWA clients.
  The Windows host currently responds `invalid_request` to a sealed request.
- Build and install the updated Windows desktop app, then scan a fresh QR and
  verify both HTTP and WebSocket connected flows. See the new handoff and plan.

## Retro
- Comparing the package's web and native entry points revealed the missing exports;
  an ordinary TypeScript check could not detect them.
- CocoaPods retained the previous pnpm package path after patching. Re-running pod
  installation before the device build is necessary for native dependency patches.
- A fresh QR is required for each live attempt because pairing codes expire and are
  single-use.
