#!/usr/bin/env node
/**
 * HTTP control daemon for OpenBot desktop containers.
 * Observation: CDP DOM → CDP AX → AT-SPI → OCR (plan WS9).
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { DisplaySessionManager } from "./display-session.js";
import { stripMeta } from "@openbot/computer/observation";

const PORT = Number(process.env.OPENBOT_CONTROL_PORT ?? 8787);
const MAX_SCREENS = Number(process.env.OPENBOT_MAX_SCREENS ?? 4);
const TOKEN = process.env.OPENBOT_CONTROL_TOKEN ?? randomBytes(16).toString("hex");
const NOVNC_PORT = Number(process.env.NOVNC_PORT ?? 6080);

const sessions = new DisplaySessionManager({ maxScreens: MAX_SCREENS });

function unauthorized(res: import("node:http").ServerResponse): void {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ detail: { error_type: "auth", message: "invalid token" } }));
}

function parseBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
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
      const action = body.action as import("@openbot/contracts").Action;
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
