/**
 * Minimal ambient types for the tiny slice of Electron's API this WS0
 * skeleton uses. WS6 ("Desktop shell (Electron, three OSes)") owns adding
 * the real `electron` dependency (main/preload/renderer wiring,
 * `utilityProcess` host, tray, notifications, packaging) and deleting this
 * file — see `README.md` in this package for why WS0 stubs it instead of
 * depending on the real, large, network-downloaded `electron` package.
 */
declare module "electron" {
  export interface BrowserWindowOptions {
    width?: number;
    height?: number;
    show?: boolean;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowOptions);
    loadFile(path: string): Promise<void>;
    show(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }

  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    quit(): void;
  };

  export const ipcMain: {
    handle(channel: string, listener: (...args: unknown[]) => unknown | Promise<unknown>): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: Record<string, unknown>): void;
  };
}
