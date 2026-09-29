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

The desktop sends notifications straight to Apple (APNs) with **your own** key; there
is no OpenBot relay and no key inside the app. It needs a paid Apple Developer team
(free Personal Team builds cannot receive push).

1. In the Apple Developer portal, under Certificates, Identifiers & Profiles → Keys,
   create a key with "Apple Push Notifications service (APNs)" enabled. Download the
   `.p8` file (Apple lets you download it once) and note its Key ID and your Team ID.
2. On the desktop: Settings → Devices → Phone notifications. Paste the Key ID, Team ID,
   and the `.p8`. The key is stored in the desktop vault.
3. Build the app with your paid team and the push entitlements:

   ```sh
   xcodebuild -workspace OpenBot.xcworkspace -scheme OpenBot -configuration Release \
     -destination 'id=<device-udid>' -derivedDataPath build/device-release \
     DEVELOPMENT_TEAM=<paid-team-id> CODE_SIGN_STYLE=Automatic \
     CODE_SIGN_ENTITLEMENTS=OpenBot/OpenBotPush.entitlements -allowProvisioningUpdates build
   ```

4. On the iPhone: Settings → Notifications → on, then "Send a test" on the desktop.

You are notified about approvals, Bot questions, updates the Chief of Staff decides to
push, and replies to your messages. Replies from the chat you have open stay quiet.
Turn off "Show message text" on the desktop to keep message text out of notifications.
