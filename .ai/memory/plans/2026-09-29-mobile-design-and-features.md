# Mobile app: design pass and missing features

## Goal
Make the paired iPhone app look like a polished native iOS app that matches the
desktop's visual language, and let the phone do the everyday jobs: chat with any
Bot, answer approvals and Bot questions, follow live work, and run routines.

## Scope
- Theme tokens aligned with `packages/ui` (dark and light), shared primitives
  (avatar, pill, row, button, card, empty state, large-title screen), plain-
  language time helpers. No raw ids or `toLocaleString()` on screen.
- Native iOS tab bar (`expo-router/unstable-native-tabs`, Liquid Glass on iOS 26+):
  Home, Chats, Inbox, Settings.
- Chats: messenger roster from Bots (+ thread preview, status); a Bot with no
  thread yet can still be messaged (`message.send` without `threadId`).
- Conversation: auto-scroll, working indicator, stop, inline approvals and
  `ask_user` forms above the composer, Bot names instead of ids.
- Inbox: approvals + Bot questions (answer/dismiss) + recent activity with names.
- Routines (from Home/Settings): list, run now, pause/resume.
- Pull to refresh; pairing by pasted link (camera-less fallback).
- Only JS/TS changes: no new native modules, so no device rebuild is needed.

## Outside scope
- Push notifications (no relay), creating/editing Bots or routines on the phone,
  computer live view.

## Acceptance
1. Every screen renders in dark and light without hard-coded colors, verified by
   simulator screenshots against a local harness.
2. From the phone: send a message to a Bot without a thread, see the reply arrive
   live, approve/deny, answer a Bot question, run and pause a routine.
3. Mobile tests, typecheck, lint, and formatting pass.

## Tasks
- [x] T1 Theme + primitives + time/format helpers (tests for pure helpers).
- [x] T2 Client API additions (inputs, routines, send without thread) + tests.
- [x] T3 Native tabs, Screen with large title, Home redesign.
- [x] T4 Chats roster + conversation screen.
- [x] T5 Inbox (approvals, questions, activity) + reusable approval/input cards.
- [x] T6 Routines screen, Settings redesign, paste-link pairing.
- [ ] T7 Simulator verification against local harness (done: every screen, dark and light, send, live reply, approve); physical iPhone walkthrough pending.

## Risks
- Native tabs are marked unstable in expo-router 57; fall back to JS tabs if they
  misbehave on iOS 27.
- Query invalidation on every WS event can refetch a lot; scope invalidation by
  event type.

## Findings during verification
- Encrypted WebSocket frames were sent JSON-quoted by `packages/core/src/ws.ts`, so
  strict iOS Base64 decoding rejected every frame: no live events or send
  confirmations ever reached the phone. Fixed on the host (bare frames, one ordered
  send queue) and tolerated on the phone (`lib/frames.ts`) for older desktops.
- The host serializes `approval.resolution` as null while the contract says
  optional; the phone accepted no approvals. The mobile client now accepts null.
- `/api/threads/:id/messages` returns newest first; the chat sorts explicitly.
- Simulator verification uses a dev-only bridge (`components/DevBridge.tsx`) driven
  over Metro's CDP endpoint (origin header required), since the simulator has no
  camera or scripted touch.
