import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { monotonicFactory } from "ulid";
import type {
  Approval,
  Bot,
  CatalogEntry,
  ConnectionView,
  Message,
  OBEvent,
  Thread,
} from "@openbot/contracts";
import type { SetupValidateRequest } from "../api/types.js";
import {
  SEED_APPROVALS,
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

/** A few curated entries in the harness's catalogue shape (`packages/connectors`). */
const MOCK_CATALOG: Array<Omit<CatalogEntry, "connected" | "connectionId">> = [
  {
    id: "curated:github",
    name: "GitHub",
    publisher: "GitHub",
    category: "Development",
    description: "Repositories, issues, pull requests, and code search on GitHub.",
    kind: "remote",
    auth: "token",
    setup: {
      fields: [
        {
          key: "GITHUB_TOKEN",
          label: "Personal access token",
          help: "A fine-grained token with access to the repositories the Bot may use.",
          secret: true,
          placeholder: "github_pat_…",
        },
      ],
      docsUrl: "https://github.com/github/github-mcp-server",
    },
    tools: [
      { name: "list_issues", write: false },
      { name: "issue_write", write: true },
    ],
    verified: true,
  },
  {
    id: "curated:notion",
    name: "Notion",
    publisher: "Notion",
    category: "Productivity",
    description: "Search, read, and edit pages and databases in your Notion workspace.",
    kind: "remote",
    auth: "oauth",
    setup: { fields: [], docsUrl: "https://developers.notion.com/docs/mcp" },
    verified: true,
  },
  {
    id: "curated:filesystem",
    name: "Filesystem",
    publisher: "Model Context Protocol",
    category: "System",
    description: "Read and write files inside one folder you choose.",
    kind: "local",
    auth: "none",
    setup: {
      fields: [
        {
          key: "FOLDER",
          label: "Folder",
          help: "Absolute path of the only folder the Bot may access.",
          secret: false,
          placeholder: "/path/to/folder",
        },
      ],
    },
    verified: true,
  },
  {
    id: "curated:time",
    name: "Time",
    publisher: "Model Context Protocol",
    category: "Productivity",
    description: "Current time and time-zone conversions.",
    kind: "local",
    auth: "none",
    setup: { fields: [] },
    tools: [{ name: "get_current_time", write: false }],
    verified: true,
  },
];

const MOCK_COMMUNITY: Array<Omit<CatalogEntry, "connected" | "connectionId">> = [
  {
    id: "registry:io.github.example/weather",
    name: "weather",
    publisher: "io.github.example",
    category: "Community",
    description: "Weather forecasts (example community server).",
    kind: "local",
    auth: "none",
    setup: { fields: [] },
    verified: false,
  },
];

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
  private connections: ConnectionView[] = [];
  private push: {
    configured: boolean;
    keyId?: string;
    teamId?: string;
    bundleId: string;
    previews: boolean;
    devices: number;
  } = { configured: false, bundleId: "ai.openbot.mobile", previews: true, devices: 1 };
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
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
    if (method === "GET" && path === "/api/harness/status") {
      return sendJson(res, 200, { connected: true, version: "0.1.0" });
    }
    if (method === "GET" && path === "/api/bots") {
      return sendJson(res, 200, { bots: SEED_BOTS });
    }
    if (method === "POST" && path === "/api/bots") {
      const body = await readJson<{ name: string; description?: string }>(req);
      const id = `bot_${Date.now().toString(36)}`;
      const bot: Bot = {
        id,
        slug: body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: body.name,
        description: body.description ?? "",
        pinned: false,
        hidden: false,
        isChiefOfStaff: false,
        createdBy: "user",
        routing: { mode: "auto" },
        permissionPreset: "workspace_write",
        computer: "none",
        connectors: [],
        limits: {},
      };
      const thread: Thread = {
        id: `thr_${id}`,
        botId: id,
        kind: "dm",
        createdAt: new Date().toISOString(),
      };
      SEED_BOTS.push(bot);
      SEED_THREADS.push(thread);
      return sendJson(res, 201, { bot, thread });
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
    // Same shapes as the harness (packages/core/src/http/routes).
    if (method === "GET" && path === "/api/activity") {
      const delivery = url.searchParams.get("delivery");
      const botId = url.searchParams.get("botId");
      const threadId = botId ? SEED_THREADS.find((t) => t.botId === botId)?.id : undefined;
      const messages = this.messages
        .filter((m) => !delivery || m.delivery === delivery)
        .filter((m) => !threadId || m.threadId === threadId)
        .filter((m) => m.text !== "__digest__");
      return sendJson(res, 200, { messages });
    }
    if (method === "GET" && path === "/api/audit") {
      return sendJson(res, 200, { approvals: this.approvals, turns: [] });
    }
    if (method === "GET" && path === "/api/setup") {
      return sendJson(res, 200, { setup: SEED_SETUP });
    }
    if (method === "POST" && path === "/api/setup/validate") {
      const body = await readJson<SetupValidateRequest>(req);
      const ok = Boolean(body.value && body.value.length >= 8);
      return sendJson(res, 200, {
        result: { ok, reason: ok ? undefined : "Invalid or missing value" },
        setup: SEED_SETUP,
      });
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
      return sendJson(res, 200, { ready: true, provider: "docker" });
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
        usage: { usd: 0.03, inputTokens: 6000, outputTokens: 2000 },
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
    if (method === "POST" && path === "/api/devices/pair/qr") {
      return sendJson(res, 200, {
        qrUrl: "https://openbot.local/app#pair=mock",
        pairSecret: "pair_secret_mock",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        urls: ["https://openbot.tailnet.ts.net/app", "http://192.168.1.10:3847/app"],
      });
    }
    if (method === "GET" && path === "/api/remote/status") {
      return sendJson(res, 200, {
        remoteEnabled: this.remote.enabled,
        tailscale: {
          installed: true,
          serveEnabled: this.remote.enabled && this.remote.via === "tailscale",
          serveUrls: this.remote.enabled ? (this.remote.urls ?? []) : [],
        },
        cloudflare: { running: false },
      });
    }
    if (method === "POST" && path === "/api/remote/tailscale/enable") {
      this.remote = { enabled: true, via: "tailscale", urls: SEED_REMOTE.urls };
      return sendJson(res, 200, { result: { ok: true } });
    }
    if (method === "POST" && path === "/api/remote/tailscale/disable") {
      this.remote = { enabled: false, via: undefined, urls: [] };
      return sendJson(res, 200, { ok: true });
    }
    if (method === "GET" && path === "/api/remote/push") {
      return sendJson(res, 200, this.push);
    }
    if (method === "PUT" && path === "/api/remote/push") {
      const body = await readJson<{
        keyP8?: string;
        keyId?: string;
        teamId?: string;
        previews?: boolean;
      }>(req);
      if (!/^[A-Z0-9]{10}$/.test(body.keyId ?? "") || !/^[A-Z0-9]{10}$/.test(body.teamId ?? "")) {
        return sendJson(res, 400, {
          error: "invalid_request",
          reason: "The Key ID is the 10-character ID shown next to the key.",
        });
      }
      if (!this.push.configured && !body.keyP8?.includes("PRIVATE KEY")) {
        return sendJson(res, 400, { error: "invalid_request", reason: "Add your .p8 key." });
      }
      this.push = {
        ...this.push,
        configured: true,
        keyId: body.keyId,
        teamId: body.teamId,
        previews: body.previews ?? this.push.previews,
      };
      return sendJson(res, 200, this.push);
    }
    if (method === "POST" && path === "/api/remote/push/test") {
      return sendJson(res, 200, { sent: this.push.devices, failed: 0, reasons: [] });
    }
    if (method === "GET" && path === "/api/inputs") {
      return sendJson(res, 200, { inputs: [] });
    }
    if (method === "POST" && path.match(/^\/api\/inputs\/[^/]+\/(answer|dismiss)$/)) {
      return sendJson(res, 404, { error: "not_found" });
    }
    if (method === "GET" && path === "/api/models") {
      return sendJson(res, 200, {
        engines: [
          {
            engine: "claude",
            models: [
              { id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 200_000 },
              { id: "claude-sonnet-5", label: "Claude Sonnet 5", contextWindow: 200_000 },
            ],
          },
          { engine: "codex", models: [{ id: "gpt-5-codex", label: "GPT-5 Codex" }] },
        ],
      });
    }
    if (method === "PATCH" && path.match(/^\/api\/bots\/[^/]+$/)) {
      const botId = path.split("/")[3]!;
      const idx = SEED_BOTS.findIndex((b) => b.id === botId);
      if (idx < 0) return sendJson(res, 404, { error: "not_found" });
      const patch = await readJson<Partial<Bot>>(req);
      SEED_BOTS[idx] = { ...SEED_BOTS[idx]!, ...patch };
      return sendJson(res, 200, { bot: SEED_BOTS[idx] });
    }
    if (method === "DELETE" && path.match(/^\/api\/bots\/[^/]+$/)) {
      const botId = path.split("/")[3]!;
      const idx = SEED_BOTS.findIndex((b) => b.id === botId);
      if (idx < 0) return sendJson(res, 404, { error: "not_found" });
      SEED_BOTS[idx] = { ...SEED_BOTS[idx]!, archivedAt: new Date().toISOString() };
      return sendJson(res, 200, { ok: true });
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
    // Connectors: same shapes as packages/core/src/http/routes/connectors.ts.
    if (method === "GET" && path === "/api/connectors/catalog") {
      const source = url.searchParams.get("source") ?? "curated";
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const pool = source === "community" ? MOCK_COMMUNITY : MOCK_CATALOG;
      const entries: CatalogEntry[] = pool
        .filter((e) => !q || `${e.name} ${e.description} ${e.category}`.toLowerCase().includes(q))
        .map((e) => {
          const connection = this.connections.find((c) => c.catalogId === e.id);
          return {
            ...e,
            connected: Boolean(connection),
            ...(connection ? { connectionId: connection.id } : {}),
          };
        });
      return sendJson(res, 200, { entries });
    }
    if (method === "POST" && path === "/api/connectors/connect") {
      const body = await readJson<{
        catalogId?: string;
        values?: Record<string, string>;
        displayName?: string;
      }>(req);
      const entry = [...MOCK_CATALOG, ...MOCK_COMMUNITY].find((e) => e.id === body.catalogId);
      if (!entry) {
        return sendJson(res, 404, {
          error: "unknown_catalog_entry",
          reason: `Unknown connector "${body.catalogId}".`,
        });
      }
      if (entry.auth === "oauth") {
        return sendJson(res, 409, {
          error: "oauth_not_supported_yet",
          reason: `${entry.name} needs OAuth sign-in, which is coming soon.`,
        });
      }
      const missing = (entry.setup?.fields ?? [])
        .filter((f) => !f.optional && !body.values?.[f.key]?.trim())
        .map((f) => f.key);
      if (missing.length > 0) {
        return sendJson(res, 400, {
          error: "missing_fields",
          reason: `Missing ${missing.join(", ")} for ${entry.name}.`,
          fields: missing,
        });
      }
      const connection: ConnectionView = {
        id: `connection_${ulid()}`,
        catalogId: entry.id,
        name: body.displayName ?? entry.name,
        status: "connected",
        createdAt: new Date().toISOString(),
      };
      this.connections.push(connection);
      this.appendEvent({
        ts: connection.createdAt,
        type: "connector.connected",
        payload: { connectionId: connection.id, catalogId: entry.id, name: connection.name },
      });
      return sendJson(res, 201, { connection });
    }
    if (method === "GET" && path === "/api/connectors/connections") {
      return sendJson(res, 200, { connections: this.connections });
    }
    if (method === "DELETE" && path.match(/^\/api\/connectors\/connections\/[^/]+$/)) {
      const id = path.split("/")[4]!;
      const connection = this.connections.find((c) => c.id === id);
      if (!connection) return sendJson(res, 404, { error: "not_found" });
      this.connections = this.connections.filter((c) => c.id !== id);
      for (const [i, bot] of SEED_BOTS.entries()) {
        if (!bot.connectors.includes(id)) continue;
        const patch = { connectors: bot.connectors.filter((c) => c !== id) };
        SEED_BOTS[i] = { ...bot, ...patch };
        this.appendEvent({
          ts: new Date().toISOString(),
          type: "bot.updated",
          botId: bot.id,
          payload: { patch, bot: SEED_BOTS[i] },
        });
      }
      this.appendEvent({
        ts: new Date().toISOString(),
        type: "connector.disconnected",
        payload: { connectionId: id, catalogId: connection.catalogId },
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "GET" && path.match(/^\/api\/bots\/[^/]+\/connectors$/)) {
      const bot = SEED_BOTS.find((b) => b.id === path.split("/")[3]);
      if (!bot) return sendJson(res, 404, { error: "not_found" });
      return sendJson(res, 200, { connectors: bot.connectors });
    }
    if (method === "PUT" && path.match(/^\/api\/bots\/[^/]+\/connectors$/)) {
      const botId = path.split("/")[3]!;
      const idx = SEED_BOTS.findIndex((b) => b.id === botId);
      if (idx < 0) return sendJson(res, 404, { error: "not_found" });
      const body = await readJson<{ connectors?: string[] }>(req);
      const connectors = [...new Set(body.connectors ?? [])];
      const unknown = connectors.filter((c) => !this.connections.some((x) => x.id === c));
      if (unknown.length > 0) {
        return sendJson(res, 400, {
          error: "unknown_connection",
          reason: `unknown connection(s): ${unknown.join(", ")}`,
        });
      }
      const patch = { connectors };
      SEED_BOTS[idx] = { ...SEED_BOTS[idx]!, ...patch };
      this.appendEvent({
        ts: new Date().toISOString(),
        type: "bot.updated",
        botId,
        payload: { patch, bot: SEED_BOTS[idx] },
      });
      return sendJson(res, 200, { connectors });
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
