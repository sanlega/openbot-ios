import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Approval, Bot, InputRequest, Message } from "@openbot/contracts";
import type { RoutePreview, ThreadView } from "../api/types.js";
import { createTransport, type Transport } from "../transport/index.js";
import { createInitialState, pendingApprovals, uiReducer, type UiState } from "./reducer.js";

export interface OpenBotProviderProps {
  transport: Transport;
  children: ReactNode;
}

interface OpenBotContextValue {
  transport: Transport;
  state: UiState;
  bots: Bot[];
  threads: ThreadView[];
  pendingApprovals: Approval[];
  messagesForThread: (threadId: string) => Message[];
  refresh: () => Promise<void>;
  selectThread: (threadId: string | null) => void;
  selectedThreadId: string | null;
  sendMessage: (text: string) => Promise<void>;
  resolveApproval: (approvalId: string, resolution: "allow" | "deny") => void;
  routeForBot: (botId: string) => RoutePreview | undefined;
  streamingText: (messageId: string) => string | undefined;
}

/** The route chip before any turn: the Bot's pin, or "auto" (Jev decides per turn). */
function routePreview(routing: Bot["routing"]): RoutePreview {
  const pinned = routing.mode === "pinned";
  return {
    engine: routing.engine ?? "auto",
    model: routing.model ?? "auto",
    effort: routing.effort,
    confidence: pinned ? 1 : 0,
  };
}

const OpenBotContext = createContext<OpenBotContextValue | null>(null);

export function OpenBotProvider({ transport, children }: OpenBotProviderProps) {
  const [state, dispatch] = useReducer(uiReducer, undefined, () => createInitialState());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const wsRef = useRef<ReturnType<Transport["connectWebSocket"]> | null>(null);
  const lastSeqRef = useRef(0);

  const hydrate = useCallback(async () => {
    const [botsRes, threadsRes, apprRes, inputsRes] = await Promise.all([
      transport.get<{ bots: Bot[] }>("/api/bots"),
      transport.get<{ threads: ThreadView[] }>("/api/threads"),
      transport.get<{ approvals: Approval[] }>("/api/approvals"),
      transport
        .get<{ inputs: InputRequest[] }>("/api/inputs")
        .catch(() => ({ inputs: [] as InputRequest[] })),
    ]);

    const messages: Message[] = [];
    const routes: Record<string, RoutePreview> = {};
    for (const thread of threadsRes.threads) {
      const [msgRes, route] = await Promise.all([
        transport.get<{ messages: Message[] }>(`/api/threads/${thread.id}/messages`),
        transport.get<{ routing: Bot["routing"] }>(`/api/bots/${thread.botId}/route`),
      ]);
      messages.push(...msgRes.messages);
      routes[thread.botId] = routePreview(route.routing);
    }

    dispatch({
      type: "hydrate",
      bots: botsRes.bots,
      threads: threadsRes.threads,
      messages,
      approvals: apprRes.approvals,
      routes,
      inputs: inputsRes.inputs,
    });

    setSelectedThreadId((current) => current ?? threadsRes.threads[0]?.id ?? null);
  }, [transport]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    lastSeqRef.current = state.lastSeq;
  }, [state.lastSeq]);

  useEffect(() => {
    let cancelled = false;
    const conn = transport.connectWebSocket((msg) => {
      if (cancelled) return;
      if (msg.type === "event" && msg.event) {
        dispatch({ type: "event", event: msg.event });
        // The roster lists threads, and a new Bot's DM thread has no event of its own.
        if (msg.event.type === "bot.created") void hydrate();
      }
      if (msg.type === "replay.done") {
        dispatch({ type: "ws.replay.done" });
      }
    });
    wsRef.current = conn;
    dispatch({ type: "ws.connected" });
    conn.subscribe(lastSeqRef.current);

    return () => {
      cancelled = true;
      conn.close();
      wsRef.current = null;
    };
  }, [transport, hydrate]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!selectedThreadId) return;
      const botId = state.threads.get(selectedThreadId)?.botId;
      if (!botId) return;
      wsRef.current?.send({
        command: "message.send",
        payload: { botId, threadId: selectedThreadId, text },
      });
    },
    [selectedThreadId, state.threads],
  );

  const resolveApproval = useCallback((approvalId: string, resolution: "allow" | "deny") => {
    wsRef.current?.send({
      command: "approval.resolve",
      payload: { id: approvalId, resolution },
    });
  }, []);

  const messagesForThread = useCallback(
    (threadId: string) => state.messagesByThread.get(threadId) ?? [],
    [state.messagesByThread],
  );

  const value = useMemo<OpenBotContextValue>(
    () => ({
      transport,
      state,
      bots: [...state.bots.values()],
      threads: [...state.threads.values()],
      pendingApprovals: pendingApprovals(state),
      messagesForThread,
      refresh: hydrate,
      selectThread: setSelectedThreadId,
      selectedThreadId,
      sendMessage,
      resolveApproval,
      routeForBot: (botId) => state.routes.get(botId),
      streamingText: (messageId) => state.streamingDeltas.get(messageId),
    }),
    [transport, state, messagesForThread, hydrate, selectedThreadId, sendMessage, resolveApproval],
  );

  return <OpenBotContext.Provider value={value}>{children}</OpenBotContext.Provider>;
}

export function useOpenBot(): OpenBotContextValue {
  const ctx = useContext(OpenBotContext);
  if (!ctx) throw new Error("useOpenBot must be used within OpenBotProvider");
  return ctx;
}

/** For components that also render outside the provider (e.g. in isolation tests). */
export function useOptionalOpenBot(): OpenBotContextValue | null {
  return useContext(OpenBotContext);
}

export function useLocalTransport(baseUrl: string): Transport {
  return useMemo(() => createTransport({ baseUrl, mode: "local" }), [baseUrl]);
}
