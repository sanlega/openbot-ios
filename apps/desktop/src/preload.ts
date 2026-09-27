import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openbot", {
  getHarnessStatus: (): Promise<string> =>
    ipcRenderer.invoke("openbot:harness-status") as Promise<string>,
});
