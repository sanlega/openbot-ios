import type { Tray, Menu, NativeImage, App } from "electron";

export interface TrayFactory {
  create(image: NativeImage): Tray;
  buildFromTemplate(template: Electron.MenuItemConstructorOptions[]): Menu;
  createFromPath(path: string): NativeImage;
}

export interface TrayController {
  setTooltip(text: string): void;
  destroy(): void;
}

/** System tray with show/hide and quit actions; supports login-at-startup (plan §5 WS6). */
export function createAppTray(
  factory: TrayFactory,
  app: App,
  icon: NativeImage,
  onShow: () => void,
  onQuit: () => void,
): TrayController {
  const tray = factory.create(icon);

  const menu = factory.buildFromTemplate([
    { label: "Show OpenBot", click: onShow },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]);

  tray.setContextMenu(menu);

  return {
    setTooltip(text: string) {
      tray.setToolTip(text);
    },
    destroy() {
      tray.destroy();
    },
  };
}
