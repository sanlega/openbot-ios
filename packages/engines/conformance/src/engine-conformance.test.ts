import { describe, expect, it } from "vitest";
import type { EngineEvent } from "@openbot/contracts";
import { runEngineDriverConformance } from "@openbot/testkit";
import {
  ClaudeDriver,
  createClaudeParseState,
  createFixtureClaudeDriver,
  handleClaudeLine,
} from "@openbot/engines-claude";
import {
  CodexDriver,
  CODEX_PINNED_SERVER_REQUEST_METHODS,
  createCodexParseState,
  createFixtureCodexDriver,
  handleCodexResponse,
  listServerRequestMethods,
  resetSharedCodexAppServerForTests,
} from "@openbot/engines-codex";
import { loadFixture, recvLines } from "@openbot/engines-common";

runEngineDriverConformance("claude (golden fixture)", () =>
  createFixtureClaudeDriver("claude/claude-p-stream-json-no-auth.jsonl"),
);
runEngineDriverConformance("codex (golden fixture)", () =>
  createFixtureCodexDriver("codex/initialize-and-thread-start.jsonl"),
);

describe("WS3 golden fixture replays", () => {
  it("parses Claude no-auth stream-json fixture", async () => {
    const lines = recvLines(await loadFixture("claude/claude-p-stream-json-no-auth.jsonl"));
    const state = createClaudeParseState();
    const events: EngineEvent[] = [];
    for (const line of lines) {
      handleClaudeLine(line, state, { emit: (e: EngineEvent) => events.push(e) });
    }
    expect(state.sessionId).toBe("780ff383-de94-48a4-967b-6ba5d0e1166d");
    expect(state.isError).toBe(true);
    expect(state.authFailure).toBe(true);
    expect(events.some((e) => e.type === "session_started")).toBe(true);
    expect(events.some((e) => e.type === "error" && e.authFailure)).toBe(true);
  });

  it("parses Claude long-lived two-turn fixture with stable session id", async () => {
    const lines = recvLines(await loadFixture("claude/claude-long-lived-process-two-turns.jsonl"));
    const sessionIds = new Set<string>();
    for (const line of lines) {
      if (
        line.type === "system" &&
        line.subtype === "init" &&
        typeof line.session_id === "string"
      ) {
        sessionIds.add(line.session_id);
      }
      if (line.type === "result" && typeof line.session_id === "string") {
        sessionIds.add(line.session_id);
      }
    }
    expect(sessionIds.size).toBe(1);
    expect(sessionIds.has("15309033-a941-48cb-be59-50195f30889b")).toBe(true);
  });

  it("parses Claude resume fixture in a fresh process", async () => {
    const lines = recvLines(await loadFixture("claude/claude-session-resume-new-process.jsonl"));
    const init = lines.find((l) => l.type === "system" && l.subtype === "init");
    expect(init?.session_id).toBe("15309033-a941-48cb-be59-50195f30889b");
  });

  it("parses Codex initialize + thread/start fixture", async () => {
    const lines = recvLines(await loadFixture("codex/initialize-and-thread-start.jsonl"));
    const state = createCodexParseState();
    const events: EngineEvent[] = [];
    for (const line of lines) {
      handleCodexResponse(line, state, { emit: (e: EngineEvent) => events.push(e) });
    }
    expect(state.threadId).toBe("01a0e021-62a8-74a3-9fb5-09e17cb9ea17");
    expect(events.some((e) => e.type === "session_started")).toBe(true);
  });

  it("detects Codex 401 auth failure notifications", async () => {
    const lines = recvLines(await loadFixture("codex/turn-start-no-auth-401-retries.jsonl"));
    const errors = lines.filter((l) => l.method === "error");
    expect(errors.length).toBeGreaterThan(0);
    for (const line of errors) {
      const params = line.params as {
        error?: { codexErrorInfo?: { responseStreamDisconnected?: { httpStatusCode?: number } } };
      };
      expect(params.error?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode).toBe(401);
    }
  });

  it("proves per-thread MCP isolation from fixture", async () => {
    const lines = recvLines(
      await loadFixture("codex/mcp-servers-per-thread-isolation-two-threads.jsonl"),
    );
    const mcpLists = lines.filter(
      (l) => l.id === 3 && (l.result as { data?: unknown[] } | undefined)?.data,
    );
    expect(mcpLists).toHaveLength(1);
    const first = (mcpLists[0]?.result as { data: Array<{ name: string }> }).data;
    expect(first.some((s) => s.name === "openbot_per_thread")).toBe(true);

    const threadStarts = lines.filter((l) => l.id === 2 || l.id === 4) as Array<{
      result?: { thread?: { id?: string } };
    }>;
    expect(threadStarts).toHaveLength(2);
    const ids = threadStarts.map((l) => l.result?.thread?.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("keeps generated Codex server-request method list aligned with fixture schema", async () => {
    const schemaMethods = await listServerRequestMethods("codex-schema/ServerRequest.json");
    for (const method of CODEX_PINNED_SERVER_REQUEST_METHODS.filter((m) => m.startsWith("item/"))) {
      expect(schemaMethods).toContain(method);
    }
  });
});

describe("WS3 driver detect()", () => {
  it("ClaudeDriver detect resolves", async () => {
    const driver = new ClaudeDriver();
    const status = await driver.detect();
    expect(typeof status.installed).toBe("boolean");
    await driver.dispose();
  });

  it("CodexDriver detect resolves", async () => {
    resetSharedCodexAppServerForTests();
    const driver = new CodexDriver();
    const status = await driver.detect();
    expect(typeof status.installed).toBe("boolean");
    await driver.dispose();
  });
});

describe("WS3 auth modes", () => {
  it("Claude validateKey accepts sk- prefix and rejects empty", async () => {
    const driver = createFixtureClaudeDriver("claude/claude-p-stream-json-no-auth.jsonl");
    await expect(driver.validateKey("")).resolves.toMatchObject({ ok: false });
    await expect(driver.validateKey("sk-ant-test")).resolves.toMatchObject({ ok: true });
    await driver.dispose();
  });

  it("Codex validateKey accepts sk- prefix and rejects empty", async () => {
    const driver = createFixtureCodexDriver("codex/initialize-and-thread-start.jsonl");
    await expect(driver.validateKey("")).resolves.toMatchObject({ ok: false });
    await expect(driver.validateKey("sk-test")).resolves.toMatchObject({ ok: true });
    await driver.dispose();
  });
});

const realEnabled = process.env.OPENBOT_E2E_REAL === "1";

describe.skipIf(!realEnabled)("WS3 real CLI conformance (OPENBOT_E2E_REAL=1)", () => {
  runEngineDriverConformance("claude (real CLI)", () => new ClaudeDriver());
  runEngineDriverConformance("codex (real CLI)", () => new CodexDriver());
});
