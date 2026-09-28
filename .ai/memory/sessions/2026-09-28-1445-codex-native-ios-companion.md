# Native iOS companion implementation

- **Fecha**: 2026-09-28 14:45
- **Agente**: Codex
- **Rama**: claude/product-polish

## Done
- Completed the API/remote architecture inventory and recorded the implementation plan.
- Added `apps/mobile` with Expo Router, secure pairing, Keychain persistence, shared contract validation, encrypted HTTP/WebSocket sessions, reconnect handling, Home/Bots/Threads/Activity/Approvals/Settings, message/approval/stop actions, and optional-push documentation.
- Added D-020 and generic remote transport changes for sealed pairing/auth proofs, independent scoped E2E streams, replay prevention, and revoked-device WebSocket command rejection.
- No desktop renderer changes were needed, so no GitHub issue was created.
- Verified full tests (791 passed, 17 skipped), monorepo build, mobile/core typecheck, lint (0 errors, 3 existing warnings), format check, Expo iOS export/config, and dependency versions.

## Pending
- `expo run:ios` generated the native iOS project, but simulator compilation could not continue because CocoaPods is unavailable; manual simulator review remains.
- `mh check` reports stale `.agents` skill files because this checkout omits those read-only files. Generated metaharness files were not modified.
- Approval/auth/session tests cover core protocol paths; broader mobile UI and command integration tests can still be added.

## Retro
- Worked: tracing the existing Client API and pairing flow avoided adding mobile-specific business APIs; a separate scope per transport made restart recovery work without another renewal endpoint.
- Failed: Expo's first pass silently tolerated an SDK patch mismatch until `expo install --check`; pin versions against the SDK map before native prebuild.
- Improve: verify native build tooling (especially CocoaPods) before attempting simulator compilation, while still validating config and JS bundling independently.
