/** Renderer-facing API exposed through preload `contextBridge`. */
export interface OpenbotDesktopApi {
  getHarnessStatus(): Promise<string>;
  getLocalComputerPermissions(): Promise<LocalComputerPermissionStatus>;
  onNavigate(callback: (target: DeepLinkTarget) => void): () => void;
}

export interface DeepLinkTarget {
  kind: "thread" | "setup" | "home";
  threadId?: string;
}

export interface LocalComputerPermissionStatus {
  screenRecording?: "granted" | "denied" | "restricted" | "unknown" | "not-determined";
  accessibilityTrusted?: boolean;
  waylandNote?: string;
}
