/** What the Electron preload exposes as `window.openbot` (absent in the browser/PWA). */
export interface DesktopNavigateTarget {
  kind: "thread" | "setup" | "home" | "settings";
  threadId?: string;
}

interface DesktopApi {
  platform?: string;
  onNavigate?: (callback: (target: DesktopNavigateTarget) => void) => () => void;
}

export function desktopApi(): DesktopApi | undefined {
  return (globalThis as { openbot?: DesktopApi }).openbot;
}

/** Marks <html> so CSS can leave room for macOS window controls and make headers draggable. */
export function markDesktopPlatform(): void {
  const platform = desktopApi()?.platform;
  if (platform && typeof document !== "undefined") {
    document.documentElement.dataset.desktop = platform === "darwin" ? "mac" : platform;
  }
}
