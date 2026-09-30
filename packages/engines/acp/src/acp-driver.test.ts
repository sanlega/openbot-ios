import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Bot, EngineEvent, ToolApprovalRequest, TurnInput } from "@openbot/contracts";
import { runEngineDriverConformance } from "@openbot/testkit";
import { AcpDriver } from "./acp-driver.js";
import type { AcpProfile } from "./profile.js";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-agents", "fake-agent.mjs");

function fakeProfile(env: Record<string, string>, extra: Partial<AcpProfile> = {}): AcpProfile {
  return {
    id: "acp-fake",
    label: "Fake ACP",
    binaries: [process.execPath],
    loginCommand: "fake login",
    authMethodId: "fake_login",
    async detect() {
      return { version: "1.0", login: { ok: true } };
    },
    async listModels() {
      return [{ id: "m1", label: "Model One" }];
    },
    async launch() {
      return { args: [AGENT], env, systemPrompt: "prompt" };
    },
    ...extra,
  };
}

const bot: Bot = {
  id: "bot_acp",
  slug: "acp-bot",
  name: "ACP Bot",
  description: "",
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

let dir: string;

function input(text: string, overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    bot,
    text,
    attachments: [],
    systemPrompt: "You are a test bot.",
    cwd: dir,
    addDirs: [],
    auth: { mode: "login", env: {} },
    mcpServers: [{ name: "openbot", command: "node", args: ["shim.js"], env: { TOKEN: "t" } }],
    permission: "workspace_write",
    allowTools: [],
    denyTools: [],
    model: "default",
    limits: { maxSteps: 50 },
    ...overrides,
  };
}

async function turn(
  driver: AcpDriver,
  text: string,
  overrides: Partial<TurnInput> = {},
  approve: (r: ToolApprovalRequest) => "allow" | "deny" = () => "allow",
) {
  const events: EngineEvent[] = [];
  const approvals: ToolApprovalRequest[] = [];
  const handle = driver.startTurn(input(text, overrides), {
    emit: (e) => events.push(e),
    requestApproval: async (r) => {
      approvals.push(r);
      return approve(r);
    },
  });
  const result = await handle.done;
  const reply = events
    .filter((e): e is Extract<EngineEvent, { type: "text_delta" }> => e.type === "text_delta")
    .map((e) => e.text)
    .join("");
  return { result, events, approvals, reply, handle };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openbot-acp-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const newDriver = (env: Record<string, string> = {}, extra: Partial<AcpProfile> = {}) =>
  new AcpDriver(fakeProfile({ FAKE_ACP_STATE: dir, ...env }, extra), {
    enginesDir: join(dir, "engines"),
    cancelTimeoutMs: 3_000,
  });

describe("AcpDriver", () => {
  it("streams the reply, passes MCP servers, and sends the system prompt on a new session", async () => {
    const { result, events, reply } = await turn(newDriver(), "hello");
    expect(result.isError).toBe(false);
    expect(events[0]).toMatchObject({ type: "session_started" });
    expect(reply).toContain("mcp=openbot");
    expect(reply).toContain("instructions=true");
    expect(reply).toContain("text=hello");
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 3, usd: 0.01 });
    expect(events.at(-1)).toMatchObject({ type: "usage", inputTokens: 7 });
  });

  it("resumes with session/load without replaying history, and skips an unchanged system prompt", async () => {
    const driver = newDriver();
    const first = await turn(driver, "one");
    const second = await turn(driver, "two", { sessionId: first.result.sessionId });
    expect(second.result.sessionId).toBe(first.result.sessionId);
    expect(second.reply).not.toContain("REPLAY");
    expect(second.reply).toContain("instructions=false");
    expect(second.reply).toContain("text=two");
  });

  it("uses session/resume when the agent offers it", async () => {
    const driver = newDriver({ FAKE_ACP_RESUME: "1" });
    const first = await turn(driver, "one");
    const second = await turn(driver, "two", { sessionId: first.result.sessionId });
    expect(second.result.sessionId).toBe(first.result.sessionId);
    expect(second.reply).toContain("text=two");
  });

  it("starts a new session when the stored one is gone", async () => {
    const { result } = await turn(newDriver(), "hi", { sessionId: "fake_missing" });
    expect(result.isError).toBe(false);
    expect(result.sessionId).not.toBe("fake_missing");
  });

  it("selects the model through the session's model option and learns the agent's models", async () => {
    const driver = newDriver();
    const { reply } = await turn(driver, "hi", { model: "m2" });
    expect(reply).toContain("model=m2");
    expect((await driver.listModels()).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("asks OpenBot before a tool runs and answers with the agent's allow-once option", async () => {
    const { approvals, reply, events } = await turn(newDriver(), "@tool rm -rf build");
    expect(approvals).toEqual([
      { toolName: "Bash", input: { command: "rm -rf build" }, toolUseId: "exec_1" },
    ]);
    expect(reply).toContain("allowed");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_started", toolName: "Bash", toolUseId: "exec_1" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_completed", toolUseId: "exec_1", isError: false }),
    );
  });

  it("a denial picks reject-once, never an 'always' option", async () => {
    const { reply } = await turn(newDriver(), "@tool rm -rf build", {}, () => "deny");
    expect(reply).toContain("denied(reject)");
  });

  it("names MCP tools like Claude does, so allowTools and Activity recognise them", async () => {
    const { events } = await turn(newDriver(), "@mcp");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_started", toolName: "mcp__openbot__message_user" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_completed", toolUseId: "mcp_1", output: "delivered" }),
    );
  });

  it("interrupt() cancels the prompt and the turn ends as interrupted", async () => {
    const driver = newDriver();
    const events: EngineEvent[] = [];
    const handle = driver.startTurn(input("@slow"), {
      emit: (e) => events.push(e),
      requestApproval: async () => "allow",
    });
    while (!events.some((e) => e.type === "session_started")) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    await handle.interrupt();
    const result = await handle.done;
    expect(result).toMatchObject({ isError: true, errorMessage: "interrupted" });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("stops at the step limit", async () => {
    const { result } = await turn(newDriver(), "@steps 30", { limits: { maxSteps: 5 } });
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/step limit/);
  });

  it("a crash fails the turn with the agent's last stderr lines", async () => {
    const { result } = await turn(newDriver(), "@crash");
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/stopped unexpectedly.*boom: something broke/);
  });

  it("an auth error is reported as a sign-in problem with the login command", async () => {
    const { result, events } = await turn(newDriver(), "@auth");
    expect(result.errorMessage).toMatch(/sign in.*fake login/);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", authFailure: true }));
  });

  it("steering while a turn runs becomes the next prompt of the same turn", async () => {
    const driver = newDriver();
    const events: EngineEvent[] = [];
    const handle = driver.startTurn(input("@steps 3 first"), {
      emit: (e) => events.push(e),
      requestApproval: async () => "allow",
    });
    await handle.steer("second");
    const result = await handle.done;
    const reply = events.map((e) => (e.type === "text_delta" ? e.text : "")).join("");
    expect(result.isError).toBe(false);
    expect(reply).toContain("text=second");
  });

  it("a reply that is only a transport failure becomes an error", async () => {
    const driver = newDriver(
      {},
      { replyFailure: (r) => (r.includes("mcp=") ? "lost" : undefined) },
    );
    const { result } = await turn(driver, "hi");
    expect(result).toMatchObject({ isError: true, errorMessage: "lost" });
  });

  it("stops a turn whose agent writes outside the workspace without asking", async () => {
    const outside = join(tmpdir(), "somewhere-else", "x.txt");
    const { result } = await turn(newDriver(), `@write ${outside}`);
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/outside this bot's workspace, without asking/);
  });

  it("lets an unasked write inside the workspace, or under Full, through", async () => {
    const inside = await turn(newDriver(), `@write ${join(dir, "a.txt")}`);
    expect(inside.result.isError).toBe(false);
    const full = await turn(newDriver(), `@write ${join(tmpdir(), "elsewhere.txt")}`, {
      permission: "full",
    });
    expect(full.result.isError).toBe(false);
  });

  it("reports a missing CLI without starting anything", async () => {
    const driver = new AcpDriver(
      { ...fakeProfile({}), binaries: [join(dir, "nope.exe")] },
      { enginesDir: join(dir, "engines") },
    );
    expect((await driver.detect()).installed).toBe(false);
    const { result } = await turn(driver, "hi");
    expect(result.errorMessage).toMatch(/not installed/);
  });
});

runEngineDriverConformance("acp (fake agent)", () => {
  const home = mkdtempSync(join(tmpdir(), "openbot-acp-conf-"));
  const driver = new AcpDriver(fakeProfile({ FAKE_ACP_STATE: home }), {
    enginesDir: join(home, "engines"),
    cancelTimeoutMs: 2_000,
  });
  // The suite runs turns in "/workspace", which does not exist on a test machine.
  const startTurn = driver.startTurn.bind(driver);
  driver.startTurn = (turnInput, hooks) => startTurn({ ...turnInput, cwd: home }, hooks);
  return driver;
});
