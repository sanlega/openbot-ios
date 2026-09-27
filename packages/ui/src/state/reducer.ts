import type { Approval, Bot, Message, OBEvent } from "@openbot/contracts";
import type { RoutePreview, ThreadView } from "../api/types.js";

export interface UiState {
  lastSeq: number;
  seenEventIds: Set<string>;
  bots: Map<string, Bot>;
  threads: Map<string, ThreadView>;
  messagesByThread: Map<string, Message[]>;
  streamingDeltas: Map<string, string>;
  approvals: Map<string, Approval>;
  routes: Map<string, RoutePreview>;
  activeChainId?: string;
  connected: boolean;
  replayDone: boolean;
}

export function createInitialState(
  bots: Bot[] = [],
  threads: ThreadView[] = [],
  messages: Message[] = [],
): UiState {
  const state: UiState = {
    lastSeq: 0,
    seenEventIds: new Set(),
    bots: new Map(bots.map((b) => [b.id, b])),
    threads: new Map(threads.map((t) => [t.id, t])),
    messagesByThread: new Map(),
    streamingDeltas: new Map(),
    approvals: new Map(),
    routes: new Map(),
    connected: false,
    replayDone: false,
  };
  for (const msg of messages) {
    const list = state.messagesByThread.get(msg.threadId) ?? [];
    list.push(msg);
    state.messagesByThread.set(msg.threadId, list);
  }
  return state;
}

export type UiAction =
  | { type: "ws.connected" }
  | { type: "ws.replay.done" }
  | {
      type: "hydrate";
      bots: Bot[];
      threads: ThreadView[];
      messages: Message[];
      approvals: Approval[];
      routes: Record<string, RoutePreview>;
    }
  | { type: "event"; event: OBEvent };

function upsertMessage(state: UiState, message: Message): void {
  const list = [...(state.messagesByThread.get(message.threadId) ?? [])];
  const idx = list.findIndex((m) => m.id === message.id);
  if (idx >= 0) list[idx] = message;
  else list.push(message);
  list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.messagesByThread.set(message.threadId, list);

  const thread = state.threads.get(message.threadId);
  if (thread) {
    thread.lastMessagePreview = message.text.slice(0, 80);
  }
}

/** Reducer over OBEvents — dedupes by event id so reconnects never duplicate UI rows. */
export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "ws.connected":
      return { ...state, connected: true };
    case "ws.replay.done":
      return { ...state, replayDone: true };
    case "hydrate": {
      const next = createInitialState(action.bots, action.threads, action.messages);
      next.approvals = new Map(action.approvals.map((a) => [a.id, a]));
      next.routes = new Map(Object.entries(action.routes));
      return next;
    }
    case "event": {
      const { event } = action;
      if (state.seenEventIds.has(event.id)) return state;
      const next: UiState = {
        ...state,
        seenEventIds: new Set(state.seenEventIds).add(event.id),
        lastSeq: Math.max(state.lastSeq, event.seq),
        bots: new Map(state.bots),
        threads: new Map(state.threads),
        messagesByThread: new Map(state.messagesByThread),
        streamingDeltas: new Map(state.streamingDeltas),
        approvals: new Map(state.approvals),
        routes: new Map(state.routes),
      };
      applyEvent(next, event);
      return next;
    }
    default:
      return state;
  }
}

function applyEvent(state: UiState, event: OBEvent): void {
  const p = event.payload;

  switch (event.type) {
    case "bot.created":
    case "bot.updated": {
      const bot = p.bot as Bot | undefined;
      if (bot) state.bots.set(bot.id, bot);
      break;
    }
    case "bot.archived": {
      const botId = String(p.botId ?? event.botId ?? "");
      const bot = state.bots.get(botId);
      if (bot) state.bots.set(botId, { ...bot, archivedAt: event.ts });
      break;
    }
    case "message.created": {
      const threadId = String(event.threadId ?? "");
      const msg: Message = {
        id: String(p.messageId ?? `msg_${event.id}`),
        threadId,
        author:
          p.author === "user" ? { type: "user", id: "user" } : { type: "bot", id: event.botId },
        text: String(p.text ?? ""),
        attachments: [],
        chainId: event.chainId,
        hop: 0,
        createdAt: event.ts,
        proactive: Boolean(p.proactive),
        kind: p.kind as Message["kind"],
        delivery: (p.delivery as Message["delivery"]) ?? "delivered",
        pushed: Boolean(p.pushed),
        dedupeKey: typeof p.dedupeKey === "string" ? p.dedupeKey : undefined,
      };
      upsertMessage(state, msg);
      break;
    }
    case "message.delta": {
      const messageId = String(p.messageId ?? "");
      const delta = String(p.delta ?? p.text ?? "");
      state.streamingDeltas.set(messageId, (state.streamingDeltas.get(messageId) ?? "") + delta);
      break;
    }
    case "message.completed": {
      const messageId = String(p.messageId ?? "");
      const text = String(p.text ?? state.streamingDeltas.get(messageId) ?? "");
      state.streamingDeltas.delete(messageId);
      if (event.threadId) {
        upsertMessage(state, {
          id: messageId,
          threadId: event.threadId,
          author: { type: "bot", id: event.botId },
          text,
          attachments: [],
          createdAt: event.ts,
          proactive: false,
          delivery: "delivered",
          pushed: false,
          hop: 0,
        });
      }
      break;
    }
    case "message.held":
    case "message.merged": {
      const messageId = String(p.messageId ?? "");
      const threadId = String(event.threadId ?? "");
      const list = state.messagesByThread.get(threadId) ?? [];
      const existing = list.find((m) => m.id === messageId);
      if (existing) {
        upsertMessage(state, {
          ...existing,
          delivery: event.type === "message.held" ? "held" : "merged",
        });
      }
      break;
    }
    case "approval.requested": {
      const approval: Approval = {
        id: String(p.approvalId ?? p.id ?? `apr_${event.id}`),
        kind: (p.kind as Approval["kind"]) ?? "tool",
        botId: String(event.botId ?? p.botId ?? ""),
        chainId: event.chainId,
        summary: String(p.summary ?? "Approval required"),
        detail: String(p.detail ?? ""),
        risk: typeof p.risk === "number" ? p.risk : undefined,
        status: "pending",
        resolution: undefined,
        expiresAt: String(p.expiresAt ?? new Date(Date.now() + 1_800_000).toISOString()),
        createdAt: event.ts,
      };
      state.approvals.set(approval.id, approval);
      break;
    }
    case "approval.resolved": {
      const id = String(p.approvalId ?? p.id ?? "");
      const existing = state.approvals.get(id);
      if (existing) {
        state.approvals.set(id, {
          ...existing,
          status: "resolved",
          resolution: p.resolution as Approval["resolution"],
        });
      }
      break;
    }
    case "route.decided": {
      const botId = String(event.botId ?? "");
      state.routes.set(botId, {
        engine: String(p.engine ?? "fake"),
        model: String(p.model ?? "unknown"),
        effort: p.effort as RoutePreview["effort"],
        confidence: Number(p.confidence ?? 0),
        decisionId: p.decisionId ? String(p.decisionId) : undefined,
      });
      break;
    }
    case "turn.started": {
      state.activeChainId = event.chainId;
      // The engine and model a turn actually runs on is the route chip's truth.
      const botId = String(event.botId ?? "");
      if (botId && p.engine) {
        state.routes.set(botId, {
          ...state.routes.get(botId),
          engine: String(p.engine),
          model: String(p.model ?? "default"),
          confidence: state.routes.get(botId)?.confidence ?? 1,
        });
      }
      break;
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted":
      if (state.activeChainId === event.chainId) state.activeChainId = undefined;
      break;
    default:
      break;
  }
}

export function pendingApprovals(state: UiState): Approval[] {
  return [...state.approvals.values()].filter((a) => a.status === "pending");
}

export function heldMessages(state: UiState): Message[] {
  const held: Message[] = [];
  for (const messages of state.messagesByThread.values()) {
    for (const m of messages) {
      if (m.delivery === "held") held.push(m);
    }
  }
  return held.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
