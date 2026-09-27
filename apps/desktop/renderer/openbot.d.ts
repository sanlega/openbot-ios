import type { OpenbotDesktopApi } from "../src/types.js";

declare global {
  interface Window {
    openbot: OpenbotDesktopApi;
  }
}

export {};
