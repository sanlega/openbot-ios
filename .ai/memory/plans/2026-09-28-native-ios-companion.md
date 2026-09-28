# Plan: Native iOS companion

- **Date**: 2026-09-28 · **Status**: in progress
- **Request**: add a focused Expo/React Native iOS client for a running OpenBot host. The phone must inspect and control the host through its existing Client API and remote pairing system, with approvals remaining authoritative on the host.

## Goal

From an iPhone, a user can pair once with their existing OpenBot host, reconnect securely, inspect Bots, conversations, activity, and approvals, send a message, and resolve approvals. Mobile is a second API client; it does not run agents or maintain authoritative conversation state.

## Scope

**In**: `apps/mobile`; workspace and CI configuration; a small platform-compatible client layer only where required; tests using fake Client API responses; API extensions only when needed for a generic remote client lifecycle; architecture and push-notification constraints documented.

**Out**: changes to desktop renderer/UI, remote desktop, hosted OpenBot relay/backend, agent execution on iOS, full desktop settings parity, mandatory push, routines authoring, and credentials for Claude/Codex/Jev on the phone.

## Existing API and reuse map

| Mobile capability | Existing implementation |
|---|---|
| QR pairing | `POST /api/devices/pair/qr` and sealed `POST /api/devices/pair/complete` in `packages/remote/src/integration.ts`; QR payload `{hostPub,pairSecret,urls[]}`; the existing device token is returned inside a secretbox response; device revocation is `DELETE /api/devices/:id` in `packages/core/src/http/routes/devices.ts`. |
| Remote crypto | X25519 + libsodium secretstream in `packages/remote/src/{crypto,framing}.ts`; HTTP and WebSocket E2E hooks in `packages/remote/src/integration.ts` and `packages/core/src/ws.ts`. The native app mirrors the wire primitives with `react-native-libsodium`; Node `crypto`, `KeyObject`, and `Buffer` prevent direct Expo import. |
| Bots | `GET /api/bots` (`packages/core/src/http/routes/bots.ts`), `Bot` contract (`packages/contracts/src/entities.ts`); current execution state is reconstructed from event types. |
| Threads/messages | `GET /api/threads`, `GET /api/threads/:id/messages`, send via WS command `message.send`, stop via `POST /api/threads/:id/stop`; see `packages/core/src/http/routes/threads.ts`, `packages/core/src/ws.ts`. |
| Activity/realtime | `GET /api/activity` provides messages; `/api/ws` subscribe with numeric `since` replays durable events and streams live events. Event delivery order cannot be assumed (`.ai/memory/LESSONS.md`). |
| Approvals | `GET /api/approvals?status=pending`; `POST /api/approvals/:id/resolve` with `{resolution:'allow'|'deny'}` returns authoritative approval or 404/409. |
| Host health/remote | `GET /api/health`, `GET /api/remote/status`; role guards and revocation are enforced by the host. |

No new business API is needed for the core read/send/approve workflows. Fresh independent random scope IDs on each client instance give HTTP and WebSocket separate secretstream state and let iOS restart without an additional renewal endpoint. Device auth seals the existing bearer token with the device/host ECDH key and a time-bounded, replay-protected nonce; pairing seals both request and response. Encrypted responses also apply behind loopback proxies. Plaintext pairing completion is rejected. Existing bearer auth remains for other current clients.

### Reuse and additions

- **Reuse unchanged**: `/api/bots`, `/api/threads`, message/activity queries, approval query/resolve, thread stop, health, WebSocket subscribe/replay/events/commands, shared Zod contracts, desktop-issued QR material, and the host's DeviceAuth/revocation authority.
- **Add a mobile adapter**: `apps/mobile/src/connection/client.ts` validates responses with `@openbot/contracts`; `native-crypto.ts` implements the existing X25519/SPKI, secretbox, and secretstream wire format using React Native libsodium. No DOM UI or core business logic was copied.
- **Generic remote transport changes**: make pairing payloads confidential, keep bearer proofs out of clear headers, scope HTTP and WS streams independently, account for reverse proxies, reject proof replays, and stop commands from revoked sockets. These apply to API clients generally and add no mobile-only routes, schemas, tables, or migrations.

### Expo compatibility and security constraints

- Expo Router and TanStack Query are JS-only integration points; shared contracts bundle successfully in Metro. `packages/remote` is Node-bound, so only its established wire protocol is mirrored behind a native adapter.
- `react-native-libsodium` requires native CocoaPods/Xcode setup and an Expo development build; Expo Go cannot load it. Pin React Native and safe-area-context to Expo SDK's bundled versions. `expo export` validates Metro, not native linking or simulator execution.
- SecureStore uses iOS Keychain. Device token proof encryption uses the paired host key and a one-use five-minute nonce. HTTP/WS response payloads are E2E encrypted; TLS remains preferred, since connection metadata and error responses are not hidden by response framing.
- Push is not dependable without an APNs sender. A sender requires user-owned host credentials or an optional separately operated relay; no OpenBot cloud dependency is added.

## Architecture choices

- Keep `@openbot/contracts` as the shared entity/event schema source. Zod schemas and types are runtime-neutral; do not import the DOM-oriented `@openbot/ui` or the Node-bound `@openbot/remote` into the app.
- Add `apps/mobile` to the existing `apps/*` workspace glob. Use Expo Router, React Native, TypeScript, TanStack Query, SecureStore/Keychain, camera QR scan, and Expo lifecycle APIs.
- Keep a thin mobile Client API adapter in the app unless a portable extraction proves useful to both web and native. Do not move UI state or business rules out of `packages/ui` just for nominal sharing.
- Preserve the wire-compatible X25519/SPKI and libsodium `secretstream` framing. Use `react-native-libsodium` behind `apps/mobile/src/connection/native-crypto.ts`; require an Expo development build because custom native modules are not in Expo Go. Configure its Expo plugin/autolinking support.
- Use HTTP for query/mutations and WS for events and `message.send`/`turn.stop`; reconcile by durable event sequence and refresh authoritative query snapshots on foreground/reconnect.
- Store host URL, device id, bearer token, and private device key only in iOS Keychain through Expo SecureStore. Keep transient framing stream state in memory and re-negotiate on process start/revocation/restart.
- APNs/Expo push is optional. Reliable background push needs a provider that can call APNs plus device-token registration. OpenBot has no hosted backend, and embedding a shared APNs signing key in the desktop binary is unsafe. V1 remains correct in foreground/manual-refresh mode; document direct user-owned APNs credentials or a separately operated optional relay as future options.

## Acceptance criteria

1. `pnpm --filter @openbot/mobile typecheck` and Expo bundle/config validation run in the monorepo.
2. The app parses the existing QR fragment and completes existing device pairing with the host.
3. A process restart recovers the saved device from Keychain, establishes fresh independent authenticated encrypted streams, and does not ask for pairing again.
4. Revoked/expired devices show a clear re-pair state and cannot issue queries or commands.
5. Home, Bots, Threads, Activity, and Approvals show host-backed data; pending approvals remain visible across tabs.
6. Thread updates stream from `/api/ws`; reconnect uses backoff, subscribes from the durable cursor, and refreshes query snapshots.
7. Message send and approval resolve use existing commands/routes; API failures leave the UI unchanged and refresh authoritative state.
8. Tests cover response parsing, event ordering/replay cursor, backoff/lifecycle, duplicate/stale approval actions, message submission, revocation, and malformed payloads using fakes only.
9. No desktop UI code changes. Any required desktop follow-up is recorded as a GitHub issue for owner review.

## Tasks

| # | Task | Files / areas | Verification |
|---|---|---|---|
| 1 | [x] Read metaharness, architecture, contracts, API routes, remote framing, PWA/UI boundary, and identify session-reset/security gaps | `.ai/memory/*`, `docs/architecture.md`, `packages/{core,remote,contracts,ui}`, `apps/{server,pwa,desktop}` | Trace routes and confirm existing pairing/event implementations; written mapping in this plan |
| 2 | [x] Define the generic mobile auth/session protocol and crypto compatibility; add ADR and server tests | `packages/remote`, `packages/core`, `.ai/memory/DECISIONS.md` | D-020; sealed pairing/auth, independent HTTP/WS scopes, encrypted responses, replay check |
| 3 | [x] Add Expo workspace skeleton, config, scripts, and monorepo Metro setup | `apps/mobile/*`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | mobile typecheck and Expo iOS bundle |
| 4 | [x] Implement SecureStore API client, QR pairing, E2E framing, and lifecycle connection state | `apps/mobile/src/connection/*` | connection and QR parser unit tests; auth integration test |
| 5 | [x] Implement queries, durable WS cursor/reconciliation, and TanStack Query integration | `apps/mobile/src/connection/*`, `apps/mobile/src/app/*` | contiguous cursor and query invalidation on events/reconnect |
| 6 | [x] Implement mobile navigation and core read views with global approval badge | `apps/mobile/src/app/*`, `apps/mobile/src/components/*` | Expo iOS bundle; manual simulator review remains |
| 7 | [x] Implement send-message, stop, approve and deny actions with authoritative outcomes | `apps/mobile/src/connection/client.ts`, `apps/mobile/src/app/*` | action waits for host response; expanded fake tests remain |
| 8 | [ ] Document install/run/security/push boundaries; complete lint, format, build, typecheck, tests and metaharness memory | `apps/mobile/README.md`, `docs/architecture.md`, `.ai/memory/*` | root format/lint/build/typecheck/tests/mh check; Expo simulator manual pass |

## Risks

1. **Native crypto parity**: only exact libsodium framing matches the existing protocol. The mobile adapter uses matching primitives; a broader cross-implementation vector suite remains useful.
2. **Stream state loss**: process death destroys stream cursors. New random scoped streams on each client instance avoid reusing server cursors without new pairing.
3. **Transport confidentiality**: device tokens are sealed in request headers and responses use E2E framing, while TLS remains preferred for remote links. Error responses retain ordinary HTTP error bodies and should not contain secrets.
4. **iOS backgrounding**: iOS suspends JS and sockets; no persistent WebSocket/push assumption. Mitigation: close/pause work in background and reconcile on foreground; APNs stays optional.
5. **Expo monorepo/native dependencies**: pnpm workspace linking and custom libsodium module may need Expo dev-client/autolinking config. Mitigation: validate a minimal iOS bundle/build early, before implementing many screens.

## Progress

- [x] T1 · [x] T2 · [x] T3 · [x] T4 · [x] T5 · [x] T6 · [x] T7 · [ ] T8
