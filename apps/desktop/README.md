# `@openbot/desktop`

WS0 skeleton for the plan's acceptance criterion "the desktop shell shows
'harness connected'" (`.ai/memory/plans/openbot-v1.md` §5 WS0). **WS6**
("Desktop shell (Electron, three OSes)") owns the real implementation:
`utilityProcess` host, tray, notifications, and cross-OS packaging.

## Why there's no real `electron` dependency yet

The `electron` npm package's postinstall step downloads a large
(~100 MB+), OS-specific binary from GitHub releases. Depending on that here,
in a 3-OS CI matrix, for a skeleton that WS6 will still rewrite trades a lot
of CI reliability/time for very little: this package can't launch a real
window or display anything in this sandbox anyway (no display, no packaged
binary). So WS0 ships:

- `src/electron-shim.d.ts`: local ambient types for the tiny Electron surface
  used below (`BrowserWindow`, `app`, `ipcMain`, `ipcRenderer`,
  `contextBridge`) — enough for `main.ts`/`preload.ts` to typecheck and build
  exactly as they would against the real `electron` types.
- `src/main.ts` / `src/preload.ts` / `renderer/index.html`: real,
  structurally-correct Electron main/preload/renderer code — one window, one
  IPC handler (`openbot:harness-status`) — that WS6 can run as-is once it
  adds the real `electron` dependency and deletes `electron-shim.d.ts`.
- `src/harness-client.ts`: the actual "is the harness connected" logic
  (`fetchHarnessStatus`/`formatHarnessStatus`), used by both the IPC handler
  and this package's Vitest suite — this is what's actually tested here,
  since the Electron window itself can't be driven headlessly in this
  environment.

Run `apps/server` (`pnpm --filter @openbot/server dev`) and this package's
renderer will show "Harness connected (v0.1.0)" once WS6 wires up the real
`electron` runtime.
