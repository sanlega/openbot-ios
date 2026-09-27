import { nativeImage, type NativeImage } from "electron";
import { existsSync } from "node:fs";

/** 1×1 embedded tray icon fallback when `renderer/icon.png` is absent. */
const TRAY_ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function loadTrayIcon(iconPath: string): NativeImage {
  if (existsSync(iconPath)) return nativeImage.createFromPath(iconPath);
  return nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, "base64"));
}
