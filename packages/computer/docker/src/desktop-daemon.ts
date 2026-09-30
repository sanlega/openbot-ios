#!/usr/bin/env node
/**
 * HTTP control daemon for OpenBot desktop containers.
 * Observation: CDP DOM → CDP AX → AT-SPI → OCR (plan WS9).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cdpCookies, DisplaySessionManager } from "./display-session.js";
import { createLiveViewUrl } from "./live-view-url.js";
import { stripMeta } from "@openbot/computer/observation";
import type { Action } from "@openbot/contracts";

const PORT = Number(process.env.OPENBOT_CONTROL_PORT ?? 8787);
const MAX_SCREENS = Number(process.env.OPENBOT_MAX_SCREENS ?? 4);
const TOKEN = process.env.OPENBOT_CONTROL_TOKEN ?? randomBytes(16).toString("hex");
const NOVNC_PORT = Number(process.env.NOVNC_PORT ?? 6080);
const TOKEN_FILE = "/tmp/openbot-vnc-tokens";
const liveTokens = new Map<string, { display: number; port: number; expires: number }>();

function persistLiveTokens(): void {
  writeFileSync(
    `${TOKEN_FILE}.next`,
    [...liveTokens].map(([token, entry]) => `${token}: 127.0.0.1:${entry.port}`).join("\n") + "\n",
    { mode: 0o600 },
  );
  renameSync(`${TOKEN_FILE}.next`, TOKEN_FILE);
}

// D-032: one set of sign-ins and one set of files for every bot. Browser profiles and the shared
// sign-ins live on the container's browser volume; downloads go to the bots' workspace.
const BROWSER_DIR = process.env.OPENBOT_BROWSER_DIR;
const WORKSPACE = process.env.OPENBOT_WORKSPACE_DIR ?? "/workspace";

const sessions = new DisplaySessionManager({
  maxScreens: MAX_SCREENS,
  ...(BROWSER_DIR
    ? {
        profileRoot: BROWSER_DIR,
        cookies: cdpCookies,
        cookieFile: join(BROWSER_DIR, "shared-cookies.json"),
      }
    : {}),
  ...(existsSync(WORKSPACE) ? { downloadDir: join(WORKSPACE, "downloads") } : {}),
  onEvict: (display) => {
    for (const [token, entry] of liveTokens) {
      if (entry.display === display) liveTokens.delete(token);
    }
    persistLiveTokens();
  },
});

function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ detail: { error_type: "auth", message: "invalid token" } }));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>,
        );
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Nothing an individual request does may crash the desktop for every Bot.
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});

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
    try {
      const botId = url.searchParams.get("botId") ?? "unknown";
      const mode = url.searchParams.get("mode") as "dom" | "ax" | "ocr" | "auto" | null;
      const observation = await sessions.observe(botId, mode ?? "auto");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(stripMeta(observation)));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: String(error) }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/act") {
    try {
      const body = await parseBody(req);
      const botId = String(body.botId ?? "unknown");
      const action = body.action as Action;
      const result = await sessions.act(botId, action);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: String(error) }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/live") {
    const botId = url.searchParams.get("botId");
    if (!botId) {
      res.writeHead(400);
      res.end("botId is required");
      return;
    }
    let ready: { display: number; vncPort: number };
    try {
      ready = await sessions.ensureReady(botId);
    } catch (error) {
      // A failed display start must answer this request, not take the whole daemon down.
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: String(error) }));
      return;
    }
    const { display, vncPort } = ready;
    const liveToken = randomBytes(24).toString("hex");
    const expires = Date.now() + 15 * 60_000;
    for (const [token, entry] of liveTokens) {
      if (entry.expires <= Date.now()) liveTokens.delete(token);
    }
    liveTokens.set(liveToken, { display, port: vncPort, expires });
    persistLiveTokens();
    setTimeout(() => {
      liveTokens.delete(liveToken);
      persistLiveTokens();
    }, 15 * 60_000).unref();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        url: createLiveViewUrl(NOVNC_PORT, liveToken),
        token: liveToken,
        expiresAt: new Date(expires).toISOString(),
        display,
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("not found");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`openbot control daemon listening on ${PORT}`);
});
