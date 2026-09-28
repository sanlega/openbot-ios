import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OBEvent } from "@openbot/contracts";
import type { WebSocket } from "ws";
import type { CoreContext } from "./context.js";
import { resolveDeviceIdentity } from "./http/auth.js";
import { remoteE2EScope, shouldUseE2E } from "@openbot/remote";

interface SubscribeCommand {
  type: "subscribe";
  since?: number;
}

interface RunCommand {
  type: "command";
  command: "message.send" | "approval.resolve" | "turn.stop" | "routine.run";
  payload?: Record<string, unknown>;
}

type ClientCommand = SubscribeCommand | RunCommand;

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

/**
 * `/api/ws` (plan §4.7): `{subscribe, since}` replays from that point with no
 * gaps (events are read from the same durable log `EventBus.replaySince`
 * uses), then streams every event published from then on. Also accepts
 * commands (`message.send`, `approval.resolve`, `turn.stop`, `routine.run`).
 * `message.send`, `turn.stop`, and `routine.run` go through the runtime
 * mailbox/scheduler (`ctx.mailbox`, `ctx.routineOrchestrator`) and reply with a
 * structured "not wired" result when those are absent.
 */
export function registerWebSocketRoute(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/ws", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const device = request.device ?? resolveDeviceIdentity(ctx, request);
    if (!device) {
      socket.close(4401, "unauthorized");
      return;
    }

    // Events flow only after `subscribe`, through one ordered queue per socket.
    // Live events already covered by the replayed backlog are skipped; live
    // notifications themselves may arrive out of seq order, so nothing else is.
    let subscribed = false;
    let replayedUpTo = -1;
    let queue: Promise<void> = Promise.resolve();
    const sendEvent = (event: OBEvent) => {
      queue = queue
        .then(() => sendToClient(socket, ctx, request, device.deviceId, { type: "event", event }))
        .catch(() => undefined);
    };
    const unsubscribe = ctx.eventBus.subscribe((event: OBEvent) => {
      if (subscribed && event.seq > replayedUpTo) sendEvent(event);
    });

    socket.on("close", () => unsubscribe());
    socket.on("error", () => unsubscribe());

    socket.on("message", (raw: Buffer | string) => {
      void (async () => {
        if (device.deviceId !== "local") {
          const activeDevice = ctx.repos.devices.getById(device.deviceId);
          if (!activeDevice || activeDevice.revokedAt) {
            socket.close(4403, "device revoked");
            unsubscribe();
            return;
          }
        }
        let text = raw.toString();
        const deviceRecord = ctx.repos.devices.getById(device.deviceId);
        if (
          shouldUseE2E(request, deviceRecord?.publicKey) &&
          ctx.remote &&
          deviceRecord?.publicKey
        ) {
          const framingKey = ctx.remote.framing.deriveKey(
            ctx.remote.hostKeys.privateKey,
            deviceRecord.publicKey,
          );
          const session = await ctx.remote.framing.ensureSession(
            device.deviceId,
            framingKey,
            remoteE2EScope(request),
          );
          text = await session.decryptWs(text);
        }

        let command: ClientCommand;
        try {
          command = JSON.parse(text) as ClientCommand;
        } catch {
          safeSend(socket, { type: "error", error: "invalid_json" });
          return;
        }

        if (command.type === "subscribe") {
          const since = command.since ?? -1;
          // Synchronously: read the backlog, start listening, and queue the
          // backlog in one step, so later live events queue behind it.
          const backlog = ctx.eventBus.replaySince(since);
          replayedUpTo = backlog.length > 0 ? backlog[backlog.length - 1]!.seq : since;
          subscribed = true;
          for (const event of backlog) sendEvent(event);
          await queue;
          return;
        }

        if (command.type === "command") {
          const result = await handleCommand(ctx, command, device.role);
          await sendToClient(socket, ctx, request, device.deviceId, {
            type: "command.result",
            command: command.command,
            ...result,
          });
          return;
        }

        await sendToClient(socket, ctx, request, device.deviceId, {
          type: "error",
          error: "unknown_message_type",
        });
      })();
    });
  });
}

async function sendToClient(
  socket: WebSocket,
  ctx: CoreContext,
  request: FastifyRequest,
  deviceId: string,
  payload: unknown,
): Promise<void> {
  const deviceRecord = ctx.repos.devices.getById(deviceId);
  if (shouldUseE2E(request, deviceRecord?.publicKey) && ctx.remote && deviceRecord?.publicKey) {
    const framingKey = ctx.remote.framing.deriveKey(
      ctx.remote.hostKeys.privateKey,
      deviceRecord.publicKey,
    );
    const session = await ctx.remote.framing.ensureSession(
      deviceId,
      framingKey,
      remoteE2EScope(request),
    );
    const encrypted = await session.encryptWs(JSON.stringify(payload));
    safeSend(socket, encrypted);
    return;
  }
  safeSend(socket, payload);
}

async function handleCommand(
  ctx: CoreContext,
  command: RunCommand,
  role: "owner" | "approver",
): Promise<{
  ok: boolean;
  reason?: string;
  runId?: string;
  chainId?: string;
  messageId?: string;
  engine?: string;
  model?: string;
}> {
  if (command.command === "approval.resolve") {
    const id = command.payload?.id;
    const resolution = command.payload?.resolution;
    if (typeof id !== "string" || (resolution !== "allow" && resolution !== "deny")) {
      return { ok: false, reason: "expected { id: string, resolution: 'allow'|'deny' }" };
    }
    const approval = ctx.repos.approvals.getById(id);
    if (!approval || approval.status !== "pending")
      return { ok: false, reason: "no pending approval with that id" };
    ctx.repos.approvals.resolve(id, resolution);
    await ctx.eventBus.publish({
      type: "approval.resolved",
      botId: approval.botId,
      chainId: approval.chainId,
      payload: { id, approvalId: id, resolution },
    });
    ctx.onApprovalResolved?.(id, resolution);
    return { ok: true };
  }

  if (command.command === "routine.run") {
    const routineId = command.payload?.routineId;
    const dryRun = command.payload?.dryRun;
    if (typeof routineId !== "string") {
      return { ok: false, reason: "expected { routineId: string, dryRun?: boolean }" };
    }
    if (!ctx.routineOrchestrator) {
      return { ok: false, reason: "routine orchestrator not wired (WS12)" };
    }
    const result = await ctx.routineOrchestrator.queueRun(routineId, "manual", {
      dryRun: typeof dryRun === "boolean" ? dryRun : undefined,
    });
    if ("skipped" in result) {
      return { ok: false, reason: result.reason };
    }
    return { ok: true, runId: result.id };
  }

  if (command.command === "message.send") {
    if (!ctx.mailbox) {
      return { ok: false, reason: "mailbox not wired (WS13)" };
    }
    const botId = command.payload?.botId;
    const threadId = command.payload?.threadId;
    const chainId = command.payload?.chainId;
    const text = command.payload?.text;
    const engine = command.payload?.engine;
    if (
      typeof botId !== "string" ||
      typeof text !== "string" ||
      (threadId !== undefined && typeof threadId !== "string") ||
      (chainId !== undefined && typeof chainId !== "string") ||
      (engine !== undefined && engine !== "claude" && engine !== "codex" && engine !== "fake")
    ) {
      return {
        ok: false,
        reason:
          "expected { botId: string, text: string, threadId?: string, chainId?: string, engine?: 'claude'|'codex'|'fake' }",
      };
    }
    return ctx.mailbox.enqueue({ botId, threadId, chainId, text, engine });
  }

  if (command.command === "turn.stop") {
    const turnId = command.payload?.turnId;
    if (typeof turnId !== "string") {
      return { ok: false, reason: "expected { turnId: string }" };
    }
    if (!ctx.mailbox) {
      return { ok: false, reason: "mailbox not wired (WS13)" };
    }
    return ctx.mailbox.stop(turnId);
  }

  void role;
  return {
    ok: false,
    reason: `unsupported command: ${command.command}`,
  };
}
