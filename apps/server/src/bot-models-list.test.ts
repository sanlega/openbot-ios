import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreContext } from "@openbot/core";
import type { TurnMailboxDeps } from "./turn-mailbox.js";
import { modelLister } from "./bot-models.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("modelLister", () => {
  it("uses Claude API-key catalog from the vault and keeps other engine catalogs", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const vaultGet = vi.fn(async () => "vault-anthropic-key");
    const claudeList = vi.fn(async () => ({
      models: [{ id: "claude-model-2026", label: "Claude 2026" }],
      source: "api" as const,
    }));
    const claudeFallback = vi.fn(async () => [{ id: "claude-old", label: "Claude Old" }]);
    const codexFallback = vi.fn(async () => [{ id: "codex-model", label: "Codex Model" }]);
    const ctx = { vault: { get: vaultGet } } as unknown as CoreContext;
    const deps = {
      drivers: {
        claude: { listModels: claudeFallback },
        codex: { listModels: codexFallback },
      },
    } as unknown as TurnMailboxDeps;

    const result = await modelLister(ctx, deps, claudeList)();

    expect(vaultGet).toHaveBeenCalledWith("anthropic.apiKey");
    expect(claudeList).toHaveBeenCalledWith("vault-anthropic-key");
    expect(claudeFallback).not.toHaveBeenCalled();
    expect(codexFallback).toHaveBeenCalledOnce();
    expect(result).toEqual([
      { engine: "claude", models: [{ id: "claude-model-2026", label: "Claude 2026" }] },
      { engine: "codex", models: [{ id: "codex-model", label: "Codex Model" }] },
    ]);
  });

  it("uses the Claude CLI catalog when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchClaudeModels = vi.fn();
    const claudeList = vi.fn(async () => [{ id: "claude-cli", label: "Claude CLI" }]);
    const ctx = { vault: { get: async () => undefined } } as unknown as CoreContext;
    const deps = {
      drivers: { claude: { listModels: claudeList } },
    } as unknown as TurnMailboxDeps;

    await expect(modelLister(ctx, deps, fetchClaudeModels)()).resolves.toEqual([
      { engine: "claude", models: [{ id: "claude-cli", label: "Claude CLI" }] },
    ]);
    expect(fetchClaudeModels).not.toHaveBeenCalled();
  });
});

describe("modelLister cache", () => {
  it("serves the last list at once and refreshes a stale one in the background", async () => {
    let t = 0;
    let calls = 0;
    let release: (() => void) | undefined;
    const slow = vi.fn(async () => {
      calls += 1;
      if (calls > 1) await new Promise<void>((r) => (release = r));
      return [{ id: `m${calls}`, label: `M${calls}` }];
    });
    const ctx = { vault: { get: async () => undefined } } as unknown as CoreContext;
    const deps = { drivers: { opencode: { listModels: slow } } } as unknown as TurnMailboxDeps;
    const list = modelLister(ctx, deps, vi.fn(), () => t);

    expect((await list())[0]!.models[0]!.id).toBe("m1");
    t = 61_000;
    // Stale: answered from the cache while the slow refresh runs.
    expect((await list())[0]!.models[0]!.id).toBe("m1");
    expect(slow).toHaveBeenCalledTimes(2);
    release?.();
    await new Promise((r) => setTimeout(r, 0));
    expect((await list())[0]!.models[0]!.id).toBe("m2");
  });

  it("keeps the previous list when a refresh fails", async () => {
    let t = 0;
    const flaky = vi
      .fn()
      .mockResolvedValueOnce([{ id: "ok", label: "OK" }])
      .mockRejectedValueOnce(new Error("down"));
    const ctx = { vault: { get: async () => undefined } } as unknown as CoreContext;
    const deps = { drivers: { cursor: { listModels: flaky } } } as unknown as TurnMailboxDeps;
    const list = modelLister(ctx, deps, vi.fn(), () => t);
    await list();
    t = 61_000;
    await list();
    await new Promise((r) => setTimeout(r, 0));
    expect((await list())[0]!.models).toEqual([{ id: "ok", label: "OK" }]);
  });
});
