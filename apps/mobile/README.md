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

## Push notifications

Push is not required for the app to work. iOS suspends background JavaScript and
WebSockets, so the app refreshes its authoritative state when opened or foregrounded.
Reliable push requires a server that can send to APNs after receiving and storing the
device's APNs token. OpenBot does not run a hosted backend. A future implementation
can let an owner configure their own APNs provider credentials on the desktop host or
connect an optional self-hosted relay. A signing key must not be embedded in the
OpenBot app binary. Until then, approvals and failures appear when the user opens the
app and reconnects.
