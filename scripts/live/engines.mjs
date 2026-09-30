// Live check of the ACP engines (D-031), see scripts/live/README.md.
// Real harness (built), a COPY of an OpenBot home, a real ACP engine (default: OpenCode with a
// local Ollama model). Creates a Bot pinned to that engine and model, then:
//   1. it answers and calls one of OpenBot's own MCP tools (list_bots);
//   2. asked to write a file outside its workspace, it raises an approval card, which is denied,
//      and the file must not exist;
//   3. a follow-up turn resumes the same session (it remembers turn 1).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME = process.env.RUN_HOME;
if (!HOME) throw new Error("RUN_HOME: a COPY of an OpenBot home (never the live ~/.openbot)");
const PORT = Number(process.env.RUN_PORT ?? 4592);
const ENGINE = process.env.RUN_ENGINE ?? "opencode";
const MODEL = process.env.RUN_MODEL ?? "ollama/qwen3:8b";
const TURN_MIN = Number(process.env.RUN_TURN_MIN ?? 8);
const here = process.env.RUN_OUT ?? process.cwd();
const LOG = join(here, `${process.env.RUN_TAG ?? "engines"}.log`);
writeFileSync(LOG, "");
const log = (...parts) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(" ")}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
};

const base = `http://127.0.0.1:${PORT}`;
const api = async (path, body, method) => {
  const res = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const server = spawn(process.execPath, [join(REPO, "apps/server/dist/main.js"), "serve"], {
  env: {
    ...process.env,
    OPENBOT_HOME: HOME,
    PORT: String(PORT),
    OPENBOT_MCP_REGISTRY_URL: "http://127.0.0.1:9",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (c) => appendFileSync(LOG + ".server", c));
server.stderr.on("data", (c) => appendFileSync(LOG + ".server", c));
process.on("exit", () => server.kill());

for (let i = 0; ; i++) {
  try {
    if ((await api("/api/harness/status")).body.connected) break;
  } catch {
    // still booting
  }
  if (i > 300) throw new Error("server did not start");
  await new Promise((r) => setTimeout(r, 200));
}
log("server up", base);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(ok ? "PASS" : "FAIL", name, detail);
};

const engines = (await api("/api/engines")).body.engines;
const engine = engines.find((e) => e.id === ENGINE);
check(`engine ${ENGINE} is available`, engine?.available === true, JSON.stringify(engine));
const models =
  (await api("/api/models")).body.engines.find((e) => e.engine === ENGINE)?.models ?? [];
check(
  `model ${MODEL} is listed`,
  models.some((m) => m.id === MODEL),
  `${models.length} models`,
);

const created = await api("/api/bots", {
  name: `Local test ${Date.now() % 10000}`,
  description: "A test bot for the engines live check. Be brief.",
  routing: { mode: "pinned", engine: ENGINE, model: MODEL },
  permissionPreset: "workspace_write",
  computer: "none",
});
const bot = created.body.bot;
const threadId = created.body.thread?.id;
log("bot", bot?.id, created.status);

const ws = new WebSocket(base.replace("http", "ws") + "/api/ws");
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({ type: "subscribe" }));
const events = [];
ws.addEventListener("message", (m) => {
  const frame = JSON.parse(String(m.data));
  if (frame.type !== "event" || frame.event.botId !== bot.id) return;
  const e = frame.event;
  events.push(e);
  const p = e.payload ?? {};
  if (e.type.startsWith("turn.")) log(e.type, (p.error ?? p.reason ?? "").toString().slice(0, 300));
  else if (e.type === "tool.started")
    log("  tool", p.toolName, JSON.stringify(p.input ?? {}).slice(0, 160));
  else if (e.type === "message.created") {
    const msg = p.message ?? p;
    if (msg.author?.type !== "user") log("MSG", JSON.stringify(msg.text ?? "").slice(0, 400));
  } else if (e.type.startsWith("approval.")) log(e.type, JSON.stringify(p).slice(0, 300));
});

/** Sends a message and waits for the turn to end; denies every approval card meanwhile. */
async function turn(text) {
  const from = events.length;
  ws.send(
    JSON.stringify({
      type: "command",
      command: "message.send",
      payload: { botId: bot.id, threadId, text },
    }),
  );
  log("USER ->", text);
  const started = Date.now();
  const answered = new Set();
  let cards = 0;
  while (Date.now() - started < TURN_MIN * 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const approvals = (await api("/api/approvals")).body.approvals ?? [];
    for (const a of approvals.filter(
      (x) => x.status === "pending" && x.botId === bot.id && !answered.has(x.id),
    )) {
      answered.add(a.id);
      cards += 1;
      log("CARD (denied)", a.summary ?? a.action ?? "", (a.detail ?? "").slice(0, 200));
      await api(`/api/approvals/${a.id}/resolve`, { resolution: "deny" });
    }
    const end = events
      .slice(from)
      .find((e) => ["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type));
    if (end) {
      await new Promise((r) => setTimeout(r, 500));
      const mine = events.slice(from);
      const reply = mine
        .filter((e) => e.type === "message.created")
        .map((e) => (e.payload?.message ?? e.payload)?.text ?? "")
        .filter(Boolean)
        .join("\n");
      return { end: end.type, events: mine, cards, reply, error: end.payload?.error };
    }
  }
  return { end: "timeout", events: events.slice(from), cards, reply: "" };
}

const t1 = await turn(
  "Use your list_bots tool to see which bots exist, then tell me how many there are. Also remember this code word for later: PAPAYA.",
);
check("turn 1 completed", t1.end === "turn.completed", t1.error ?? "");
check(
  "turn 1 called an OpenBot MCP tool",
  t1.events.some((e) => e.type === "tool.started" && /list_bots/.test(e.payload?.toolName ?? "")),
);
check("turn 1 replied", t1.reply.trim().length > 0);

const outside = join(mkdtempSync(join(tmpdir(), "openbot-outside-")), "note.txt");
const t2 = await turn(`Write the word hello into the file ${outside} (outside your workspace).`);
check("writing outside the workspace raised a card", t2.cards > 0, `cards=${t2.cards}`);
check("the denied file was not written", !existsSync(outside));

const t3 = await turn("What was the code word I asked you to remember? Reply with just the word.");
check("turn 3 completed", t3.end === "turn.completed", t3.error ?? "");
check("turn 3 remembers turn 1 (same session)", /papaya/i.test(t3.reply), t3.reply.slice(0, 80));

const failed = results.filter((r) => !r.ok);
log("SUMMARY", `${results.length - failed.length}/${results.length} passed`);
server.kill();
process.exit(failed.length ? 1 : 0);
