# Check iPhone app after macOS upgrade

- **Fecha**: 2026-09-29 11:59
- **Agente**: Codex
- **Rama**: claude/product-polish @ a38063d

## Objective
Try the native iPhone app after the macOS upgrade.

## Findings
- macOS is 27.0 (build 26A428), so the OS upgrade is complete.
- The active toolchain remains Xcode 16.2 with iOS/iOS Simulator SDK 18.2.
- CoreSimulatorService is unavailable and no simulator runtimes are installed; `simctl list devices` fails.
- `devicectl list devices` times out initializing CoreDevice, so the attached phone is not currently usable from this toolchain.
- The native workspace exists at `apps/mobile/ios/OpenBot.xcworkspace`; the first build attempt used a relative path and was invalid. Further build attempts are blocked by the outdated Xcode and unavailable simulator services.

## Next steps
Install a current Xcode with Swift tools 6.2 support, finish first-launch setup, install an iOS 27 simulator runtime or reconnect the phone, verify CoreSimulator/CoreDevice, then run the Expo development build and manually inspect pairing and the host-backed screens.

## Retro
- Worked: checking macOS, SDK versions, simulator service, and CoreDevice isolated the remaining setup issue.
- Failed: the initial workspace build used a relative path; use the full workspace path or run from `apps/mobile/ios`.
- Improve: after an OS upgrade, verify the active Xcode selection and simulator services before attempting an app build.
