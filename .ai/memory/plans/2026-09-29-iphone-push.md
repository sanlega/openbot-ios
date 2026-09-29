# iPhone push notifications (direct APNs, user-owned key)

## Goal
The paired iPhone gets native OpenBot notifications for approvals, Bot questions,
NotifyGate-pushed updates, and Bot replies, even when the app is closed. The desktop
sends them straight to Apple with the owner's own APNs auth key; there is no relay.

## Constraints
- APNs needs a paid Apple Developer account: free Personal Team profiles carry no
  `aps-environment` entitlement. The push entitlement lives in a separate
  entitlements file used only for paid-team builds, so free builds keep signing.
- The `.p8` key is stored in the desktop vault; never in the app or the repo.
- Notification text passes through Apple; an owner switch hides previews.

## Design
- Host (`packages/remote/src/push/`): APNs sender (ES256 JWT + HTTP/2, injectable
  transport), JSON push store under `OPENBOT_HOME` (config + device tokens), pure
  content builder, and an event-bus notifier. Routes: device registers/unregisters
  its token (E2E like every paired request); owner reads/saves APNs config and
  sends a test. Token environment is learned: production first, sandbox on
  `BadDeviceToken`; `Unregistered` drops the token.
- Desktop UI: "Phone notifications" card under Devices.
- Phone: `expo-notifications` for permission, device token, foreground display, and
  tap → chat deep link. Settings row to turn notifications on or off with a clear
  message when the build has no push entitlement.

## Tasks
- [ ] T1 Host push module + tests (JWT shape, content, notifier routing, token
      environment fallback, unregistered cleanup).
- [ ] T2 Routes + wiring in bootstrap + integration tests.
- [ ] T3 Desktop UI card (this checkout and the sibling desktop checkout).
- [ ] T4 Phone: notifications module, registration, settings UI, tap handling.
- [ ] T5 Paid-team build instructions; verify with a real key when available.
