import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServer } from "./app-server.js";

let dir: string | undefined;
let server: CodexAppServer | undefined;

afterEach(async () => {
  await server?.dispose();
  if (dir) await rm(dir, { recursive: true, force: true });
  server = undefined;
  dir = undefined;
});

/** A stand-in `codex` binary that speaks the app-server JSON-RPC protocol over stdio. */
const FAKE_CODEX = `#!/usr/bin/env node
const rl = require("node:readline").createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\\n");
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") reply(msg.id, { userAgent: "fake" });
  if (msg.method === "model/list")
    reply(msg.id, { data: [{ id: "gpt-test", displayName: "GPT Test" }], nextCursor: null });
});
`;

// Windows can't execute a shebang script as a binary; the logic is the same there.
describe.skipIf(process.platform === "win32")("CodexAppServer against a real child process", () => {
  it("initializes and answers model/list (regression: start() used to deadlock)", async () => {
    dir = await mkdtemp(join(tmpdir(), "fake-codex-"));
    const bin = join(dir, "codex");
    await writeFile(bin, FAKE_CODEX);
    await chmod(bin, 0o755);
    server = new CodexAppServer({ codexPath: bin });

    const started = Date.now();
    const models = await server.listModels();
    expect(models).toEqual([{ id: "gpt-test", displayName: "GPT Test" }]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
