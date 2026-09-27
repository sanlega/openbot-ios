import { contextBridge, ipcRenderer } from "electron";
import type { DeepLinkTarget, OpenbotDesktopApi } from "./types";

const api: OpenbotDesktopApi = {
  getHarnessStatus: () => ipcRenderer.invoke("openbot:harness-status") as Promise<string>,
  getLocalComputerPermissions: () =>
    ipcRenderer.invoke("openbot:local-computer-permissions") as Promise<
      ReturnType<OpenbotDesktopApi["getLocalComputerPermissions"]> extends Promise<infer T>
        ? T
        : never
    >,
  onNavigate(callback: (target: DeepLinkTarget) => void) {
    const listener = (_event: unknown, target: DeepLinkTarget) => callback(target);
    ipcRenderer.on("openbot:navigate", listener);
    return () => ipcRenderer.removeListener("openbot:navigate", listener);
  },
};

contextBridge.exposeInMainWorld("openbot", api);
