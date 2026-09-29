# Windows host: ship the native iPhone pairing protocol and fix LAN pairing UX

- **Date**: 2026-09-29 · **Author**: claude (desktop repo session) · **Status**: draft, handed off
- **Origin**: live attempt to pair the iPhone app with a Windows desktop build of
  `sanlega/OpenBot` v0.1.1 (tag `v0.1.1`, `d778a21`).

## Goal
A fresh QR from the installed Windows desktop app pairs the native iPhone app on the
same Wi-Fi and reaches a connected Home screen plus a live WS event.

## Diagnosis (verified 2026-09-29 on the Windows host)
1. **Root cause of `Pairing failed: invalid_request`**: the published desktop repo
   (`sanlega/OpenBot`, v0.1.1) only has the OLD clear-field pairing and unscoped E2E
   framing. This repo's iPhone app sends the sealed payload. The host port
   ("Support the native iPhone pairing and scoped E2E protocol", made in the sibling
   desktop checkout on the Mac) is **not pushed**, so `sanlega/OpenBot` and the
   installers never had it. Files that differ between the checkouts include
   `packages/remote/src/{crypto,framing,pairing,integration,index}.ts`,
   `packages/core/src/{ws,context}.ts`, `packages/core/src/http/{auth,server,schemas}.ts`;
   use the sibling commit as the source of truth, not this list.
2. **LAN mode works**: with `~/.openbot/network.json` `{ "lanAccess": true }` the
   harness binds `0.0.0.0:4577`, Windows Firewall already allows `openbot.exe` on the
   Public profile, and `http://<lan-ip>:4577/app` answers 200 from the PC itself.
3. **QR link scheme bug** (host, still present in this repo's `pairing.ts`):
   `buildQrUrl` always emits `https://<host>/app#pair=…` even when only plain-HTTP LAN
   URLs exist; opening it in Safari gives "invalid request" (TLS hello to an HTTP
   server). The native app reads the fragment payload, so it may not matter for the
   app scanner, but it breaks opening the link by hand. Fix already made in the desktop
   repo commit `ac9673a` (local, unpushed): `buildQrUrl(host, session, scheme)` and
   `/api/devices/pair/qr` passes `http` unless a URL is `https://`; test added.
4. **UX bug**: any 401 (e.g. opening the LAN URL in a browser on the same PC, since
   non-loopback needs a device token) renders "Can't reach OpenBot… Retrying…"
   instead of an "unpaired device" screen. (Desktop/PWA UI.)
5. **Startup oddity**: the harness sometimes logs a `127.0.0.1` bind ~5 s before the
   `0.0.0.0` one although `lanAccess` is true. Suspect `readNetworkPrefs` falling back
   to `false` on a torn read (`writeNetworkPrefs` is not atomic).

## Tasks
- [ ] T1 (owner approval to push): push the sibling host commit, or re-apply it onto
  `sanlega/OpenBot` `main` (Windows checkout is at `d778a21`, clean). Verify: lint,
  format, build, typecheck, tests, integration E2E.
- [ ] T2: carry over the QR scheme fix (item 3) on top of the ported `pairing.ts`.
- [ ] T3: cut `v0.1.2` of the desktop app (release workflow on tag `v*`; bump every
  `package.json` version + `SERVER_VERSION` in `apps/server/src/index.ts` and
  `packages/core/src/http/routes/health.ts`; CHANGELOG entry). Owner has NOT yet
  approved publishing; ask first.
- [ ] T4: install the v0.1.2 `.exe` on the Windows PC (close the app first, check no
  running turns in `~/.openbot/openbot.db` `turns`), open Devices, generate a fresh QR
  (single use, expires), scan in the iPhone app. Verify Home + a WS event.
- [ ] T5 (separate, smaller): "unpaired device" screen for 401s in the desktop/PWA UI;
  atomic write + retry read for `network.json`.

## Risks
- The pairing secret is single use and expires: always use a fresh QR per attempt.
- The desktop lists several private IPs (Wi-Fi + virtual adapters, e.g. a WSL/Hyper-V
  `172.x`); the phone may try an unreachable one first. Keep address failures
  distinguishable from decoding failures.
- E2E secretstream framing is stateful: a harness restart drops the server session.
  Confirm the ported scoped streams recover after a restart or reconnect.
