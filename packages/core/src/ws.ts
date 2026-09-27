import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OBEvent } from "@openbot/contracts";
import type { WebSocket } from "ws";
import type { CoreContext } from "./context.js";
import { resolveDeviceIdentity } from "./http/auth.js";

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
 * Only `approval.resolve` is implemented directly here — the other three need
 * the runtime mailbox/scheduler (WS2/WS12) and reply with a structured
 * "not implemented" result instead of silently dropping the command.
 */
export function registerWebSocketRoute(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/ws", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const device = resolveDeviceIdentity(ctx, request);
    if (!device) {
      socket.close(4401, "unauthorized");
      return;
    }

    let replayedUpTo = -1;
    const unsubscribe = ctx.eventBus.subscribe((event: OBEvent) => {
      if (event.seq <= replayedUpTo) return;
      safeSend(socket, { type: "event", event });
    });

    socket.on("close", () => unsubscribe());
    socket.on("error", () => unsubscribe());

    socket.on("message", (raw: Buffer | string) => {
      let command: ClientCommand;
      try {
        command = JSON.parse(raw.toString()) as ClientCommand;
      } catch {
        safeSend(socket, { type: "error", error: "invalid_json" });
        return;
      }

      if (command.type === "subscribe") {
        const since = command.since ?? -1;
        const backlog = ctx.eventBus.replaySince(since);
        for (const event of backlog) {
          safeSend(socket, { type: "event", event });
        }
        replayedUpTo = backlog.length > 0 ? backlog[backlog.length - 1]!.seq : since;
        return;
      }

      if (command.type === "command") {
        void handleCommand(ctx, command, device.role).then((result) => {
          safeSend(socket, { type: "command.result", command: command.command, ...result });
        });
        return;
      }

      safeSend(socket, { type: "error", error: "unknown_message_type" });
    });
  });
}

async function handleCommand(
  ctx: CoreContext,
  command: RunCommand,
  role: "owner" | "approver",
): Promise<{ ok: boolean; reason?: string }> {
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
      payload: { id, resolution },
    });
    return { ok: true };
  }

  void role;
  return {
    ok: false,
    reason: `${command.command} needs the runtime (WS2/WS12), not wired into CoreContext yet`,
  };
}
