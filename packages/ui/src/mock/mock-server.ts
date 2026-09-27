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
  SEED_COMPUTER_TASKS,
  SEED_DEVICES,
  SEED_DIGEST,
  SEED_ENGINES,
  SEED_MESSAGES,
  SEED_REMOTE,
  SEED_ROUTINE_RUNS,
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
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
  private settings = structuredClone(SEED_SETTINGS);
  private routines = structuredClone(SEED_ROUTINES);
  private routineRuns = structuredClone(SEED_ROUTINE_RUNS);
  private takeoverByBot = new Map<string, boolean>();
  private remote: {
    enabled: boolean;
    via?: "lan" | "tailscale" | "cloudflare";
    urls?: string[];
  } = structuredClone(SEED_REMOTE);
  private nextSeq = this.events.at(-1)?.seq ?? 0;
  private clients = new Set<WebSocket>();

  async listen(port = 0): Promise<{ url: string; port: number }> {
    this.httpServer = createServer((req, res) => void this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer, path: "/api/ws" });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      ws.on("message", (raw) => {
        // Same frames as the harness (packages/core/src/ws.ts).
        const frame = JSON.parse(String(raw)) as {
          type?: string;
          since?: number;
          command?: string;
          payload?: Record<string, unknown>;
        };
        if (frame.type === "subscribe") {
          const since = Number(frame.since ?? -1);
          for (const event of this.events.filter((e) => e.seq > since)) {
            ws.send(JSON.stringify({ type: "event", event }));
          }
          return;
        }
        if (frame.type !== "command") {
          ws.send(JSON.stringify({ type: "error", error: "unknown_message_type" }));
          return;
        }
        const payload = frame.payload ?? {};
        if (frame.command === "message.send") {
          void this.handleMessageSend(ws, {
            threadId: String(
              payload.threadId ?? SEED_THREADS.find((t) => t.botId === payload.botId)?.id ?? "",
            ),
            text: String(payload.text ?? ""),
          });
        } else if (frame.command === "approval.resolve") {
          this.handleApprovalResolve({
            approvalId: String(payload.id ?? ""),
            resolution: payload.resolution === "allow" ? "allow" : "deny",
          });
        }
        ws.send(JSON.stringify({ type: "command.result", command: frame.command, ok: true }));
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
      payload: { messageId: userMsg.id, text: userMsg.text, author: "user" },
    });
  }

  private handleApprovalResolve(frame: { approvalId: string; resolution: "allow" | "deny" }): void {
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
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
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
        view.lastMessagePreview =
          last?.text === "__digest__" ? "Daily digest" : last?.text.slice(0, 80);
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
      return sendJson(res, 200, {
        approvals: this.approvals.filter((a) => a.status === "pending"),
      });
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
      return sendJson(res, 200, { settings: this.settings });
    }
    if (method === "PATCH" && path === "/api/settings") {
      const patch = await readJson<Record<string, unknown>>(req);
      if (patch.caps)
        this.settings.caps = { ...this.settings.caps, ...(patch.caps as Record<string, number>) };
      if (patch.budgets)
        this.settings.budgets = {
          ...this.settings.budgets,
          ...(patch.budgets as Record<string, number>),
        };
      if (patch.quietHours)
        this.settings.quietHours = patch.quietHours as typeof this.settings.quietHours;
      this.settings.updatedAt = new Date().toISOString();
      return sendJson(res, 200, { settings: this.settings });
    }
    if (method === "GET" && path === "/api/engines") {
      return sendJson(res, 200, { engines: SEED_ENGINES });
    }
    if (method === "GET" && path === "/api/digest") {
      return sendJson(res, 200, { digest: SEED_DIGEST });
    }
    if (method === "GET" && path === "/api/computer/status") {
      return sendJson(res, 200, {
        provider: "docker",
        running: true,
        screensActive: 2,
        sharedWorkspaceNotice:
          "Bots share one computer and workspace. Bots are not a security boundary.",
      });
    }
    if (method === "GET" && path.match(/^\/api\/computer\/screens\/[^/]+\/live$/)) {
      const botId = path.split("/")[4]!;
      return sendJson(res, 200, {
        url: `/mock/novnc/${botId}`,
        token: `lv_${botId}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }
    if (method === "POST" && path.match(/^\/api\/computer\/screens\/[^/]+\/takeover$/)) {
      const botId = path.split("/")[4]!;
      const body = await readJson<{ on: boolean }>(req);
      this.takeoverByBot.set(botId, body.on);
      this.appendEvent({
        ts: new Date().toISOString(),
        type: body.on ? "computer.takeover_requested" : "computer.takeover_ended",
        botId,
        payload: { botId },
      });
      return sendJson(res, 200, { ok: true, takeover: body.on });
    }
    if (method === "GET" && path === "/api/computer/tasks") {
      const botId = url.searchParams.get("botId");
      const tasks = botId
        ? SEED_COMPUTER_TASKS.filter((t) => t.botId === botId)
        : SEED_COMPUTER_TASKS;
      return sendJson(res, 200, { tasks });
    }
    if (method === "GET" && path.match(/^\/mock\/novnc\/[^/]+$/)) {
      const botId = path.split("/")[3]!;
      const takeover = this.takeoverByBot.get(botId) ?? false;
      res.writeHead(200, { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" });
      res.end(
        `<!DOCTYPE html><html><body style="margin:0;background:#111;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><div style="font-size:3rem">🖥️</div><p>noVNC live view · ${botId}</p><p style="color:#888">${takeover ? "Takeover active — you control the screen" : "Bot is driving"}</p></div></body></html>`,
      );
      return;
    }
    if (method === "GET" && path.match(/^\/api\/routines\/[^/]+\/runs$/)) {
      const routineId = path.split("/")[3]!;
      const runs = this.routineRuns.filter((r) => r.routineId === routineId);
      return sendJson(res, 200, { runs });
    }
    if (method === "GET" && path.match(/^\/api\/runs\/[^/]+$/)) {
      const runId = path.split("/")[3]!;
      const run = this.routineRuns.find((r) => r.id === runId);
      return sendJson(res, 200, run ?? { error: "not_found" });
    }
    if (method === "POST" && path.match(/^\/api\/routines\/[^/]+\/run$/)) {
      const routineId = path.split("/")[3]!;
      const body = await readJson<{ dryRun?: boolean }>(req);
      const dryRun = body.dryRun !== false;
      const run = {
        id: `rrun_${ulid()}`,
        routineId,
        dryRun,
        status: "done",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        usage: { usd: 0.03, tokens: 8000 },
        resultSummary: dryRun ? "Dry run — no side effects executed" : "Live test run completed",
        plannedActions: dryRun
          ? ["Would update spreadsheet", "Would send Slack message"]
          : undefined,
      };
      this.routineRuns.unshift(run);
      this.appendEvent({
        ts: new Date().toISOString(),
        type: "routine.run_completed",
        payload: { runId: run.id, routineId, dryRun },
      });
      return sendJson(res, 200, run);
    }
    if (method === "POST" && path.match(/^\/api\/routines\/[^/]+\/enable-live$/)) {
      const routineId = path.split("/")[3]!;
      const routine = this.routines.find((r) => r.id === routineId);
      if (routine) routine.liveApproved = true;
      return sendJson(res, 200, { ok: true, routine });
    }
    if (method === "GET" && path === "/api/devices") {
      return sendJson(res, 200, { devices: SEED_DEVICES });
    }
    if (method === "GET" && path === "/api/devices/pair") {
      return sendJson(res, 200, {
        qrUrl: "https://openbot.local/app#pair=mock",
        pairSecret: "pair_secret_mock",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        urls: ["https://openbot.tailnet.ts.net/app", "http://192.168.1.10:3847/app"],
      });
    }
    if (method === "GET" && path === "/api/remote/status") {
      return sendJson(res, 200, this.remote);
    }
    if (method === "POST" && path === "/api/remote/tailscale/enable") {
      this.remote = { enabled: true, via: "tailscale", urls: SEED_REMOTE.urls };
      return sendJson(res, 200, this.remote);
    }
    if (method === "POST" && path === "/api/remote/tailscale/disable") {
      this.remote = { enabled: false, via: undefined, urls: [] };
      return sendJson(res, 200, this.remote);
    }
    if (method === "GET" && path.match(/^\/api\/bots\/[^/]+\/route$/)) {
      const botId = path.split("/")[3]!;
      const route = SEED_ROUTES[botId] ?? { engine: "fake", model: "fake-1", confidence: 0.5 };
      // The harness returns the Bot's routing setting.
      return sendJson(res, 200, {
        routing: { mode: "pinned", engine: route.engine, model: route.model },
      });
    }
    if (method === "GET" && path.match(/^\/api\/bots\/[^/]+\/why$/)) {
      const botId = path.split("/")[3]!;
      const bot = SEED_BOTS.find((b) => b.id === botId);
      return sendJson(res, 200, { justification: bot?.justification ?? null });
    }
    if (method === "GET" && path === "/api/routines") {
      return sendJson(res, 200, { routines: this.routines });
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
