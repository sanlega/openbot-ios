import type { Bot } from "@openbot/contracts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useConnection } from "@/connection/ConnectionProvider";
import { botNamer, botStatus, type BotStatus } from "./format";

function useClientQuery<T>(
  key: string[],
  fetcher: (client: NonNullable<ReturnType<typeof useConnection>["client"]>) => Promise<T>,
) {
  const { client } = useConnection();
  return useQuery({
    queryKey: ["openbot", ...key],
    queryFn: () => fetcher(client!),
    enabled: !!client,
  });
}

export const useBots = () => useClientQuery(["bots"], (c) => c.getBots());
export const useThreads = () => useClientQuery(["threads"], (c) => c.getThreads());
export const useApprovals = () => useClientQuery(["approvals"], (c) => c.getApprovals("pending"));
export const useInputs = () => useClientQuery(["inputs"], (c) => c.getInputs("pending"));
export const useActivity = () => useClientQuery(["activity"], (c) => c.getActivity());
export const useHealth = () => useClientQuery(["health"], (c) => c.getHealth());
export const useRoutines = () => useClientQuery(["routines"], (c) => c.getRoutines());
export const useMessages = (threadId: string | undefined) =>
  useClientQuery(["messages", threadId ?? ""], (c) =>
    threadId ? c.getMessages(threadId) : Promise.resolve({ messages: [] }),
  );

/** Visible Bots, pinned and Chief of Staff first. */
export function useRoster(): { bots: Bot[]; isLoading: boolean } {
  const bots = useBots();
  const list = useMemo(
    () =>
      (bots.data?.bots ?? [])
        .filter((bot) => !bot.hidden && !bot.archivedAt)
        .sort(
          (a, b) =>
            Number(b.isChiefOfStaff) - Number(a.isChiefOfStaff) ||
            Number(b.pinned) - Number(a.pinned) ||
            (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
        ),
    [bots.data],
  );
  return { bots: list, isLoading: bots.isLoading };
}

export function useNamer() {
  const bots = useBots();
  return useMemo(() => botNamer(bots.data?.bots ?? []), [bots.data]);
}

/** Each Bot's current status from its latest turn and what waits on the user. */
export function useBotStatuses(bots: Bot[]): Record<string, BotStatus> {
  const { client } = useConnection();
  const approvals = useApprovals();
  const inputs = useInputs();
  const turns = useQueries({
    queries: bots.map((bot) => ({
      queryKey: ["openbot", "turns", bot.id],
      queryFn: () => client!.getBotTurns(bot.id),
      enabled: !!client,
    })),
  });
  const statuses: Record<string, BotStatus> = {};
  bots.forEach((bot, index) => {
    const needsYou =
      !!approvals.data?.approvals.some((item) => item.botId === bot.id) ||
      !!inputs.data?.inputs.some((item) => item.botId === bot.id);
    statuses[bot.id] = botStatus(turns[index]?.data?.turns.at(-1), needsYou);
  });
  return statuses;
}

/** Pull-to-refresh state that refetches every OpenBot query. */
export function useRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void queryClient
      .invalidateQueries({ queryKey: ["openbot"] })
      .finally(() => setRefreshing(false));
  }, [queryClient]);
  return { refreshing, onRefresh };
}
