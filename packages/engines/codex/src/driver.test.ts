import type { TurnHooks, TurnInput } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import type { CodexAppServer } from "./app-server.js";
import { CodexDriver } from "./driver.js";
import { signatureOf, ThreadIndex } from "./thread-index.js";

/** An app-server that only knows the threads it started or resumed itself, like a fresh process. */
function fakeAppServer(options: { knows?: string[]; canResume?: boolean } = {}) {
  const known = new Set(options.knows ?? []);
  const calls: string[] = [];
  const texts: string[] = [];
  const server = {
    threadStart: async () => {
      calls.push("start");
      known.add("fresh-thread");
      return "fresh-thread";
    },
    threadResume: async (id: string) => {
      calls.push(`resume:${id}`);
      if (options.canResume === false || !known.has(id)) {
        throw new Error(`thread not found: ${id}`);
      }
      return id;
    },
    turnStart: async (id: string, text: string) => {
      calls.push(`turn:${id}`);
      texts.push(text);
      if (!known.has(id)) throw new Error(`thread not found: ${id}`);
      return "turn-1";
    },
    listMcpServerStatus: async () => ({ data: [] }),
    watchTurn: (state: { turnComplete?: boolean; text?: string }) => {
      // The turn finishes as soon as it starts.
      queueMicrotask(() => {
        state.text = "ok";
        state.turnComplete = true;
      });
      return () => undefined;
    },
    turnInterrupt: async () => undefined,
    turnSteer: async () => undefined,
  };
  return { server: server as unknown as CodexAppServer, calls, known, texts };
}

function input(sessionId?: string): TurnInput {
  return { bot: { id: "bot_1" }, text: "hi", sessionId } as unknown as TurnInput;
}

/** A driver that already knows these threads, as if a previous OpenBot run had created them. */
function driverKnowing(server: CodexAppServer, threadIds: string[], prompt = "") {
  const index = new ThreadIndex();
  for (const id of threadIds) index.set(id, { signature: signatureOf(input()), prompt });
  return new CodexDriver({ appServer: server, threadIndex: index });
}

async function run(driver: CodexDriver, turn: TurnInput) {
  const sessions: string[] = [];
  const hooks = {
    emit: (event: { type: string; sessionId?: string }) => {
      if (event.type === "session_started" && event.sessionId) sessions.push(event.sessionId);
    },
  } as unknown as TurnHooks;
  const result = await driver.startTurn(turn, hooks).done;
  return { result, sessions };
}

describe("CodexDriver threads", () => {
  it("resumes a stored session before using it, since the app-server may have restarted", async () => {
    const { server, calls } = fakeAppServer({ knows: ["old-thread"] });
    const { sessions } = await run(driverKnowing(server, ["old-thread"]), input("old-thread"));
    expect(calls.slice(0, 2)).toEqual(["resume:old-thread", "turn:old-thread"]);
    expect(sessions).toEqual(["old-thread"]);
  });

  it("starts a fresh thread when Codex no longer has the stored one", async () => {
    const { server, calls } = fakeAppServer({ knows: [] });
    const { result, sessions } = await run(
      driverKnowing(server, ["gone-thread"]),
      input("gone-thread"),
    );
    expect(calls).toEqual(["resume:gone-thread", "start", "turn:fresh-thread"]);
    expect(sessions).toEqual(["fresh-thread"]);
    expect(result.isError).toBeFalsy();
  });

  it("recovers when the thread vanishes between resume and the turn", async () => {
    const { server, calls, known } = fakeAppServer({ knows: ["flaky"] });
    const original = server.threadResume.bind(server);
    // Resume succeeds, then the app-server restarts and forgets the thread.
    server.threadResume = async (id: string) => {
      const resumed = await original(id);
      known.delete(id);
      return resumed;
    };
    const { sessions } = await run(driverKnowing(server, ["flaky"]), input("flaky"));
    expect(calls).toContain("start");
    expect(sessions).toEqual(["flaky", "fresh-thread"]);
  });

  describe("instructions", () => {
    const withPrompt = (systemPrompt: string, sessionId?: string) =>
      ({ ...input(sessionId), systemPrompt }) as TurnInput;

    it("sends the message as it is while the thread already follows the Bot's instructions", async () => {
      const { server, texts } = fakeAppServer();
      const driver = new CodexDriver({ appServer: server });
      await run(driver, withPrompt("Rules v1"));
      await run(driver, withPrompt("Rules v1"));
      expect(texts).toEqual(["hi", "hi"]);
    });

    it("puts changed instructions in front of the message, saying they replace the old ones", async () => {
      const { server, texts } = fakeAppServer();
      const driver = new CodexDriver({ appServer: server });
      await run(driver, withPrompt("Team: A"));
      await run(driver, withPrompt("Team: A, B"));
      expect(texts[0]).toBe("hi");
      expect(texts[1]).toContain("updated your instructions");
      expect(texts[1]).toContain("Team: A, B");
      expect(texts[1]?.endsWith("hi")).toBe(true);
      // ...once: the thread now follows them.
      await run(driver, withPrompt("Team: A, B"));
      expect(texts[2]).toBe("hi");
    });

    it("sends changed instructions again if the turn failed to start, instead of losing them", async () => {
      const { server, texts } = fakeAppServer();
      const driver = new CodexDriver({ appServer: server });
      await run(driver, withPrompt("Team: A"));
      const start = server.turnStart.bind(server);
      let fail = true;
      server.turnStart = async (id: string, text: string) => {
        if (fail) {
          fail = false;
          throw new Error("rpc hiccup");
        }
        return start(id, text);
      };
      await run(driver, withPrompt("Team: A, B")).catch(() => undefined);
      await run(driver, withPrompt("Team: A, B"));
      expect(texts.at(-1)).toContain("Team: A, B");
    });

    it("re-sends the instructions on the first turn after a restart (the stored thread is stale)", async () => {
      const { server, texts } = fakeAppServer({ knows: ["old-thread"] });
      const driver = driverKnowing(server, ["old-thread"], "Rules v1");
      await run(driver, withPrompt("Rules v2", "old-thread"));
      expect(texts[0]).toContain("Rules v2");
    });
  });

  describe("what a thread was created with", () => {
    const withMcp = (names: string[], sessionId?: string) =>
      ({
        ...input(sessionId),
        permission: "workspace_write",
        mcpServers: names.map((name) => ({ name, command: "node", args: [`${name}.js`] })),
      }) as unknown as TurnInput;

    it("never reuses a stored thread from before OpenBot passed instructions and tools", async () => {
      // No record in the index: the thread was made by an older OpenBot, with neither.
      const { server, calls } = fakeAppServer({ knows: ["legacy-thread"] });
      const { sessions } = await run(
        new CodexDriver({ appServer: server }),
        withMcp(["openbot"], "legacy-thread"),
      );
      expect(calls).toEqual(["start", "turn:fresh-thread"]);
      expect(sessions).toEqual(["fresh-thread"]);
    });

    it("starts a new thread when the Bot's tools changed, since Codex only reads them at creation", async () => {
      const { server, calls } = fakeAppServer();
      const driver = new CodexDriver({ appServer: server });
      await run(driver, withMcp(["openbot"]));
      await run(driver, withMcp(["openbot", "github"]));
      expect(calls.filter((c) => c === "start")).toHaveLength(2);
    });

    it("keeps the thread when only the per-turn token in the tool's env changes", async () => {
      const { server, calls } = fakeAppServer();
      const driver = new CodexDriver({ appServer: server });
      const turnWithToken = (token: string) =>
        ({
          ...withMcp(["openbot"]),
          mcpServers: [
            {
              name: "openbot",
              command: "node",
              args: ["openbot.js"],
              env: { OPENBOT_SESSION_TOKEN: token },
            },
          ],
        }) as unknown as TurnInput;
      await run(driver, turnWithToken("turn-1"));
      await run(driver, turnWithToken("turn-2"));
      expect(calls.filter((c) => c === "start")).toHaveLength(1);
    });

    it("starts a new thread when the Bot's permission moves it between the read-only and full sandboxes", async () => {
      const { server, calls } = fakeAppServer();
      const driver = new CodexDriver({ appServer: server });
      await run(driver, { ...withMcp(["openbot"]), permission: "workspace_write" } as TurnInput);
      await run(driver, { ...withMcp(["openbot"]), permission: "read_only" } as TurnInput);
      expect(calls.filter((c) => c === "start")).toHaveLength(2);
    });
  });
});
