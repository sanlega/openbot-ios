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

## Next
- Scan a new, single-use QR on the physical device and verify that pairing reaches
  a connected screen. The harness and Metro are running for this live attempt.
- If pairing fails, inspect the new error and the running server before changing
  the crypto protocol. The current scanner preserves the error until retry.
- Finish the connected-screen walkthrough and mark T3 in the active plan.

## Retro
- Comparing the package's web and native entry points revealed the missing exports;
  an ordinary TypeScript check could not detect them.
- CocoaPods retained the previous pnpm package path after patching. Re-running pod
  installation before the device build is necessary for native dependency patches.
- A fresh QR is required for each live attempt because pairing codes expire and are
  single-use.
