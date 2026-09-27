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
      { id: "o4-mini", label: "o4-mini", contextWindow: 128_000 },
    ]);
  });
});
