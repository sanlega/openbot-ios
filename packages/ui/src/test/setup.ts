import "@testing-library/jest-dom/vitest";
import { WebSocket as NodeWebSocket } from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = NodeWebSocket as unknown as typeof WebSocket;
}
