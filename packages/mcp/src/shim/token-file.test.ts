import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpComposer, removeTokenFileIfUnchanged } from "../composer.js";
import { SessionTokenService } from "../session-token.js";
import { makeBot } from "../test-helpers.js";
import { readSessionToken } from "./token.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("the per-turn session token file", () => {
  it("is rewritten every turn and is what the shim presents, so a long-lived MCP process stays valid", async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-sessions-"));
    const tokens = new SessionTokenService(Buffer.alloc(32, 7));
    const bot = makeBot({ name: "Web", slug: "web" });
    const turn = (turnId: string) =>
      McpComposer.forTurnAsync(tokens, {
        bot,
        turnId,
        chainId: "chn_1",
        mode: "live",
        harnessUrl: "http://127.0.0.1:4577",
        sessionDir: dir,
      });

    const first = await turn("turn_1");
    const spec = first.servers[0]!;
    const file = spec.env?.OPENBOT_SESSION_TOKEN_FILE;
    expect(file).toBe(join(dir, `${bot.id}.token`));
    expect(await readFile(file!, "utf8")).toBe(first.token);
    expect(readSessionToken(spec.env)).toBe(first.token);

    // The process started in turn 1 keeps its env; turn 2 only rewrites the file.
    const second = await turn("turn_2");
    expect(second.token).not.toBe(first.token);
    expect(readSessionToken(spec.env)).toBe(second.token);
  });

  it("writes no file when no directory is given (Claude starts a fresh process every turn)", async () => {
    const tokens = new SessionTokenService(Buffer.alloc(32, 7));
    const bot = makeBot({ name: "Web", slug: "web" });
    const { servers } = await McpComposer.forTurnAsync(tokens, {
      bot,
      turnId: "turn_1",
      chainId: "chn_1",
      mode: "live",
      harnessUrl: "http://127.0.0.1:4577",
    });
    expect(servers[0]?.env).not.toHaveProperty("OPENBOT_SESSION_TOKEN_FILE");
  });

  it("is removed when its turn ends, but not if the next turn already rewrote it", async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-sessions-"));
    const file = join(dir, "bot.token");
    await writeFile(file, "token-1");
    removeTokenFileIfUnchanged(file, "token-1");
    await expect(stat(file)).rejects.toThrow();

    await writeFile(file, "token-2"); // the next turn started before the last one was cleaned up
    removeTokenFileIfUnchanged(file, "token-1");
    expect(await readFile(file, "utf8")).toBe("token-2");
    removeTokenFileIfUnchanged(join(dir, "missing.token"), "x"); // never throws
  });
});
