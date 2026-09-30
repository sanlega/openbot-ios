import { describe, expect, it } from "vitest";
import { buildRouteQuestions } from "./route.js";

describe("buildRouteQuestions", () => {
  it("names engines by label, marks local models, and offers at most 8 models per engine", () => {
    const many = Array.from({ length: 20 }, (_, i) => `cloud/m${i}`);
    const q = buildRouteQuestions({
      availableEngines: ["claude", "opencode"],
      modelsCatalog: { claude: ["sonnet"], opencode: ["ollama/qwen3:8b", ...many] },
      engineInfo: {
        claude: { label: "Claude Code", summary: "Anthropic's agent" },
        opencode: { label: "OpenCode" },
      },
      localModels: ["opencode:ollama/qwen3:8b"],
    });
    const criteria = q.route!.type === "choice" ? q.route!.criteria : {};
    expect(criteria["claude:sonnet"]).toBe("Claude Code engine using sonnet (Anthropic's agent)");
    expect(criteria["opencode:ollama/qwen3:8b"]).toMatch(/local model on this computer/);
    expect(Object.keys(criteria).filter((k) => k.startsWith("opencode:"))).toHaveLength(8);
  });
});
