import type { BrowserWindow } from "electron";
import type { DeepLinkTarget } from "./types.js";

export interface WindowManagerOptions {
  createWindow: () => BrowserWindow;
  loadUi: (win: BrowserWindow) => Promise<void>;
}

/** Keeps the harness running when the user closes the window (plan §5 WS6 acceptance). */
export class WindowManager {
  private window?: BrowserWindow;
  private quitting = false;

  constructor(private readonly options: WindowManagerOptions) {}

  setQuitting(value: boolean): void {
    this.quitting = value;
  }

  show(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.options.createWindow();
      this.attachCloseHandler(this.window);
      void this.options.loadUi(this.window);
    } else {
      this.window.show();
      this.window.focus();
    }
  }

  hide(): void {
    this.window?.hide();
  }

  get mainWindow(): BrowserWindow | undefined {
    return this.window;
  }

  navigate(target: DeepLinkTarget): void {
    this.show();
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    win.webContents.send("openbot:navigate", target);
  }

  private attachCloseHandler(win: BrowserWindow): void {
    win.on("close", (event) => {
      if (!this.quitting) {
        event.preventDefault();
        win.hide();
      }
    });
  }
}
