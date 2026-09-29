# Start macOS upgrade for iOS testing

- **Fecha**: 2026-09-29 10:51
- **Agente**: Codex
- **Rama**: claude/product-polish @ a38063d

## Objective
Begin the authorized toolchain upgrade needed to install the native app on the iOS 27 device.

## Changes
Launched the downloaded macOS 27 installer and updated the ignored local continuation note with the current authorization step. The simulator runtimes had already been removed to create upgrade space.

## Decisions
The owner authorized the upgrade and restart. The upgrade has not started because `startosinstall` requires local administrator authentication; the installer UI is open for authorization. No password was entered or recorded.

## Pending
Continue in the macOS installer UI and authorize with the local account. After macOS 27 starts, install Xcode 27 and resume building and launching the Expo development client on the paired iPhone. Follow `.ai/local/mobile-ios-device-session.md` for machine state.

## Retro
- Worked: staging the full OS installer ahead of time avoided a long download during the upgrade.
- Failed or costly: command-line installation required local administrator credentials and noninteractive AppleScript authorization did not work.
- Improve: for macOS upgrades, use the native installer UI for authorization and report clearly when human input is needed.
