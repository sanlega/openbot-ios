# Physical iPhone pairing and visual repair

## Goal
Complete QR pairing on the installed iPhone and make every unpaired screen readable and usable on iOS 27.

## Scope
- Fix the native Base64 boundary between the Node host and React Native libsodium.
- Supply missing X25519 and secretstream native bindings through a pnpm patch.
- Replace the unsupported mobile `crypto.randomUUID` use with a secure native scope ID.
- Set explicit dark surfaces for scroll screens and show recognizable tab icons.
- Improve the scan error state so a failed QR does not immediately scan again.

## Outside scope
- Redesigning desktop/PWA screens or changing the pairing wire contract.
- Adding cloud push or new remote routes.

## Acceptance
1. A standard padded Base64 SPKI host key decodes on iPhone, and the phone writes Base64 values the Node host can read.
2. A fresh QR pairs the phone, stores credentials, and reaches a connected screen without a JavaScript error.
3. Settings, Home, and the scan screen use dark backgrounds with readable labels, and the tab bar shows distinct icons.
4. Focused checks, mobile typecheck, lint, and formatting pass; a device screenshot confirms the visual result.

## Tasks
- [x] T1: Reproduce Base64 variant and scope-ID failures; fix native crypto and add a focused regression check. Files: `apps/mobile/src/connection/native-crypto.ts`, `ConnectionProvider.tsx`, focused test. Verify against host wire format.
- [x] T2: Repair dark scroll surfaces, tab icons, and scan error state. Files: mobile UI components/routes and dependency manifest if needed. Verify on physical iPhone screenshots.
- [x] T2a: Build and install the missing native X25519 and secretstream bindings, then confirm that the installed binary contains them.
- [x] T3: Complete physical pairing with a fresh QR to the macOS host, run relevant checks, update STATE and handoff, commit only task files.
- [x] T4: Diagnose physical iPhone pairing to a Windows host on the same LAN. Its LAN endpoint is reachable; its legacy pairing route rejects the current encrypted payload with `invalid_request`.
- [ ] T5: Bring the sibling OpenBot desktop host's sealed pairing and scoped E2E framing up to the iPhone protocol, rebuild the Windows app, and verify a fresh QR plus connected API/WS flows. See the sibling repo's protocol plan.

## Risks
- A pairing secret is single use and expires; use a fresh desktop QR for each live attempt.
- The desktop can advertise an unreachable address even if crypto succeeds; keep address failures distinguishable from decoding failures.
- This is a development build: Metro must remain reachable from the phone while verifying screens.
