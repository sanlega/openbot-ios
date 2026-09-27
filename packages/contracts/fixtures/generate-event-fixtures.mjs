#!/usr/bin/env node
/**
 * Regenerates one example fixture per `EventType` (plan §4.2) under
 * `packages/contracts/fixtures/events/`. Run after adding/renaming an event type:
 *   node packages/contracts/fixtures/generate-event-fixtures.mjs
 * `contracts.test.ts` asserts every fixture parses against the `OBEvent` schema
 * and that every `EventType` has exactly one fixture, so this script and the
 * schema can never silently drift apart.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "events");
mkdirSync(outDir, { recursive: true });

const base = {
  id: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  seq: 1,
  ts: "2026-09-27T00:00:00.000Z",
};

/** @type {Record<string, Record<string, unknown>>} */
const payloads = {
  "message.created": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { messageId: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV", text: "hi" } },
  "message.delta": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { text: "hel" } },
  "message.completed": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { messageId: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "message.held": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { messageId: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV", reason: "duplicate_dedupe_key" } },
  "message.merged": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { messageId: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV", mergedInto: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAX" } },
  "turn.queued": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: {} },
  "turn.started": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { engine: "fake", model: "fake-1" } },
  "turn.completed": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { usage: { inputTokens: 10, outputTokens: 5 } } },
  "turn.failed": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { reason: "engine_error" } },
  "turn.interrupted": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { reason: "user_stop" } },
  "tool.started": { turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { toolName: "list_bots", toolUseId: "tu_1" } },
  "tool.completed": { turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { toolUseId: "tu_1", isError: false } },
  "action.simulated": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { op: "click", reason: "dry_run" } },
  "approval.requested": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { approvalId: "apr_01ARZ3NDEKTSV4RRFFQ69G5FAV", kind: "tool" } },
  "approval.resolved": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { approvalId: "apr_01ARZ3NDEKTSV4RRFFQ69G5FAV", resolution: "allow" } },
  "handoff.sent": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { toBotId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAX" } },
  "handoff.received": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAX", payload: { fromBotId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "bot.created": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { createdBy: "user" } },
  "bot.updated": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { fields: ["description"] } },
  "bot.archived": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: {} },
  "bot.archive_suggested": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { idleDays: 7 } },
  "route.decided": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { engine: "claude", model: "claude-opus", confidence: 0.9 } },
  "gate.decided": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { gate: "spawn", allowed: false, reason: "cap_s1", suggestion: "reuse research-bot" } },
  "chain.limit_reached": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { limit: "maxTurns", value: 25 } },
  "guard.tripped": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { guard: "loop", reason: "repeated_content" } },
  "cap.hit": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { cap: "S4", scope: "bot_daily" } },
  "chain.resumed": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: {} },
  "chain.stopped": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { reason: "user_stop" } },
  "attention.changed": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { attention: "needs_review" } },
  "notify.requested": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { kind: "result", delivery: "delivered", pushed: false } },
  "digest.posted": { payload: { held: 2, routineResults: 1 } },
  "usage.recorded": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", turnId: "turn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { inputTokens: 100, outputTokens: 40, usd: 0.01 } },
  "decision.made": { payload: { decisionId: "dec_01ARZ3NDEKTSV4RRFFQ69G5FAV", purpose: "route", band: "auto" } },
  "computer.status": { payload: { provider: "fake", ready: true } },
  "computer.task_started": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { goal: "check flight prices" } },
  "computer.step": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { op: "click", target: 3 } },
  "computer.escalated": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { reason: "low_confidence" } },
  "computer.takeover_requested": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: {} },
  "computer.takeover_ended": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: {} },
  "computer.task_completed": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { status: "completed", steps: 4 } },
  "routine.created": { botId: "bot_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { routineId: "rtn_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "routine.updated": { payload: { routineId: "rtn_01ARZ3NDEKTSV4RRFFQ69G5FAV", fields: ["limits"] } },
  "routine.deleted": { payload: { routineId: "rtn_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "routine.paused": { payload: { routineId: "rtn_01ARZ3NDEKTSV4RRFFQ69G5FAV", reason: "consecutive_failures" } },
  "routine.resumed": { payload: { routineId: "rtn_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "trigger.received": { payload: { triggerEventId: "tev_01ARZ3NDEKTSV4RRFFQ69G5FAV", matched: true } },
  "routine.run_queued": { payload: { runId: "rrun_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "routine.run_started": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { runId: "rrun_01ARZ3NDEKTSV4RRFFQ69G5FAV", dryRun: true } },
  "routine.run_completed": { chainId: "chn_01ARZ3NDEKTSV4RRFFQ69G5FAV", payload: { runId: "rrun_01ARZ3NDEKTSV4RRFFQ69G5FAV", status: "done" } },
  "routine.run_skipped": { payload: { runId: "rrun_01ARZ3NDEKTSV4RRFFQ69G5FAV", skipReason: "capped" } },
  "device.paired": { payload: { deviceId: "dev_01ARZ3NDEKTSV4RRFFQ69G5FAV", via: "lan" } },
  "device.revoked": { payload: { deviceId: "dev_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "remote.status": { payload: { tailscale: { enabled: false }, cloudflare: { enabled: false } } },
  "connector.connected": { payload: { connectionId: "con_01ARZ3NDEKTSV4RRFFQ69G5FAV", provider: "mcp" } },
  "connector.disconnected": { payload: { connectionId: "con_01ARZ3NDEKTSV4RRFFQ69G5FAV" } },
  "setup.changed": { payload: { step: "claude", ok: true } },
  "engine.status": { payload: { engine: "claude", installed: true, loginOk: true } },
  error: { payload: { message: "boom", code: "internal" } },
};

const eventTypes = Object.keys(payloads);

for (const type of eventTypes) {
  const fixture = { ...base, type, ...payloads[type] };
  const filename = `${type.replace(/\./g, "-")}.json`;
  writeFileSync(join(outDir, filename), `${JSON.stringify(fixture, null, 2)}\n`);
}

console.log(`wrote ${eventTypes.length} event fixtures to ${outDir}`);
