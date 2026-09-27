#!/usr/bin/env node
/**
 * Per-bot display manager + HTTP control API for OpenBot desktop containers.
 * Each bot gets an isolated Xvfb display (:1..:N), Chromium, and tokenized noVNC URL.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.OPENBOT_CONTROL_PORT ?? 8787);
const MAX_SCREENS = Number(process.env.OPENBOT_MAX_SCREENS ?? 4);
const TOKEN = process.env.OPENBOT_CONTROL_TOKEN ?? randomBytes(16).toString("hex");
const NOVNC_PORT = Number(process.env.NOVNC_PORT ?? 6080);

/** @type {Map<string, { display: number, vncPort: number, lastUsed: number }>} */
const screens = new Map();
/** @type {Map<number, string>} */
const displayOwners = new Map();

function assignDisplay(botId) {
  const existing = screens.get(botId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.display;
  }
  if (screens.size >= MAX_SCREENS) {
    evictOldest();
  }
  const display = nextFreeDisplay();
  const vncPort = 5900 + display;
  ensureDisplayRunning(display, vncPort);
  const slot = { display, vncPort, lastUsed: Date.now(), botId };
  screens.set(botId, slot);
  displayOwners.set(display, botId);
  return display;
}

function releaseDisplay(botId) {
  const slot = screens.get(botId);
  if (!slot) return;
  displayOwners.delete(slot.display);
  screens.delete(botId);
}

function evictOldest() {
  let oldestBot;
  let oldestTime = Infinity;
  for (const [botId, slot] of screens.entries()) {
    if (slot.lastUsed < oldestTime) {
      oldestTime = slot.lastUsed;
      oldestBot = botId;
    }
  }
  if (oldestBot) releaseDisplay(oldestBot);
}

function nextFreeDisplay() {
  for (let d = 1; d <= MAX_SCREENS + 5; d += 1) {
    if (!displayOwners.has(d)) return d;
  }
  return MAX_SCREENS + 1;
}

function ensureDisplayRunning(display, vncPort) {
  const displayStr = `:${display}`;
  spawn("Xvfb", [displayStr, "-screen", "0", "1280x800x24"], { detached: true, stdio: "ignore" });
  spawn("fluxbox", ["-display", displayStr], { detached: true, stdio: "ignore" });
  spawn("x11vnc", ["-display", displayStr, "-forever", "-shared", "-rfbport", String(vncPort), "-nopw"], {
    detached: true,
    stdio: "ignore",
  });
  spawn("chromium", ["--display", displayStr, "--no-sandbox", "--disable-gpu", "about:blank"], {
    detached: true,
    stdio: "ignore",
  });
}

function observe(_botId, display) {
  // Minimal DOM fixture until CDP wiring lands; real observation uses CDP → AX → OCR.
  return {
    url: `https://desktop.local/display/${display}`,
    title: `Bot display :${display}`,
    elements: [
      { index: 0, role: "button", label: "Refresh" },
      { index: 1, role: "link", label: "Compose" },
    ],
  };
}

async function act(_botId, display, action) {
  const env = { ...process.env, DISPLAY: `:${display}` };
  switch (action.op) {
    case "click":
      if (action.target === undefined) return { ok: false, reason: "click requires target" };
      await run("xdotool", ["key", "Return"], env);
      return { ok: true };
    case "type":
      if (!action.text) return { ok: false, reason: "type requires text" };
      await run("xdotool", ["type", "--", action.text], env);
      return { ok: true };
    case "wait":
    case "scroll":
    case "done":
      return { ok: true };
    case "navigate":
      if (!action.url) return { ok: false, reason: "navigate requires url" };
      spawn("chromium", ["--display", `:${display}`, "--no-sandbox", action.url], {
        detached: true,
        stdio: "ignore",
      });
      return { ok: true };
    default:
      return { ok: false, reason: `unsupported op: ${action.op}` };
  }
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
  });
}

function unauthorized(res) {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ detail: { error_type: "auth", message: "invalid token" } }));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

createServer(async (req, res) => {
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${TOKEN}`) return unauthorized(res);

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, maxScreens: MAX_SCREENS }));
    return;
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/observe") {
    const botId = url.searchParams.get("botId") ?? "unknown";
    const display = assignDisplay(botId);
    const observation = observe(botId, display);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(observation));
    return;
  }

  if (req.method === "POST" && url.pathname === "/act") {
    const body = await parseBody(req);
    const botId = body.botId ?? "unknown";
    const display = assignDisplay(botId);
    const result = await act(botId, display, body.action ?? {});
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "GET" && url.pathname === "/live") {
    const display = Number(url.searchParams.get("display") ?? "1");
    const liveToken = randomBytes(8).toString("hex");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        url: `http://127.0.0.1:${NOVNC_PORT}/vnc.html?display=${display}`,
        token: liveToken,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("not found");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`openbot control daemon listening on ${PORT}`);
});
