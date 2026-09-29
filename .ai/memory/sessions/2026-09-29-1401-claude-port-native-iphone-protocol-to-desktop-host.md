# Port native iPhone protocol to desktop host

- **Fecha**: 2026-09-29 14:01
- **Agente**: claude
- **Rama**: claude/product-polish @ 844f09c

## Done
- Ported the host side of the native protocol (sealed QR pairing, sealed device
  proofs with replay window, scoped E2E streams for HTTP/WS) from this checkout
  into the sibling desktop checkout. The seven host files are now byte-identical.
- No PWA client used clear pairing, so no legacy path was kept.
- Sibling checks: lint 0 errors, format, build, typecheck, 804 unit tests,
  integration E2E 18/18.

## Next
- Push the sibling commit (needs owner approval), rebuild and install Windows,
  scan a fresh QR on the iPhone, verify Home plus a WS event.

## Retro
- Diffing the two checkouts by path and applying one scoped patch was fast and
  exact. Shell note: default node is v20; use the nvm Node 22 binary and
  `corepack pnpm`. zsh does not word-split unquoted variables in path lists.
