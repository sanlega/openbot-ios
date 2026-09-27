import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  Notification,
  safeStorage,
  shell,
  systemPreferences,
  Tray,
  Menu,
  utilityProcess,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { fetchHarnessStatus, waitForHarnessReady } from "./harness-client.js";
import {
  APP_NAME,
  DEFAULT_PORT,
  PROTOCOL,
  defaultOpenbotHome,
  harnessBaseUrl,
  harnessWsUrl,
} from "./config.js";
import {
  createNodeForkFactory,
  createUtilityProcessFactory,
  HarnessHost,
  resolvePackagedHarnessEntry,
  resolvePwaStaticRoot,
} from "./harness-host.js";
import { HarnessEventStream } from "./event-stream.js";
import { Vault } from "./vault.js";
import { parseDeepLink } from "./deep-link.js";
import { getLocalComputerPermissions } from "./permissions.js";
import { createAppTray } from "./tray.js";
import { showPushNotification } from "./os-notifications.js";
import { WindowManager } from "./window-manager.js";
import { loadTrayIcon } from "./tray-icon.js";
import type { DeepLinkTarget } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(here, "../renderer");
const iconPath = join(rendererDir, "icon.png");
// macOS menu bar icons are monochrome "template" images the system tints.
const trayIconPath = join(
  rendererDir,
  process.platform === "darwin" ? "trayTemplate.png" : "icon.png",
);

let harnessHost: HarnessHost | undefined;
let eventStream: HarnessEventStream | undefined;
let trayController: ReturnType<typeof createAppTray> | undefined;
let windowManager: WindowManager | undefined;
let pendingDeepLink: string | undefined;

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const openbotHome = defaultOpenbotHome();
const vault = new Vault(join(openbotHome, "vault.bin"), safeStorage);

function createBrowserWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    title: APP_NAME,
    icon: iconPath,
    width: 1240,
    height: 800,
    minWidth: 880,
    minHeight: 580,
    // macOS: the sidebar runs under the traffic lights, like other native messengers.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e0f11" : "#ffffff",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Links in Bot messages open in the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(harnessBaseUrl(port)) || url.startsWith("file:")) return;
    event.preventDefault();
    openExternalLink(url);
  });
  return win;
}

function openExternalLink(url: string): void {
  if (/^https?:\/\//i.test(url) || url.startsWith("mailto:")) void shell.openExternal(url);
}

async function loadUi(win: BrowserWindow): Promise<void> {
  win.once("ready-to-show", () => {
    win.show();
  });

  const appUrl = `${harnessBaseUrl(port)}/app`;
  try {
    const res = await fetch(appUrl, { method: "HEAD" });
    if (res.ok) {
      await win.loadURL(appUrl);
      return;
    }
  } catch {
    // WS5 UI not served yet — fall back to bundled shell page.
  }
  await win.loadFile(join(rendererDir, "index.html"));
}

function handleDeepLink(url: string): void {
  const target = parseDeepLink(url);
  if (!target) return;
  windowManager?.navigate(target);
}

function registerProtocol(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1] ?? ""]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

function extractDeepLinkArg(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
}

function startHarness(): void {
  const packaged = app.isPackaged;
  harnessHost = new HarnessHost({
    port,
    openbotHome,
    fork: packaged ? createUtilityProcessFactory(utilityProcess) : createNodeForkFactory(),
    harnessEntry: packaged ? resolvePackagedHarnessEntry() : undefined,
    pwaStaticRoot: resolvePwaStaticRoot(),
  });
  harnessHost.start();
}

function startEventStream(): void {
  eventStream = new HarnessEventStream(harnessWsUrl(port), {
    OPEN: WebSocket.OPEN,
    create(url: string) {
      const ws = new WebSocket(url);
      return {
        readyState: ws.readyState,
        send: (data) => ws.send(data),
        close: () => ws.close(),
        addEventListener: (type, listener) => {
          ws.on(type, listener as (...args: unknown[]) => void);
        },
        removeEventListener: (type, listener) => {
          ws.off(type, listener as (...args: unknown[]) => void);
        },
      };
    },
  });

  eventStream.on("notify", (event) => {
    showPushNotification(
      {
        isSupported: () => Notification.isSupported(),
        create: (options) => {
          const n = new Notification(options);
          return {
            show: () => n.show(),
            on: (event, listener) => n.on(event, listener),
          };
        },
      },
      event,
      handleDeepLink,
    );
  });

  eventStream.start();
}

function setupIpc(): void {
  ipcMain.handle("openbot:harness-status", async () => fetchHarnessStatus(harnessBaseUrl(port)));

  ipcMain.handle("openbot:local-computer-permissions", async () =>
    getLocalComputerPermissions(process.platform, process.env.XDG_SESSION_TYPE, systemPreferences),
  );

  ipcMain.handle("openbot:vault-available", async () => vault.isAvailable());

  ipcMain.handle("openbot:vault-get", async (_event, key: string) => vault.get(key));

  ipcMain.handle("openbot:vault-set", async (_event, key: string, value: string) => {
    vault.set(key, value);
  });
}

function setupTray(): void {
  const loaded = loadTrayIcon(trayIconPath);
  if (process.platform === "darwin") loaded.setTemplateImage(true);
  const icon =
    process.platform === "darwin" || loaded.isEmpty()
      ? loaded
      : loaded.resize({ width: 16, height: 16 });
  trayController = createAppTray(
    {
      create: (image) => new Tray(image),
      buildFromTemplate: (template) => Menu.buildFromTemplate(template),
      createFromPath: (path) => loadTrayIcon(path),
    },
    app,
    icon,
    () => windowManager?.show(),
    () => {
      windowManager?.setQuitting(true);
      app.quit();
    },
  );
  trayController.setTooltip(APP_NAME);
}

function setupWindowManager(): void {
  windowManager = new WindowManager({
    createWindow: createBrowserWindow,
    loadUi,
  });
}

function setupAppMenu(): void {
  const isMac = process.platform === "darwin";
  const openSettings = () => windowManager?.navigate({ kind: "settings" });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [
            {
              label: APP_NAME,
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : [
            {
              label: "File",
              submenu: [
                { label: "Settings", accelerator: "CmdOrCtrl+,", click: openSettings },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]),
      { role: "editMenu" as const },
      {
        label: "View",
        submenu: [
          { role: "reload" as const },
          { role: "toggleDevTools" as const },
          { type: "separator" as const },
          { role: "resetZoom" as const },
          { role: "zoomIn" as const },
          { role: "zoomOut" as const },
          { type: "separator" as const },
          { role: "togglefullscreen" as const },
        ],
      },
      { role: "windowMenu" as const },
    ]),
  );
}

async function onReady(): Promise<void> {
  try {
    setupAppMenu();
    // The packaged app gets its Dock icon from the bundle; dev runs need it set.
    if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(iconPath);
    registerProtocol();
    setupIpc();
    setupWindowManager();
    setupTray();
    startHarness();
    await waitForHarnessReady(harnessBaseUrl(port), app.isPackaged ? 90_000 : 30_000);
    startEventStream();
    windowManager?.show();

    const deepLink = pendingDeepLink ?? extractDeepLinkArg(process.argv);
    if (deepLink) handleDeepLink(deepLink);
  } catch (err: unknown) {
    console.error("[openbot-desktop] startup failed", err);
    app.quit();
  }
}

app.on("window-all-closed", () => {
  // Keep harness and tray alive when the user closes the window (plan §5 WS6).
});

app.on("before-quit", () => {
  windowManager?.setQuitting(true);
  eventStream?.stop();
  harnessHost?.stop();
  trayController?.destroy();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) handleDeepLink(url);
  else pendingDeepLink = url;
});

// Dev runs inherit "Electron" from the bundle; the packaged app is named by electron-builder.
app.setName(APP_NAME);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = extractDeepLinkArg(argv);
    if (deepLink) handleDeepLink(deepLink);
    windowManager?.show();
  });

  void app.whenReady().then(onReady);
}

// Re-export for tests that import navigation helpers.
export type { DeepLinkTarget };
