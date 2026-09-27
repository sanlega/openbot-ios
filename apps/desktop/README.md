# `@openbot/desktop`

Electron desktop shell for OpenBot (plan §5 WS6). Runs the harness in an
Electron `utilityProcess`, hosts the WS5 UI when available, and provides tray,
notifications, `safeStorage` vault, deep links (`openbot://`), and cross-OS
packaging via `electron-builder`.

## Development

```bash
# From repo root — build server + desktop, then launch Electron
pnpm --filter @openbot/server build
pnpm --filter @openbot/desktop build
pnpm --filter @openbot/desktop start
```

The window loads `http://127.0.0.1:4577/app` when the harness serves it (WS5);
otherwise it falls back to `renderer/index.html`, which polls harness status.

## Tests

```bash
pnpm --filter @openbot/desktop test          # Vitest unit tests
pnpm --filter @openbot/server build
pnpm --filter @openbot/desktop build
pnpm --filter @openbot/desktop test:e2e      # Playwright _electron smoke
```

## Packaging

```bash
pnpm --filter @openbot/server build
pnpm --filter @openbot/desktop build
pnpm --filter @openbot/desktop dist
```

Installers: macOS universal DMG, Windows NSIS (x64 + arm64), Linux AppImage + deb.
Signing/notarization uses CI secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, Apple
credentials) when present.

## WS0 → WS6 note (D-016)

WS0 stubbed the `electron` dependency with `electron-shim.d.ts` so CI stayed fast.
WS6 adds the real `electron` package and deletes the shim.
