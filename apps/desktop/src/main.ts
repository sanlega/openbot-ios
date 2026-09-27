import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchHarnessStatus } from "./harness-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_BASE_URL = process.env.OPENBOT_SERVER_URL ?? "http://127.0.0.1:4577";

/**
 * WS0 skeleton main process: one window, one IPC handler, enough to satisfy
 * "the desktop shell shows 'harness connected'". WS6 owns the real
 * main/preload wiring, `utilityProcess` host, tray, notifications, and
 * cross-OS packaging.
 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 480,
    height: 320,
    show: true,
    webPreferences: {
      preload: join(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(join(here, "../renderer/index.html"));
}

ipcMain.handle("openbot:harness-status", async () => fetchHarnessStatus(SERVER_BASE_URL));

void app.whenReady().then(createWindow);
