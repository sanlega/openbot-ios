import { describe, expect, it } from "vitest";
import { CodexDriver } from "./driver.js";
import type { CodexAppServer } from "./app-server.js";

describe("Codex model discovery", () => {
  it("exposes visible models returned by the authenticated app-server", async () => {
    const driver = new CodexDriver({
      appServer: {
        listModels: async () => [
          { id: "codex-alpha", model: "codex-alpha", displayName: "Codex Alpha", hidden: false },
          { id: "codex-beta", displayName: "Codex Beta" },
          { displayName: "Malformed entry" },
        ],
      } as unknown as CodexAppServer,
    });

    await expect(driver.listModels()).resolves.toEqual([
      { id: "codex-alpha", label: "Codex Alpha" },
      { id: "codex-beta", label: "Codex Beta" },
    ]);
  });

  it("falls back to the bundled catalog when the CLI lacks model/list", async () => {
    const driver = new CodexDriver({
      appServer: {
        listModels: async () => {
          throw new Error("method not found");
        },
      } as unknown as CodexAppServer,
    });

    await expect(driver.listModels()).resolves.toEqual([
      { id: "gpt-6-astra", label: "GPT-6 Astra", contextWindow: 256_000 },
    ]);
  });
});

describe("Codex errors end the turn with Codex's reason", () => {
  it("a non-retryable 400 (model not supported) completes the turn as an error", async () => {
    const { createCodexParseState, handleCodexNotification } = await import("./parse-events.js");
    const state = createCodexParseState();
    handleCodexNotification(
      {
        jsonrpc: "2.0",
        method: "error",
        params: {
          willRetry: false,
          error: {
            message:
              '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'o4-mini\' model is not supported when using Codex with a ChatGPT account."}}',
          },
        },
      },
      state,
      { emit: () => undefined },
    );
    expect(state.turnComplete).toBe(true);
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toBe(
      "The 'o4-mini' model is not supported when using Codex with a ChatGPT account.",
    );
  });
});
