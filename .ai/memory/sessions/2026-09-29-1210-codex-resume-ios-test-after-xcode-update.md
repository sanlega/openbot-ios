# Resume iOS test after Xcode update

- **Fecha**: 2026-09-29 12:10
- **Agente**: Codex

## Objective
Resume native iPhone testing after the user updated Xcode.

## Findings
- Xcode 27.0 (27A266a) is installed and selected on macOS 27.0.
- All Xcode developer commands are blocked until the Xcode and Apple SDK license agreements are accepted. `xcodebuild -showsdks`, `simctl list devices`, and `devicectl list devices` each report this gate.
- No build or app launch was attempted after this gate was found.

## Next steps
The owner should review and accept the agreement with `sudo xcodebuild -license` in Terminal. Then verify SDKs, simulator runtimes, and the attached phone; install an iOS 27 simulator runtime if desired; run the Expo development build and inspect pairing and host-backed screens.

## Retro
- Worked: checking Xcode version first confirmed the update succeeded and exposed the explicit license gate.
- Blocked: Apple requires local license acceptance before any SDK/device commands can run.
- Improve: after Xcode updates, accept its license before trying simulator or device commands.
