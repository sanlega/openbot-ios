# iPhone app redesign, features, and live-update fix

- **Fecha**: 2026-09-29 15:23
- **Agente**: claude
- **Rama**: main @ 387e2a6

## Done
- Mobile redesign and features per the plan (T1-T6): themed primitives, desktop-matched
  avatars, native tabs, Home/Chats/Inbox/Settings, chat with live streaming, inline
  approval and question cards, routines, paste-link pairing. Pure helpers are tested
  (format, live, inputs, markdown, routines, frames).
- Found and fixed: JSON-quoted E2E WebSocket frames (no live updates or send
  confirmations on the phone), approvals failing to parse (null resolution), reversed
  chat order, stale streaming bubble after turn end, markdown bullet overflow.
- Desktop checkout: WebSocket frame fix committed locally (b0c8795), not pushed.
- Checks: 809 unit tests, monorepo typecheck, lint, format.

## Next
- Walk through the new screens on the physical iPhone with the Windows host.
- Push both repositories when the owner approves; rebuild Windows to pick up the host fix.
- Consider fixing the shared `Approval.resolution` contract (nullable) with review.

## Retro
- Driving the simulator through Metro's CDP endpoint and a dev-only bridge made visual
  verification possible without touch input; every real bug came from that loop.
- Node's lenient Base64 hid the frame bug from an existing-looking test; assert wire shape.
- A leftover harness on 127.0.0.1 shadowed the new 0.0.0.0 one; check listeners first.
