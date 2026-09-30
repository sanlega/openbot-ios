import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Bot, TurnInput } from "@openbot/contracts";
import {
  discoverLmStudio,
  discoverOllama,
  ensureOllamaContext,
  localServers,
  parseLocalModelId,
} from "./local-models.js";
import { openCodeProfile } from "./profiles/opencode.js";
import { cursorReplyFailure, customProfile } from "./profiles/others.js";
import { readEnginePrefs, writeEnginePrefs } from "./registry.js";
import { resolveSpawnTarget } from "./spawn.js";
import { toolInputOf, toolNameOf, track } from "./tool-calls.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openbot-acp-profiles-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

interface Call {
  url: string;
  body?: Record<string, unknown>;
}

/** A fake Ollama/LM Studio HTTP API. */
function fakeServer(routes: Record<string, (body?: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const doFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ url: u, body });
    const path = new URL(u).pathname;
    const route = routes[path];
    const result = route?.(body);
    if (result === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  return { doFetch, calls };
}

describe("local models", () => {
  it("lists Ollama chat models with tools and context, hiding embeddings and OpenBot's copies", async () => {
    const { doFetch } = fakeServer({
      "/api/tags": () => ({
        models: [
          { name: "qwen3:8b" },
          { name: "nomic-embed" },
          { name: "openbot-qwen3-8b:ctx32k" },
          { name: "tiny" },
        ],
      }),
      "/api/show": (b) =>
        b?.model === "qwen3:8b"
          ? { capabilities: ["completion", "tools"], model_info: { "qwen3.context_length": 40960 } }
          : b?.model === "nomic-embed"
            ? { capabilities: ["embedding"] }
            : { capabilities: ["completion"] },
    });
    const models = await discoverOllama("http://ollama", doFetch);
    expect(models.map((m) => [m.id, m.tools, m.contextWindow])).toEqual([
      ["ollama/qwen3:8b", true, 40960],
      ["ollama/tiny", false, undefined],
    ]);
    expect(models[1]!.label).toContain("no tools");
    expect(models.every((m) => m.local)).toBe(true);
  });

  it("lists LM Studio LLMs, not embedding models", async () => {
    const { doFetch } = fakeServer({
      "/api/v0/models": () => ({
        data: [
          { id: "qwen/qwen3.5-9b", type: "llm", max_context_length: 32768 },
          { id: "text-embedding-nomic", type: "embeddings" },
        ],
      }),
    });
    expect(await discoverLmStudio("http://lms", doFetch)).toEqual([
      expect.objectContaining({
        id: "lmstudio/qwen/qwen3.5-9b",
        contextWindow: 32768,
        local: true,
      }),
    ]);
  });

  it("an unreachable server lists nothing instead of failing", async () => {
    const doFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await discoverOllama("http://x", doFetch)).toEqual([]);
  });

  it("makes a bigger-context copy of an Ollama model once, capped at what the model supports", async () => {
    const created: string[] = [];
    const { doFetch } = fakeServer({
      "/api/show": (b) =>
        b?.model === "qwen3:8b"
          ? { model_info: { "qwen3.context_length": 16384 }, parameters: "" }
          : created.includes(String(b?.model))
            ? { model_info: {} }
            : undefined,
      "/api/create": (b) => {
        created.push(String(b?.model));
        expect(b).toMatchObject({ from: "qwen3:8b", parameters: { num_ctx: 16384 } });
        return { status: "success" };
      },
    });
    const name = await ensureOllamaContext("http://o", "qwen3:8b", 32768, doFetch);
    expect(name).toBe("openbot-qwen3-8b:ctx16k");
    expect(await ensureOllamaContext("http://o", "qwen3:8b", 32768, doFetch)).toBe(name);
    expect(created).toEqual([name]);
  });

  it("keeps a model whose own context is already big enough", async () => {
    const { doFetch, calls } = fakeServer({
      "/api/show": () => ({ model_info: {}, parameters: "num_ctx 65536" }),
    });
    expect(await ensureOllamaContext("http://o", "big", 32768, doFetch)).toBe("big");
    expect(calls.some((c) => c.url.endsWith("/api/create"))).toBe(false);
  });

  it("reads server addresses from the environment", () => {
    expect(localServers({ OLLAMA_HOST: "0.0.0.0:11500" }).ollama).toBe("http://127.0.0.1:11500");
    expect(localServers({}).lmstudio).toBe("http://127.0.0.1:1234");
    expect(parseLocalModelId("lmstudio/qwen/qwen3.5-9b")).toEqual({
      provider: "lmstudio",
      name: "qwen/qwen3.5-9b",
    });
    expect(parseLocalModelId("opencode/big-pickle")).toBeUndefined();
  });
});

interface OpenCodeConfig {
  model?: string;
  instructions: string[];
  permission: Record<string, string>;
  provider: Record<string, { options: { baseURL: string } } & Record<string, unknown>>;
}

const bot = { id: "bot_1", name: "B" } as Bot;
const turnInput = (model: string): TurnInput => ({
  bot,
  text: "hi",
  attachments: [],
  systemPrompt: "You are OpenBot's bot.",
  cwd: dir,
  addDirs: [],
  auth: { mode: "login", env: {} },
  mcpServers: [],
  permission: "full",
  allowTools: [],
  denyTools: [],
  model,
  limits: { maxSteps: 10 },
});

describe("OpenCode profile", () => {
  function profile(ownerAuth?: string) {
    const ownerDataDir = join(dir, "owner");
    if (ownerAuth) {
      mkdirSync(ownerDataDir, { recursive: true });
      writeFileSync(join(ownerDataDir, "auth.json"), ownerAuth);
    }
    const loaded: string[] = [];
    const { doFetch } = fakeServer({
      "/api/show": (b) =>
        b?.model === "qwen3:8b" ? { model_info: {}, parameters: "" } : undefined,
      "/api/create": () => ({ status: "success" }),
    });
    return {
      loaded,
      profile: openCodeProfile({
        servers: { ollama: "http://o", lmstudio: "http://l", contextLength: 32768 },
        fetch: doFetch,
        ownerDataDir,
        loadLmStudioModel: async (name) => {
          loaded.push(name);
        },
      }),
    };
  }

  it("launches in isolation: private dirs, owner's loaders off, only the owner's sign-ins passed", async () => {
    const { profile: p } = profile('{"deepseek":{"type":"api","key":"x"}}');
    const launch = await p.launch(turnInput("default"), { stateDir: join(dir, "state") });
    expect(launch.args).toEqual(["acp"]);
    expect(launch.env.XDG_CONFIG_HOME).toBe(join(dir, "state", "config"));
    expect(launch.env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(launch.env.OPENCODE_PURE).toBe("1");
    expect(launch.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(launch.env.OPENCODE_AUTH_CONTENT).toContain("deepseek");
    const config = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!) as OpenCodeConfig;
    expect(config.model).toBeUndefined();
    expect(config.permission).toMatchObject({
      bash: "ask",
      edit: "ask",
      external_directory: "ask",
    });
    // The system prompt is an instructions file, not part of the message.
    expect(launch.systemPrompt).toBe("launch");
    expect(readFileSync(config.instructions[0]!, "utf8")).toBe("You are OpenBot's bot.");
  });

  it("points a local Ollama model at the bigger-context copy", async () => {
    const { profile: p } = profile();
    const launch = await p.launch(turnInput("ollama/qwen3:8b"), { stateDir: join(dir, "state") });
    const config = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!) as OpenCodeConfig;
    expect(config.model).toBe("ollama/openbot-qwen3-8b:ctx32k");
    expect(launch.model).toBe("ollama/openbot-qwen3-8b:ctx32k");
    expect(config.provider.ollama).toMatchObject({
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://o/v1" },
      models: { "openbot-qwen3-8b:ctx32k": { tools: true } },
    });
    expect(launch.env.OPENCODE_AUTH_CONTENT).toBeUndefined();
  });

  it("loads an LM Studio model with enough context before the turn", async () => {
    const { profile: p, loaded } = profile();
    const launch = await p.launch(turnInput("lmstudio/qwen/qwen3.5-9b"), {
      stateDir: join(dir, "state"),
    });
    const config = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!) as OpenCodeConfig;
    expect(loaded).toEqual(["qwen/qwen3.5-9b"]);
    expect(config.model).toBe("lmstudio/qwen/qwen3.5-9b");
    expect(config.provider.lmstudio!.options.baseURL).toBe("http://l/v1");
  });

  it("passes a cloud model through untouched", async () => {
    const { profile: p } = profile();
    const launch = await p.launch(turnInput("opencode/big-pickle"), { stateDir: join(dir, "s") });
    const config = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!) as OpenCodeConfig;
    expect(config.model).toBe("opencode/big-pickle");
    expect(config.provider).toEqual({});
  });
});

describe("Cursor transport failures", () => {
  it("flags a reply that is only Cursor's connection error", () => {
    expect(cursorReplyFailure("Error: ConnectError: [unavailable] upstream down")).toMatch(
      /lost its connection/,
    );
    expect(
      cursorReplyFailure("Error: RetriableError: stream reset\n    at foo (x.js:1)"),
    ).toBeTruthy();
  });
  it("leaves real answers that merely quote it alone", () => {
    expect(
      cursorReplyFailure("You saw `Error: ConnectError: [unavailable]` because the VPN was off."),
    ).toBeUndefined();
    expect(cursorReplyFailure("Error: RetriableError: [internal] x")).toBeUndefined();
  });
});

describe("custom ACP engines and prefs", () => {
  it("round-trips engines.json and drops invalid entries", async () => {
    await writeEnginePrefs(dir, {
      custom: [{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] }],
    });
    expect(readEnginePrefs(dir).custom).toHaveLength(1);
    writeFileSync(
      join(dir, "engines.json"),
      JSON.stringify({
        custom: [{ slug: "Bad Slug", label: "x", command: "y", args: [] }, { slug: "ok" }],
      }),
    );
    expect(readEnginePrefs(dir).custom).toEqual([]);
    expect(readEnginePrefs(join(dir, "missing")).custom).toEqual([]);
  });

  it("a custom engine runs its own command line", async () => {
    const p = customProfile({ slug: "goose", label: "Goose", command: "goose", args: ["acp"] });
    expect(p.id).toBe("acp-goose");
    expect((await p.launch(turnInput("default"), { stateDir: dir })).args).toEqual(["acp"]);
  });
});

describe("Windows npm shims", () => {
  it.runIf(process.platform === "win32")("runs the .exe an npm .cmd shim points to", () => {
    const shim = join(dir, "tool.cmd");
    writeFileSync(
      shim,
      '@ECHO off\r\nGOTO start\r\n:start\r\n"%dp0%\\node_modules\\tool\\bin\\tool.exe"   %*\r\n',
    );
    expect(resolveSpawnTarget(shim)).toEqual({
      command: join(dir, "node_modules", "tool", "bin", "tool.exe"),
      prefixArgs: [],
      shell: false,
    });
  });

  it.runIf(process.platform === "win32")("runs a .js shim target with Node", () => {
    const shim = join(dir, "tool.cmd");
    writeFileSync(shim, '"%~dp0\\node_modules\\tool\\cli.js" %*\r\n');
    expect(resolveSpawnTarget(shim)).toEqual({
      command: process.execPath,
      prefixArgs: [join(dir, "node_modules", "tool", "cli.js")],
      shell: false,
    });
  });

  it.runIf(process.platform === "win32")(
    "skips the node.exe a local npm shim names before the script",
    () => {
      const shim = join(dir, "gemini.cmd");
      writeFileSync(
        shim,
        'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n' +
          '"%_prog%"  "%dp0%\\..\\@google\\gemini-cli\\bundle\\gemini.js" %*\r\n',
      );
      expect(resolveSpawnTarget(shim)).toEqual({
        command: process.execPath,
        prefixArgs: [join(dir, "..", "@google", "gemini-cli", "bundle", "gemini.js")],
        shell: false,
      });
    },
  );

  it("leaves other commands alone", () => {
    expect(resolveSpawnTarget("/usr/bin/opencode")).toEqual({
      command: "/usr/bin/opencode",
      prefixArgs: [],
      shell: false,
    });
  });
});

describe("tool names", () => {
  it("maps Cursor's single MCP tool onto mcp__<server>__<tool> with the tool's own arguments", () => {
    const calls = new Map();
    const call = track(calls, {
      toolCallId: "c1",
      title: "MCP: tool",
      kind: "other",
      rawInput: { providerIdentifier: "openbot", toolName: "message_user", args: { text: "hi" } },
    });
    expect(toolNameOf(call, ["openbot"])).toBe("mcp__openbot__message_user");
    expect(toolInputOf(call)).toEqual({ text: "hi" });
  });

  it("maps OpenCode's server_tool names and ACP kinds", () => {
    const calls = new Map();
    const mcp = track(calls, { toolCallId: "a", title: "openbot_list_bots", kind: "other" });
    expect(toolNameOf(mcp, ["openbot"])).toBe("mcp__openbot__list_bots");
    const edit = track(calls, {
      toolCallId: "b",
      title: "write",
      kind: "edit",
      rawInput: { filePath: "/w/a.txt", content: "x" },
    });
    expect(toolNameOf(edit, ["openbot"])).toBe("Write");
    expect(toolInputOf(edit)).toMatchObject({ file_path: "/w/a.txt" });
  });
});

describe("local discovery speed", () => {
  it("does not retry a server that never answers (something else on LM Studio's port)", async () => {
    const urls: string[] = [];
    const hang = (async (url: string | URL) => {
      urls.push(String(url));
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    expect(await discoverLmStudio("http://127.0.0.1:1234", hang)).toEqual([]);
    expect(urls).toEqual(["http://127.0.0.1:1234/api/v0/models"]);
  });

  it("falls back to /v1/models on an older LM Studio that answers 404 to /api/v0", async () => {
    const { doFetch } = fakeServer({ "/v1/models": () => ({ data: [{ id: "old-model" }] }) });
    expect((await discoverLmStudio("http://l", doFetch)).map((m) => m.id)).toEqual([
      "lmstudio/old-model",
    ]);
  });
});
