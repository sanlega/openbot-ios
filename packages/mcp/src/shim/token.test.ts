import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionToken } from "./token.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("readSessionToken", () => {
  it("re-reads the token file, so a process that outlives its turn presents the new token", async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-token-"));
    const file = join(dir, "bot.token");
    const env = { OPENBOT_SESSION_TOKEN: "turn-1", OPENBOT_SESSION_TOKEN_FILE: file };
    await writeFile(file, "turn-1\n");
    expect(readSessionToken(env)).toBe("turn-1");
    await writeFile(file, "turn-2\n");
    expect(readSessionToken(env)).toBe("turn-2");
  });

  it("falls back to the env token when there is no file, or it is missing or empty", async () => {
    expect(readSessionToken({ OPENBOT_SESSION_TOKEN: "env-token" })).toBe("env-token");
    expect(
      readSessionToken({
        OPENBOT_SESSION_TOKEN: "env-token",
        OPENBOT_SESSION_TOKEN_FILE: "/nonexistent/x.token",
      }),
    ).toBe("env-token");
    expect(readSessionToken({})).toBeUndefined();
  });
});
