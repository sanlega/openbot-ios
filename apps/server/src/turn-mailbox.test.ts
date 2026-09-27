import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  newId,
  type Bot,
  type EngineDriver,
  type EngineStatus,
  type ModelInfo,
  type TurnHandle,
  type TurnHooks,
  type TurnInput,
  type TurnResult,
} from "@openbot/contracts";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { CapCounterService, DEFAULT_AUTONOMY_CAPS } from "@openbot/cos";
import { FakeDecisionService } from "@openbot/decisions";
import { wireConnectors } from "@openbot/connectors";
import { ConnectorMcpComposer, SessionTokenService } from "@openbot/mcp";
import { createRuntime, InMemoryEventSink, type Runtime } from "@openbot/runtime";
import { RepoChainStore, RepoMessageStore, RepoTurnStore } from "./bootstrap.js";
import { createTurnMailbox, RepoSessionStore } from "./turn-mailbox.js";

/** Records every turn it gets, replies "done", and reports a stable session id. */
class RecordingDriver implements EngineDriver {
  readonly inputs: TurnInput[] = [];
  /** Tools to ask permission for in each turn (like an engine's approval hook). */
  askFor: string[] = [];
  readonly decisions = new Map<string, "allow" | "deny" | "pending">();
  constructor(
    readonly id: "claude" | "codex",
    private readonly models: string[],
  ) {}
  async detect(): Promise<EngineStatus> {
    return { installed: true, login: { ok: true }, apiKey: { ok: false } };
  }
  async validateKey() {
    return { ok: true };
  }
  async listModels(): Promise<ModelInfo[]> {
    return this.models.map((id) => ({ id, label: id, contextWindow: 1000 }));
  }
  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    this.inputs.push(input);
    for (const toolName of this.askFor) {
      this.decisions.set(toolName, "pending");
      void hooks
        .requestApproval({ toolName, input: {}, toolUseId: toolName })
        .then((d) => this.decisions.set(toolName, d));
    }
    hooks.emit({ type: "text_delta", text: `done by ${this.id}` });
    const done: Promise<TurnResult> = Promise.resolve({
      sessionId: `${this.id}-session`,
      isError: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    return { steer: async () => {}, interrupt: async () => {}, done };
  }
  async dispose() {}
}

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

async function setup(drivers: { claude?: RecordingDriver; codex?: RecordingDriver }) {
  home = await mkdtemp(join(tmpdir(), "openbot-turn-mailbox-"));
  ctx = await createCoreContext({
    config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
    disableNdjson: true,
  });
  ctx.decisionService = new FakeDecisionService();
  const core = ctx;
  const connectors = wireConnectors(core);
  const runtime: Runtime = createRuntime({
    decisions: ctx.decisionService,
    drivers,
    clock: {
      now: () => core.clock.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    },
    events: new InMemoryEventSink(),
    chainStore: new RepoChainStore(core),
    messageStore: new RepoMessageStore(core),
    turnStore: new RepoTurnStore(core),
    sessionStore: new RepoSessionStore(core),
  });
  const tokens = new SessionTokenService(Buffer.alloc(32, 7));
  const mailbox = createTurnMailbox(core, {
    runtime,
    drivers,
    autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    caps: new CapCounterService(core.clock),
    mcp: () => ({ tokens, connectors: new ConnectorMcpComposer(core) }),
  });

  function addBot(overrides: Partial<Bot> = {}): { bot: Bot; threadId: string } {
    const bot: Bot = {
      id: newId("bot"),
      slug: `bot-${Math.random().toString(36).slice(2, 8)}`,
      name: "Helper",
      description: "helps with things",
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: "user",
      routing: { mode: "auto" },
      permissionPreset: "workspace_write",
      computer: "none",
      connectors: [],
      limits: {},
      ...overrides,
    };
    core.repos.bots.create(bot);
    const threadId = newId("thread");
    core.repos.threads.create({
      id: threadId,
      botId: bot.id,
      kind: "dm",
      createdAt: new Date().toISOString(),
    });
    return { bot, threadId };
  }

  async function settle() {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }

  return { core, runtime, mailbox, tokens, connectors, addBot, settle };
}

describe("createTurnMailbox (message.send → engine turn)", () => {
  it("stores the user message and the Bot's reply in the Bot's thread", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { core, mailbox, addBot, settle } = await setup({ claude });
    const { bot, threadId } = addBot();

    const result = await mailbox.enqueue({ botId: bot.id, text: "summarize my notes" });
    await settle();

    expect(result).toMatchObject({ ok: true, engine: "claude", model: "claude-sonnet" });
    const texts = core.repos.messages
      .list({ threadId })
      .map((m) => `${m.author.type}:${m.text}`)
      .sort();
    expect(texts).toEqual(["bot:done by claude", "user:summarize my notes"]);
  });

  it("injects the OpenBot MCP server with a token bound to this bot, turn and chain", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { core, mailbox, tokens, addBot, settle } = await setup({ claude });
    const { bot } = addBot({ isChiefOfStaff: true });

    const result = await mailbox.enqueue({ botId: bot.id, text: "hello" });
    await settle();

    const input = claude.inputs[0]!;
    const openbot = input.mcpServers.find((s) => s.name === "openbot");
    expect(openbot?.env?.OPENBOT_COS_TOOLS).toBe("1");
    const claims = tokens.verify(openbot?.env?.OPENBOT_SESSION_TOKEN ?? "");
    expect(claims).toMatchObject({ botId: bot.id, chainId: result.chainId, mode: "live" });
    expect(core.repos.turns.getById(claims!.turnId)?.botId).toBe(bot.id);
    expect(input.systemPrompt).toContain("Chief of Staff");
  });

  it("tells bots with a computer how to drive it, and only them", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { mailbox, addBot, settle } = await setup({ claude });
    const { bot: withComputer } = addBot({ computer: "docker" });
    const { bot: without } = addBot({ computer: "none" });

    await mailbox.enqueue({ botId: withComputer.id, text: "a" });
    await mailbox.enqueue({ botId: without.id, text: "b" });
    await settle();

    const [first, second] = claude.inputs;
    expect(first!.systemPrompt).toContain("USING YOUR COMPUTER");
    expect(first!.systemPrompt).toContain("computer_steer");
    expect(second!.systemPrompt).not.toContain("USING YOUR COMPUTER");
  });

  it("honors a pinned engine and an explicit override, and refuses unavailable engines", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const codex = new RecordingDriver("codex", ["gpt-codex"]);
    const { mailbox, addBot, settle } = await setup({ claude, codex });
    const { bot } = addBot({ routing: { mode: "pinned", engine: "codex" } });

    expect(await mailbox.enqueue({ botId: bot.id, text: "a" })).toMatchObject({
      ok: true,
      engine: "codex",
      model: "gpt-codex",
    });
    await settle();
    expect(await mailbox.enqueue({ botId: bot.id, text: "b", engine: "claude" })).toMatchObject({
      ok: true,
      engine: "claude",
    });
    // The message is kept and the reason shows up in the chat as a failed turn.
    expect(await mailbox.enqueue({ botId: bot.id, text: "c", engine: "fake" })).toMatchObject({
      ok: false,
      reason: 'engine "fake" is not available',
      messageId: expect.stringMatching(/^msg_/),
    });
  });

  it("resumes the Bot's engine session on the next turn, from the store", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { core, mailbox, addBot, settle } = await setup({ claude });
    const { bot } = addBot();

    await mailbox.enqueue({ botId: bot.id, text: "first" });
    await settle();
    await mailbox.enqueue({ botId: bot.id, text: "second" });
    await settle();

    expect(claude.inputs.map((i) => i.sessionId)).toEqual([undefined, "claude-session"]);
    expect(core.repos.engineSessions.getForBotAndEngine(bot.id, "claude")?.sessionId).toBe(
      "claude-session",
    );
  });

  it("uses a stored API key for the engine, and the CLI login otherwise", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { core, mailbox, addBot, settle } = await setup({ claude });
    const { bot } = addBot();

    await mailbox.enqueue({ botId: bot.id, text: "one" });
    await settle();
    await core.vault.set("anthropic.apiKey", "sk-ant-test");
    await mailbox.enqueue({ botId: bot.id, text: "two" });
    await settle();

    expect(claude.inputs[0]?.auth).toEqual({ mode: "login", env: {} });
    expect(claude.inputs[1]?.auth).toEqual({
      mode: "api_key",
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    });
  });

  it("refuses when no engine is available or the thread is not the Bot's", async () => {
    const { mailbox, addBot } = await setup({});
    const { bot } = addBot();
    expect(await mailbox.enqueue({ botId: bot.id, text: "x" })).toMatchObject({ ok: false });
    expect(
      await mailbox.enqueue({ botId: bot.id, threadId: "thr_other", text: "x" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("thread") });
  });
});

describe("connectors in turns", () => {
  it("injects only the Bot's assigned connections", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { mailbox, connectors, addBot, settle } = await setup({ claude });
    const fs = await connectors.connect({
      catalogId: "curated:filesystem",
      values: { FOLDER: "/tmp/shared" },
    });
    const { bot: withFs } = addBot({ connectors: [fs.id] });
    const { bot: without } = addBot();

    await mailbox.enqueue({ botId: withFs.id, text: "list files" });
    await settle();
    await mailbox.enqueue({ botId: without.id, text: "list files" });
    await settle();

    expect(claude.inputs.map((i) => i.mcpServers.map((s) => s.name))).toEqual([
      ["openbot", "filesystem"],
      ["openbot"],
    ]);
    expect(claude.inputs[0]!.mcpServers[1]!.args).toContain("/tmp/shared");
  });

  it("sends connector writes to an approval card and lets reads run", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    claude.askFor = ["mcp__filesystem__read_text_file", "mcp__filesystem__write_file"];
    const { runtime, mailbox, connectors, addBot, settle } = await setup({ claude });
    const fs = await connectors.connect({
      catalogId: "curated:filesystem",
      values: { FOLDER: "/tmp/shared" },
    });
    const { bot } = addBot({ connectors: [fs.id] });

    await mailbox.enqueue({ botId: bot.id, text: "tidy up" });
    await settle();

    expect(claude.decisions.get("mcp__filesystem__read_text_file")).toBe("allow");
    expect(claude.decisions.get("mcp__filesystem__write_file")).toBe("pending");
    const pending = runtime.approvals.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "connector_action", botId: bot.id });
  });
});

describe("RepoChainStore", () => {
  it("persists chain counters so chain limits can trip", async () => {
    const claude = new RecordingDriver("claude", ["claude-sonnet"]);
    const { core, runtime } = await setup({ claude });
    const chain = runtime.chains.create({ origin: "user", mode: "live" });

    runtime.chains.recordTurnStarted(chain.id);
    runtime.chains.recordTurnStarted(chain.id);
    runtime.chains.recordBotMessage(chain.id, 1);

    expect(core.repos.chains.getById(chain.id)).toMatchObject({ turns: 2, botMessages: 1 });
  });
});
