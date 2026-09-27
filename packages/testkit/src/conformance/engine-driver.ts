import { describe, expect, it } from "vitest";
import type { Bot, EngineDriver, EngineEvent, TurnInput } from "@openbot/contracts";

const sampleBot = (): Bot => ({
  id: "bot_conformance",
  slug: "conformance-bot",
  name: "Conformance Bot",
  description: "Used only by the EngineDriver conformance suite.",
  pinned: false,
  hidden: false,
  isChiefOfStaff: false,
  createdBy: "user",
  routing: { mode: "auto" },
  permissionPreset: "workspace_write",
  computer: "none",
  connectors: [],
  limits: {},
});

function sampleTurnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    bot: sampleBot(),
    text: "hello",
    attachments: [],
    systemPrompt: "You are a helpful bot.",
    cwd: "/workspace",
    addDirs: [],
    auth: { mode: "api_key", env: {} },
    mcpServers: [],
    permission: "workspace_write",
    allowTools: [],
    denyTools: [],
    model: "fake-default",
    limits: { maxSteps: 10 },
    ...overrides,
  };
}

/**
 * Plan §5 WS0 "conformance suite skeletons": generic behavioral assertions any
 * `EngineDriver` (real or fake) must satisfy. WS3 runs this same suite against
 * `packages/engines/claude` and `packages/engines/codex` once they land.
 */
export function runEngineDriverConformance(
  label: string,
  makeDriver: () => EngineDriver | Promise<EngineDriver>,
): void {
  describe(`EngineDriver conformance: ${label}`, () => {
    it("detect() resolves without throwing", async () => {
      const driver = await makeDriver();
      const status = await driver.detect();
      expect(typeof status.installed).toBe("boolean");
      await driver.dispose();
    });

    it("listModels() returns at least one model", async () => {
      const driver = await makeDriver();
      const models = await driver.listModels();
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(typeof model.id).toBe("string");
        expect(model.id.length).toBeGreaterThan(0);
      }
      await driver.dispose();
    });

    it("startTurn() emits session_started before completing, and done resolves", async () => {
      const driver = await makeDriver();
      const events: EngineEvent[] = [];
      const handle = driver.startTurn(sampleTurnInput(), {
        emit: (e) => events.push(e),
        requestApproval: async () => "allow",
      });

      const result = await handle.done;

      expect(events.some((e) => e.type === "session_started")).toBe(true);
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId.length).toBeGreaterThan(0);
      expect(typeof result.usage.inputTokens).toBe("number");
      expect(typeof result.usage.outputTokens).toBe("number");
      await driver.dispose();
    });

    it("interrupt() resolves without throwing mid-turn", async () => {
      const driver = await makeDriver();
      const handle = driver.startTurn(sampleTurnInput(), {
        emit: () => {},
        requestApproval: async () => "allow",
      });
      await handle.interrupt();
      await handle.done.catch(() => undefined);
      await driver.dispose();
    });
  });
}
