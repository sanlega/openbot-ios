import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { monotonicFactory } from "ulid";
import type { Approval, Message, OBEvent } from "@openbot/contracts";
import type { SetupValidateRequest } from "../api/types.js";
import {
  SEED_ACTIVITY,
  SEED_APPROVALS,
  SEED_AUDIT,
  SEED_BOTS,
  SEED_MESSAGES,
  SEED_ROUTES,
  SEED_ROUTINES,
  SEED_SETTINGS,
  SEED_SETUP,
  SEED_THREADS,
  buildSeedEvents,
  threadView,
} from "./seed-data.js";

const ulid = monotonicFactory();

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(body));
}

/**
 * In-process Client API mock (plan §4.7) for UI development and tests.
 * Mirrors WS1 replay semantics: `{subscribe, since}` is exclusive.
 */
export class MockClientApiServer {
  private httpServer: Server | undefined;
  private wss: WebSocketServer | undefined;
  private events: OBEvent[] = buildSeedEvents();
  private messages = [...SEED_MESSAGES];
  private approvals = [...SEED_APPROVALS];
  private nextSeq = this.events.at(-1)?.seq ?? 0;
  private clients = new Set<WebSocket>();

  async listen(port = 0): Promise<{ url: string; port: number }> {
    this.httpServer = createServer((req, res) => void this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer, path: "/api/ws" });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      ws.on("message", (raw) => {
        const frame = JSON.parse(String(raw)) as Record<string, unknown>;
        if (frame.subscribe === true) {
          const since = Number(frame.since ?? 0);
          for (const event of this.events.filter((e) => e.seq > since)) {
            ws.send(JSON.stringify({ type: "event", event }));
          }
          ws.send(JSON.stringify({ type: "replay.done" }));
        } else if (frame.type === "message.send") {
          void this.handleMessageSend(ws, frame as { threadId: string; text: string });
        } else if (frame.type === "approval.resolve") {
          void this.handleApprovalResolve(
            frame as { approvalId: string; resolution: "allow" | "deny" },
          );
        }
      });
    });

    await new Promise<void>((resolve) => this.httpServer?.listen(port, "127.0.0.1", resolve));
    const address = this.httpServer!.address() as AddressInfo;
    return { url: `http://127.0.0.1:${address.port}`, port: address.port };
  }

  async close(): Promise<void> {
    for (const ws of this.clients) ws.close();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
  }

  private appendEvent(partial: Omit<OBEvent, "id" | "seq">): OBEvent {
    const event: OBEvent = {
      id: `evt_${ulid()}`,
      seq: ++this.nextSeq,
      ...partial,
    };
    this.events.push(event);
    for (const ws of this.clients) {
      ws.send(JSON.stringify({ type: "event", event }));
    }
    return event;
  }

  private async handleMessageSend(
    _ws: WebSocket,
    frame: { threadId: string; text: string },
  ): Promise<void> {
    const thread = SEED_THREADS.find((t) => t.id === frame.threadId);
    if (!thread) return;

    const userMsg: Message = {
      id: `msg_${ulid()}`,
      threadId: frame.threadId,
      author: { type: "user", id: "user" },
      text: frame.text,
      attachments: [],
      chainId: "chn_live",
      hop: 0,
      createdAt: new Date().toISOString(),
      proactive: false,
      delivery: "delivered",
      pushed: false,
    };
    this.messages.push(userMsg);
    this.appendEvent({
      ts: userMsg.createdAt,
      type: "message.created",
      botId: thread.botId,
      threadId: frame.threadId,
      payload: { messageId: userMsg.id, text: userMsg.text },
    });
  }

  private handleApprovalResolve(frame: {
    approvalId: string;
    resolution: "allow" | "deny";
  }): void {
    const approval = this.approvals.find((a) => a.id === frame.approvalId);
    if (!approval || approval.status !== "pending") return;
    approval.status = "resolved";
    approval.resolution = frame.resolution;
    this.appendEvent({
      ts: new Date().toISOString(),
      type: "approval.resolved",
      botId: approval.botId,
      chainId: approval.chainId,
      payload: { approvalId: approval.id, resolution: frame.resolution },
    });
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/health") {
      return sendJson(res, 200, { status: "ok" });
    }
    if (method === "GET" && path === "/api/bots") {
      return sendJson(res, 200, { bots: SEED_BOTS });
    }
    if (method === "GET" && path === "/api/threads") {
      const threads = SEED_THREADS.map((t) => {
        const view = threadView(t, SEED_BOTS);
        const last = [...this.messages].reverse().find((m) => m.threadId === t.id);
        view.lastMessagePreview = last?.text.slice(0, 80);
        return view;
      });
      return sendJson(res, 200, { threads });
    }
    if (method === "GET" && path.startsWith("/api/threads/") && path.endsWith("/messages")) {
      const threadId = path.split("/")[3]!;
      const delivery = url.searchParams.get("delivery");
      let messages = this.messages.filter((m) => m.threadId === threadId);
      if (delivery) messages = messages.filter((m) => m.delivery === delivery);
      return sendJson(res, 200, { messages });
    }
    if (method === "GET" && path === "/api/approvals") {
      return sendJson(res, 200, { approvals: this.approvals.filter((a) => a.status === "pending") });
    }
    if (method === "GET" && path === "/api/activity") {
      let entries = [...SEED_ACTIVITY];
      const delivery = url.searchParams.get("delivery");
      if (delivery === "held") entries = entries.filter((e) => e.delivery === "held");
      const botId = url.searchParams.get("botId");
      if (botId) entries = entries.filter((e) => e.botId === botId);
      return sendJson(res, 200, { events: entries });
    }
    if (method === "GET" && path === "/api/audit") {
      return sendJson(res, 200, { entries: SEED_AUDIT });
    }
    if (method === "GET" && path === "/api/setup") {
      return sendJson(res, 200, { setup: SEED_SETUP });
    }
    if (method === "POST" && path === "/api/setup/validate") {
      const body = await readJson<SetupValidateRequest>(req);
      const ok = Boolean(body.value && body.value.length >= 8);
      return sendJson(res, 200, { ok, reason: ok ? undefined : "Invalid or missing value" });
    }
    if (method === "GET" && path === "/api/settings") {
      return sendJson(res, 200, { settings: SEED_SETTINGS });
    }
    if (method === "GET" && path.match(/^\/api\/bots\/[^/]+\/route$/)) {
      const botId = path.split("/")[3]!;
      const route = SEED_ROUTES[botId] ?? { engine: "fake", model: "fake-1", confidence: 0.5 };
      return sendJson(res, 200, route);
    }
    if (method === "GET" && path.match(/^\/api\/bots\/[^/]+\/why$/)) {
      const botId = path.split("/")[3]!;
      const bot = SEED_BOTS.find((b) => b.id === botId);
      return sendJson(res, 200, { justification: bot?.justification ?? null });
    }
    if (method === "GET" && path === "/api/routines") {
      return sendJson(res, 200, { routines: SEED_ROUTINES });
    }
    if (method === "POST" && path.match(/^\/api\/messages\/[^/]+\/promote$/)) {
      const messageId = path.split("/")[3]!;
      this.appendEvent({
        ts: new Date().toISOString(),
        type: "notify.requested",
        payload: { messageId, action: "promote" },
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "POST" && path.match(/^\/api\/messages\/[^/]+\/mute$/)) {
      const messageId = path.split("/")[3]!;
      this.appendEvent({
        ts: new Date().toISOString(),
        type: "notify.requested",
        payload: { messageId, action: "mute" },
      });
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { error: "not_found", path });
  }

  /** Test helper — inject an approval for UI tests. */
  injectApproval(approval: Approval): void {
    this.approvals.push(approval);
    this.appendEvent({
      ts: approval.createdAt,
      type: "approval.requested",
      botId: approval.botId,
      chainId: approval.chainId,
      payload: { approvalId: approval.id, kind: approval.kind, summary: approval.summary },
    });
  }
}
