import type { InputAnswer } from "@openbot/contracts";
import {
  Approval,
  Bot,
  InputRequest,
  Message,
  OBEvent,
  Routine,
  Thread,
  Turn,
} from "@openbot/contracts";
import { z } from "zod";
import {
  authProof,
  createPullStream,
  createPushStream,
  decodeText,
  encodeText,
  fromBase64,
  joinFrame,
  toBase64,
  unpackFrame,
} from "./native-crypto";
import type { DeviceCredentials } from "./storage";
import { bareFrame } from "@/lib/frames";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BotList = z.object({ bots: z.array(Bot) });
const ThreadList = z.object({
  threads: z.array(
    Thread.extend({
      participantIds: z.array(z.string()).optional(),
      title: z.string().optional(),
      lastMessagePreview: z.string().optional(),
      lastMessageAt: z.string().optional(),
    }),
  ),
});
const MessageList = z.object({ messages: z.array(Message) });
// The desktop serializes an unresolved approval's `resolution` as null; the shared
// contract only allows it to be absent.
const WireApproval = Approval.extend({
  resolution: z
    .enum(["allow", "deny", "expired"])
    .nullish()
    .transform((value) => value ?? undefined),
});
const ApprovalList = z.object({ approvals: z.array(WireApproval) });
const TurnList = z.object({ turns: z.array(Turn) });
const Health = z.object({ connected: z.boolean(), version: z.string() });
const ApprovalResponse = z.object({ approval: WireApproval });
const StopResponse = z.object({ stopped: z.boolean().optional(), ok: z.boolean().optional() });
const InputList = z.object({ inputs: z.array(InputRequest) });
const InputResponse = z.object({ input: InputRequest.optional() });
const RoutineList = z.object({ routines: z.array(Routine) });
const RoutineResponse = z.object({ routine: Routine.optional() });
const RunResponse = z.object({ run: z.object({ id: z.string() }).passthrough() });

export type MobileThread = z.infer<typeof ThreadList>["threads"][number];
export type InboundMessage =
  | { type: "event"; event: z.infer<typeof OBEvent> }
  | { type: "command.result"; command: string; ok: boolean; reason?: string }
  | { type: "error"; error: string };

class E2EChannel {
  private readonly request: ReturnType<typeof createPushStream>;
  private response: ReturnType<typeof createPullStream> | undefined;
  private requestStarted = false;
  private responseStarted = false;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly key: Uint8Array,
    readonly scopeId: string,
  ) {
    this.request = createPushStream(key);
  }

  encrypt(clear: string): string {
    const cipher = this.request.push(encodeText(clear));
    if (this.requestStarted) return toBase64(cipher);
    this.requestStarted = true;
    return joinFrame(this.request.header, cipher);
  }

  decrypt(encoded: string): string {
    let cipher: Uint8Array;
    if (!this.responseStarted) {
      const frame = unpackFrame(encoded);
      this.response = createPullStream(this.key, frame.header);
      cipher = frame.ciphertext;
      this.responseStarted = true;
    } else {
      cipher = fromBase64(encoded);
    }
    return decodeText(this.response!.pull(cipher));
  }

  runSerial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class MobileClient {
  readonly httpChannel: E2EChannel;
  readonly wsChannel: E2EChannel;
  private socket: WebSocket | undefined;
  private pendingCommand: { resolve(): void; reject(error: Error): void } | undefined;

  constructor(
    private readonly credentials: DeviceCredentials,
    private readonly key: Uint8Array,
    sessionId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.httpChannel = new E2EChannel(key, `${sessionId}h`);
    this.wsChannel = new E2EChannel(key, `${sessionId}w`);
  }

  get baseUrl(): string {
    return this.credentials.baseUrl;
  }

  async getBots() {
    return this.request("GET", "/api/bots", BotList);
  }

  async getThreads() {
    return this.request("GET", "/api/threads", ThreadList);
  }

  async getMessages(threadId: string) {
    return this.request(
      "GET",
      `/api/threads/${encodeURIComponent(threadId)}/messages`,
      MessageList,
    );
  }

  async getActivity() {
    return this.request("GET", "/api/activity", MessageList);
  }

  async getBotTurns(botId: string) {
    return this.request("GET", `/api/audit?botId=${encodeURIComponent(botId)}`, TurnList);
  }

  async getApprovals(status: "pending" | "resolved" | "expired" = "pending") {
    return this.request("GET", `/api/approvals?status=${status}`, ApprovalList);
  }

  async getHealth() {
    return this.request("GET", "/api/harness/status", Health);
  }

  async resolveApproval(id: string, resolution: "allow" | "deny") {
    return this.request(
      "POST",
      `/api/approvals/${encodeURIComponent(id)}/resolve`,
      ApprovalResponse,
      { resolution },
    );
  }

  async stopThread(threadId: string) {
    return this.request(
      "POST",
      `/api/threads/${encodeURIComponent(threadId)}/stop`,
      StopResponse,
      {},
    );
  }

  async getInputs(status: "pending" | "answered" | "dismissed" = "pending") {
    return this.request("GET", `/api/inputs?status=${status}`, InputList);
  }

  async answerInput(id: string, answers: Record<string, InputAnswer>) {
    return this.request("POST", `/api/inputs/${encodeURIComponent(id)}/answer`, InputResponse, {
      answers,
    });
  }

  async dismissInput(id: string) {
    return this.request("POST", `/api/inputs/${encodeURIComponent(id)}/dismiss`, InputResponse, {});
  }

  async getRoutines() {
    return this.request("GET", "/api/routines", RoutineList);
  }

  /** A dry run plans without side effects; live runs need the routine to be approved for live. */
  async runRoutine(id: string, dryRun: boolean) {
    return this.request("POST", `/api/routines/${encodeURIComponent(id)}/run`, RunResponse, {
      dryRun,
    });
  }

  async setRoutinePaused(id: string, paused: boolean) {
    return this.request(
      "POST",
      `/api/routines/${encodeURIComponent(id)}/${paused ? "pause" : "resume"}`,
      RoutineResponse,
      {},
    );
  }

  connectEvents(
    since: number,
    callbacks: {
      onEvent(event: z.infer<typeof OBEvent>): void;
      onOpen(): void;
      onClose(): void;
      onError(): void;
      onCommandResult?(result: { ok: boolean; reason?: string }): void;
    },
  ): WebSocket {
    const base = new URL(this.credentials.baseUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/api/ws`;
    const NativeWebSocket = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[] | null,
      options?: { headers?: Record<string, string> },
    ) => WebSocket;
    const ws = new NativeWebSocket(base.toString(), undefined, {
      headers: this.authHeaders(this.wsChannel.scopeId),
    });
    this.socket = ws;
    ws.onopen = () => {
      ws.send(this.wsChannel.encrypt(JSON.stringify({ type: "subscribe", since })));
      callbacks.onOpen();
    };
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(
          this.wsChannel.decrypt(bareFrame(String(event.data))),
        ) as unknown;
        const parsed = z
          .union([
            z.object({ type: z.literal("event"), event: OBEvent }),
            z.object({
              type: z.literal("command.result"),
              command: z.string(),
              ok: z.boolean(),
              reason: z.string().optional(),
            }),
            z.object({ type: z.literal("error"), error: z.string() }),
          ])
          .safeParse(payload);
        if (!parsed.success) return;
        if (parsed.data.type === "event") callbacks.onEvent(parsed.data.event);
        else if (parsed.data.type === "command.result") {
          callbacks.onCommandResult?.(parsed.data);
          const pending = this.pendingCommand;
          this.pendingCommand = undefined;
          if (pending) {
            if (parsed.data.ok) pending.resolve();
            else
              pending.reject(
                new Error(parsed.data.reason ?? "OpenBot could not send the message."),
              );
          }
        }
      } catch {
        callbacks.onError();
      }
    };
    ws.onclose = () => callbacks.onClose();
    ws.onerror = () => callbacks.onError();
    return ws;
  }

  /** Without a `threadId` the desktop opens (or reuses) the Bot's conversation. */
  sendMessage(botId: string, threadId: string | undefined, text: string): Promise<void> {
    if (this.pendingCommand) return Promise.reject(new Error("A message is already being sent."));
    return new Promise((resolve, reject) => {
      this.pendingCommand = { resolve, reject };
      try {
        this.sendCommand({
          command: "message.send",
          payload: threadId ? { botId, threadId, text } : { botId, text },
        });
      } catch (error) {
        this.pendingCommand = undefined;
        reject(error instanceof Error ? error : new Error("OpenBot is reconnecting."));
      }
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    this.pendingCommand?.reject(new Error("Connection closed before OpenBot replied."));
    this.pendingCommand = undefined;
  }

  private sendCommand(command: { command: string; payload: Record<string, unknown> }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("OpenBot is reconnecting.");
    this.socket.send(this.wsChannel.encrypt(JSON.stringify({ type: "command", ...command })));
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    return this.httpChannel.runSerial(async () => {
      const headers = this.authHeaders(this.httpChannel.scopeId);
      let serializedBody: string | undefined;
      if (body !== undefined) {
        headers["content-type"] = "application/x-openbot-e2e";
        serializedBody = this.httpChannel.encrypt(JSON.stringify(body));
      }
      const response = await this.fetcher(new URL(path, this.credentials.baseUrl), {
        method,
        headers,
        body: serializedBody,
      });
      const raw = await response.text();
      if (!response.ok) {
        let message = `OpenBot request failed (${response.status}).`;
        try {
          const problem = JSON.parse(raw) as { reason?: string; error?: string };
          message = problem.reason ?? problem.error ?? message;
        } catch {
          // The server may return an empty error response.
        }
        throw new ApiError(response.status, message);
      }
      try {
        return schema.parse(JSON.parse(this.httpChannel.decrypt(raw)));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, "OpenBot returned an invalid response.");
      }
    });
  }

  private authHeaders(scopeId: string): Record<string, string> {
    return {
      "x-openbot-device": this.credentials.deviceId,
      "x-openbot-device-token": authProof(this.key, this.credentials.token),
      "x-openbot-e2e-session": scopeId,
      accept: "application/json",
    };
  }
}
