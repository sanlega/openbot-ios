# OpenBot Mobile

The native companion is an Expo Router / React Native client in the OpenBot pnpm
workspace. It uses the existing Client API and shared `@openbot/contracts`; it does
not host or execute Bots.

## Development

Use Node 22.12+ and pnpm 10, then install from the repository root:

```sh
pnpm install
pnpm --filter @openbot/mobile start
pnpm --filter @openbot/mobile ios
```

The mobile app includes a native libsodium module for OpenBot's existing X25519 and
secretstream protocol, so use an Expo development build (`expo run:ios`) rather than
Expo Go. QR scanning uses the camera and requests access only when pairing starts.
This app is pinned to Expo SDK 57, which requires Xcode 26.4 or newer for an iOS
native build. A JavaScript export can run on older toolchains, but it does not validate
native linking.

## Standalone build on your own iPhone

A Release build embeds the JavaScript bundle, so it runs without Metro or a cable and
connects to your desktop over Wi-Fi, Tailscale, or a Cloudflare tunnel. With a free
Apple ID ("Personal Team") the signature lasts 7 days; a paid developer account gives a
year. Re-run the same two commands to renew it; pairing survives a reinstall.

```sh
cd apps/mobile/ios && pod install
xcodebuild -workspace OpenBot.xcworkspace -scheme OpenBot -configuration Release \
  -destination 'id=<device-udid>' -derivedDataPath build/device-release \
  DEVELOPMENT_TEAM=<your-team-id> CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build
xcrun devicectl device install app --device <device-udid> \
  build/device-release/Build/Products/Release-iphoneos/OpenBot.app
```

`xcrun devicectl list devices` shows the UDID; the team ID is on your signing
certificate (`security find-identity -v -p codesigning`). To go back to the
development client, build and install the Debug configuration again.

## Push notifications

Push is not required for the app to work. iOS suspends background JavaScript and
WebSockets, so the app refreshes its authoritative state when opened or foregrounded.
Reliable push requires a server that can send to APNs after receiving and storing the
device's APNs token. OpenBot does not run a hosted backend. A future implementation
can let an owner configure their own APNs provider credentials on the desktop host or
connect an optional self-hosted relay. A signing key must not be embedded in the
OpenBot app binary. Until then, approvals and failures appear when the user opens the
app and reconnects.
