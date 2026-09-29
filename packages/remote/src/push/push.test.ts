import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApnsSender, type ApnsTransport } from "./apns.js";
import { approvalAction, pushContentFor, type PushLookups } from "./content.js";
import { PushService } from "./service.js";
import { APNS_KEY_VAULT_KEY, PushStore } from "./store.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const KEY_P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

const lookups: PushLookups = {
  botName: (id) => (id === "bot_writer" ? "Writer" : "OpenBot"),
  approval: () => ({
    summary: "Bash requested by bot_writer",
    detail: '{"command":"pnpm build","description":"Rebuild the project"}\n\nwhy',
    kind: "tool",
  }),
  input: () => ({ title: "Release note details" }),
  message: (id) =>
    id === "msg_reply"
      ? { author: { type: "bot" }, text: "**Done:** see `notes.md`", proactive: false }
      : id === "msg_proactive"
        ? { author: { type: "bot" }, text: "FYI", proactive: true }
        : { author: { type: "user" }, text: "hi" },
};

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function setup(
  respond: (origin: string, token: string) => { status: number; body?: string },
) {
  const home = await mkdtemp(join(tmpdir(), "openbot-push-"));
  homes.push(home);
  const secrets = new Map<string, string>();
  const calls: { origin: string; path: string; headers: Record<string, string>; body: string }[] =
    [];
  const transport: ApnsTransport = async (request) => {
    calls.push(request);
    const token = request.path.split("/").pop()!;
    const reply = respond(request.origin, token);
    return { status: reply.status, body: reply.body ?? "" };
  };
  const active = new Set(["dev_phone", "dev_old"]);
  const service = new PushService({
    store: new PushStore(home),
    vault: {
      get: async (key) => secrets.get(key),
      set: async (key, value) => void secrets.set(key, value),
    },
    lookups,
    isActiveDevice: (id) => active.has(id),
    clock: { now: () => new Date("2026-09-29T12:00:00.000Z") },
    transport,
  });
  return { home, secrets, calls, service, active };
}

describe("APNs sender", () => {
  it("signs an ES256 provider token Apple can verify with the key's public half", async () => {
    const sent: Parameters<ApnsTransport>[0][] = [];
    const sender = new ApnsSender(
      { keyP8: KEY_P8, keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "ai.openbot.mobile" },
      async (request) => {
        sent.push(request);
        return { status: 200, body: "" };
      },
      () => Date.parse("2026-09-29T12:00:00.000Z"),
    );
    const result = await sender.send(
      TOKEN_A,
      {
        title: "Writer",
        body: "Hi",
        threadId: "bot_writer",
        collapseId: "x",
        data: { botId: "bot_writer" },
      },
      "sandbox",
    );
    expect(result).toEqual({ ok: true, status: 200 });
    const request = sent[0]!;
    expect(request.origin).toBe("https://api.sandbox.push.apple.com");
    expect(request.path).toBe(`/3/device/${TOKEN_A}`);
    expect(request.headers["apns-topic"]).toBe("ai.openbot.mobile");
    expect(request.headers["apns-push-type"]).toBe("alert");
    expect(JSON.parse(request.body)).toMatchObject({
      aps: { alert: { title: "Writer", body: "Hi" }, "thread-id": "bot_writer" },
      body: { botId: "bot_writer" },
    });
    const jwt = request.headers.authorization!.replace("bearer ", "");
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      iss: "TEAM123456",
      iat: Date.parse("2026-09-29T12:00:00.000Z") / 1000,
    });
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature!, "base64url"),
    );
    expect(valid).toBe(true);
  });

  it("rejects text that is not a .p8 key", () => {
    expect(() => new ApnsSender({ keyP8: "nope", keyId: "A", teamId: "B", bundleId: "c" })).toThrow(
      ".p8",
    );
  });
});

describe("push content", () => {
  it("words approvals, questions, and replies for the lock screen", () => {
    const approval = pushContentFor(
      { type: "approval.requested", botId: "bot_writer", payload: { approvalId: "apr_1" } },
      lookups,
      { previews: true },
    );
    expect(approval).toMatchObject({
      title: "Writer needs your OK",
      body: "Rebuild the project",
      collapseId: "approval-apr_1",
      data: { botId: "bot_writer", kind: "approval" },
    });
    expect(
      pushContentFor(
        { type: "input.requested", botId: "bot_writer", payload: { requestId: "inp_1" } },
        lookups,
        { previews: true },
      ),
    ).toMatchObject({ title: "Writer has a question", body: "Release note details" });
    expect(
      pushContentFor(
        { type: "message.created", botId: "bot_writer", payload: { messageId: "msg_reply" } },
        lookups,
        { previews: true },
      ),
    ).toMatchObject({ title: "Writer", body: "Done: see notes.md", data: { kind: "reply" } });
  });

  it("skips the user's own messages, unpushed proactive ones, and other events", () => {
    const quiet = (type: string, messageId?: string, pushed?: boolean) =>
      pushContentFor({ type, botId: "bot_writer", payload: { messageId, pushed } }, lookups, {
        previews: true,
      });
    expect(quiet("message.created", "msg_user")).toBeUndefined();
    expect(quiet("message.created", "msg_proactive")).toBeUndefined();
    expect(quiet("message.created", "msg_proactive", true)).toMatchObject({
      data: { kind: "update" },
    });
    expect(quiet("turn.completed")).toBeUndefined();
  });

  it("hides text when previews are off", () => {
    expect(
      pushContentFor(
        { type: "message.created", botId: "bot_writer", payload: { messageId: "msg_reply" } },
        lookups,
        { previews: false },
      )?.body,
    ).toBe("New message");
  });

  it("describes approvals without raw ids", () => {
    expect(approvalAction({ summary: "Bash requested by bot_x", detail: '{"command":"ls"}' })).toBe(
      "Run a command",
    );
    expect(approvalAction({ summary: "Write requested by bot_x", detail: "not json" })).toBe(
      "Write",
    );
  });
});

describe("push service", () => {
  it("does nothing until the owner adds a key", async () => {
    const { service, calls } = await setup(() => ({ status: 200 }));
    await service.register("dev_phone", TOKEN_A);
    await service.handle({
      type: "approval.requested",
      botId: "bot_writer",
      payload: { approvalId: "apr_1" },
    });
    expect(calls).toHaveLength(0);
    await expect(service.sendTest()).rejects.toThrow("APNs key");
    expect((await service.status()).configured).toBe(false);
  });

  it("validates the configuration and keeps the key only in the vault", async () => {
    const { service, secrets, home } = await setup(() => ({ status: 200 }));
    await expect(service.configure({ keyId: "short", teamId: "TEAM123456" })).rejects.toThrow(
      "Key ID",
    );
    await expect(
      service.configure({ keyP8: "bad", keyId: "ABC123DEFG", teamId: "TEAM123456" }),
    ).rejects.toThrow(".p8");
    const status = await service.configure({
      keyP8: KEY_P8,
      keyId: "ABC123DEFG",
      teamId: "TEAM123456",
    });
    expect(status).toMatchObject({ configured: true, bundleId: "ai.openbot.mobile" });
    expect(secrets.get(APNS_KEY_VAULT_KEY)).toContain("BEGIN PRIVATE KEY");
    const file = await readFile(join(home, "push.json"), "utf8");
    expect(file).not.toContain("PRIVATE KEY");
    if (process.platform !== "win32") {
      expect((await stat(join(home, "push.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("learns sandbox tokens, drops unregistered and revoked phones", async () => {
    const { service, calls, active } = await setup((origin, token) => {
      if (token === TOKEN_A) {
        return origin.includes("sandbox")
          ? { status: 200 }
          : { status: 400, body: '{"reason":"BadDeviceToken"}' };
      }
      return { status: 410, body: '{"reason":"Unregistered"}' };
    });
    await service.configure({ keyP8: KEY_P8, keyId: "ABC123DEFG", teamId: "TEAM123456" });
    await service.register("dev_phone", TOKEN_A);
    await service.register("dev_old", TOKEN_B);
    await service.register("dev_gone", TOKEN_B);

    const first = await service.sendTest();
    expect(first).toEqual({ sent: 1, failed: 1, reasons: ["Unregistered"] });
    expect(service.isRegistered("dev_old")).toBe(false);
    expect(service.isRegistered("dev_gone")).toBe(false);

    calls.length = 0;
    await service.handle({
      type: "input.requested",
      botId: "bot_writer",
      payload: { requestId: "inp_1" },
    });
    // The phone's gateway is remembered: straight to sandbox this time.
    expect(calls.map((call) => call.origin)).toEqual(["https://api.sandbox.push.apple.com"]);

    active.delete("dev_phone");
    await service.sendTest();
    expect(service.isRegistered("dev_phone")).toBe(false);
  });

  it("rejects malformed device tokens", async () => {
    const { service } = await setup(() => ({ status: 200 }));
    await expect(service.register("dev_phone", "not-hex")).rejects.toThrow("invalid_token");
  });
});
