import { framingKeyFor, fromBase64, randomScopeId } from "./native-crypto";
import { ApiError, MobileClient } from "./client";
import { clearCredentials, loadCredentials, loadEventCursor, saveEventCursor } from "./storage";
import type { ConnectionState } from "@/lib/connection-state";
import { advanceEventCursor, reconnectDelay } from "@/lib/connection-state";
import {
  keysForEvent,
  reduceDelegations,
  reduceFailures,
  reduceLiveText,
  type Delegations,
  type Failures,
  type LiveText,
} from "@/lib/live";
import { pairFromQr } from "./pair";
import { refreshPushToken } from "./push";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { OBEvent } from "@openbot/contracts";

interface ConnectionContextValue {
  state: ConnectionState;
  client?: MobileClient;
  events: OBEvent[];
  /** Text each Bot is streaming right now, keyed by Bot id. */
  live: LiveText;
  /** Tasks Bots handed to each other that are still open, keyed by delegation id. */
  delegations: Delegations;
  /** Why each Bot's latest turn failed (empty when the desktop gave no reason), keyed by Bot id. */
  failures: Failures;
  pair(qrUrl: string): Promise<void>;
  forget(): Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [state, setState] = useState<ConnectionState>({ status: "disconnected" });
  const [client, setClient] = useState<MobileClient>();
  const [events, setEvents] = useState<OBEvent[]>([]);
  const [live, setLive] = useState<LiveText>({});
  const [delegations, setDelegations] = useState<Delegations>({});
  const [failures, setFailures] = useState<Failures>({});
  const active = useRef(AppState.currentState === "active");
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lock = useRef(false);
  const cursor = useRef(0);
  const seen = useRef(new Set<number>());
  const currentClient = useRef<MobileClient | undefined>(undefined);
  const connectRef = useRef<() => Promise<void>>(async () => undefined);

  const scheduleReconnect = useCallback(() => {
    if (!active.current || timer.current) return;
    attempt.current += 1;
    const delay = reconnectDelay(attempt.current - 1);
    setState({ status: "reconnecting", attempt: attempt.current });
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void connectRef.current();
    }, delay);
  }, []);

  connectRef.current = async () => {
    if (!active.current || lock.current) return;
    lock.current = true;
    setState(
      attempt.current > 0
        ? { status: "reconnecting", attempt: attempt.current }
        : { status: "connecting", attempt: 0 },
    );
    let next: MobileClient | undefined;
    try {
      const credentials = await loadCredentials();
      if (!credentials) {
        setClient(undefined);
        setState({ status: "disconnected" });
        return;
      }
      const devicePrivateKey = fromBase64(credentials.devicePrivateKey);
      const key = await framingKeyFor(credentials.hostPub, devicePrivateKey);
      const sessionId = randomScopeId();
      next = new MobileClient(credentials, key, sessionId);
      currentClient.current?.close();
      currentClient.current = next;
      setClient(next);
      const health = await next.getHealth();
      if (!health.connected) throw new Error("OpenBot desktop is offline.");
      cursor.current = await loadEventCursor(credentials.deviceId);
      seen.current.clear();
      next.connectEvents(cursor.current, {
        onOpen: () => {
          attempt.current = 0;
          setState({ status: "connected", since: Date.now() });
          void queryClient.invalidateQueries({ queryKey: ["openbot"] });
          if (next) void refreshPushToken(next).catch(() => undefined);
        },
        onClose: () => {
          if (active.current && currentClient.current === next) scheduleReconnect();
        },
        onError: () => undefined,
        onEvent: (event) => {
          if (event.type === "device.revoked" && event.payload.deviceId === credentials.deviceId) {
            next?.close();
            currentClient.current = undefined;
            setClient(undefined);
            setState({ status: "revoked" });
            return;
          }
          cursor.current = advanceEventCursor(cursor.current, seen.current, event.seq);
          setLive((previous) => reduceLiveText(previous, event));
          setDelegations((previous) => reduceDelegations(previous, event));
          setFailures((previous) => reduceFailures(previous, event));
          if (event.type !== "message.delta") {
            setEvents((previous) =>
              [event, ...previous.filter((item) => item.id !== event.id)].slice(0, 30),
            );
            void saveEventCursor(credentials.deviceId, cursor.current);
          }
          for (const queryKey of keysForEvent(event.type)) {
            void queryClient.invalidateQueries({ queryKey });
          }
        },
      });
    } catch (error) {
      next?.close();
      if (currentClient.current === next) currentClient.current = undefined;
      setClient(undefined);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setState({ status: "revoked" });
      } else {
        scheduleReconnect();
      }
    } finally {
      lock.current = false;
    }
  };

  useEffect(() => {
    void connectRef.current();
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      const wasActive = active.current;
      active.current = next === "active";
      if (wasActive && !active.current) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = undefined;
        currentClient.current?.close();
        currentClient.current = undefined;
        setClient(undefined);
        setState({ status: "suspended" });
      } else if (!wasActive && active.current) {
        attempt.current = 0;
        void queryClient.invalidateQueries({ queryKey: ["openbot"] });
        void connectRef.current();
      }
    });
    return () => {
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
      currentClient.current?.close();
    };
  }, [queryClient]);

  const pair = useCallback(
    async (qrUrl: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
      setState({ status: "connecting", attempt: 0 });
      try {
        await pairFromQr(qrUrl);
        attempt.current = 0;
        await connectRef.current();
        router.replace("/(tabs)");
      } catch (error) {
        setState({ status: "disconnected" });
        throw error;
      }
    },
    [router],
  );

  const forget = useCallback(async () => {
    currentClient.current?.close();
    currentClient.current = undefined;
    setClient(undefined);
    attempt.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    await clearCredentials();
    setDelegations({});
    setFailures({});
    setState({ status: "disconnected" });
  }, []);

  return (
    <ConnectionContext.Provider
      value={{ state, client, events, live, delegations, failures, pair, forget }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) throw new Error("useConnection must be used inside ConnectionProvider");
  return context;
}
