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
