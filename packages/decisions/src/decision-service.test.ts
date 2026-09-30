import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Bot } from "@openbot/contracts";
import { FakeJevServer } from "./fake-jev-server.js";
import { createDecisionService } from "./decision-service.js";
import { buildSpawnQuestions } from "./questions/spawn.js";
import { conservativeFallbackAnswers } from "./fallbacks.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures/jev");

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, path), "utf8"));
}

describe("DecisionServiceImpl", () => {
  let server: FakeJevServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new FakeJevServer({ apiKey: "sk-test" });
    ({ url: baseUrl } = await server.listen());
  });

  afterEach(async () => {
    await server.close();
  });

  it("decide() calls fake-jev, logs requestId, and records a decision row", async () => {
    const service = createDecisionService({ apiKey: "sk-test", baseUrl });
    const fixture = readFixture("choice/route.request.json") as {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };

    const result = await service.decide({
      purpose: "delegate",
      state: fixture.state,
      questions: fixture.questions as never,
    });

    expect(result.provider).toBe("jev");
    expect(result.requestId).toBeTruthy();
    expect(result.decisionId.startsWith("dec_")).toBe(true);
    expect(service.decisions()).toHaveLength(1);
    expect(service.decisions()[0]?.requestId).toBe(result.requestId);
  });

  it("degrades conservatively when fake-jev is unreachable", async () => {
    const service = createDecisionService({ apiKey: "sk-test", baseUrl: "http://127.0.0.1:1" });
    const questions = buildSpawnQuestions({ "research-bot": "research" });
    const result = await service.decide({
      purpose: "spawn",
      state: { user_requested: false, request: { name: "x" } },
      questions,
    });

    expect(result.provider).toBe("heuristic");
    expect(result.answers.route?.type).toBe("choice");
    if (result.answers.route?.type === "choice") {
      expect(result.answers.route.choice).toBe("cos_itself");
    }
    expect(service.decisions()[0]?.requestId).toBeUndefined();
  });

  it("route() parses engine:model from Jev choice answers", async () => {
    server.scriptedAnswers.route = {
      type: "choice",
      choice: "codex:gpt-5",
      confidence: 0.95,
      probabilities: { "codex:gpt-5": 1 },
    };

    const service = createDecisionService({ apiKey: "sk-test", baseUrl });
    const bot: Bot = {
      id: "bot_1",
      slug: "assistant",
      name: "Assistant",
      description: "General helper",
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: "user",
      routing: { mode: "auto" },
      permissionPreset: "workspace_write",
      computer: "none",
      connectors: [],
      limits: {},
    };

    const decision = await service.route(bot, "refactor the auth module", {
      availableEngines: ["claude", "codex"],
      modelsCatalog: {
        claude: ["sonnet"],
        codex: ["gpt-5"],
      },
    });

    expect(decision.engine).toBe("codex");
    expect(decision.model).toBe("gpt-5");
    expect(decision.band).toBe("auto");
  });

  it("route() keeps a model id that has its own colon (local Ollama models)", async () => {
    server.scriptedAnswers.route = {
      type: "choice",
      choice: "opencode:ollama/qwen3:8b",
      confidence: 0.95,
      probabilities: { "opencode:ollama/qwen3:8b": 1 },
    };
    const service = createDecisionService({ apiKey: "sk-test", baseUrl });
    const bot = {
      id: "bot_2",
      name: "Local",
      description: "",
      routing: { mode: "auto" },
      computer: "none",
    } as Bot;
    const decision = await service.route(bot, "say hi", {
      availableEngines: ["opencode"],
      modelsCatalog: { opencode: ["ollama/qwen3:8b"] },
      localModels: ["opencode:ollama/qwen3:8b"],
    });
    expect(decision.engine).toBe("opencode");
    expect(decision.model).toBe("ollama/qwen3:8b");
  });
});

describe("conservativeFallbackAnswers", () => {
  it("refuses spawn unless user_requested", () => {
    const questions = buildSpawnQuestions({});
    const denied = conservativeFallbackAnswers({
      purpose: "spawn",
      state: { user_requested: false },
      questions,
    });
    expect(denied.route?.type).toBe("choice");
    if (denied.route?.type === "choice") expect(denied.route.choice).toBe("cos_itself");

    const allowed = conservativeFallbackAnswers({
      purpose: "spawn",
      state: { user_requested: true },
      questions,
    });
    if (allowed.route?.type === "choice") expect(allowed.route.choice).toBe("new_bot");
  });

  it("risk fallback never lands in auto band", () => {
    const answers = conservativeFallbackAnswers({
      purpose: "risk",
      state: {},
      questions: {
        external_side_effect: { type: "noul", instructions: "?" },
      },
    });
    expect(answers.external_side_effect?.type).toBe("noul");
    if (answers.external_side_effect?.type === "noul") {
      expect(answers.external_side_effect.noul).toBeGreaterThan(0.5);
    }
  });
});
