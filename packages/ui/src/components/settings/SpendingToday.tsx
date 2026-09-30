import { useEffect, useState } from "react";
import type { Turn } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { BotAvatar } from "../common/BotAvatar.js";
import { SettingRow, SettingsGroup } from "./SettingsPrimitives.js";

/** What each Bot has spent today, next to its daily limit. */
export function SpendingToday() {
  const { transport, bots } = useOpenBot();
  const [spent, setSpent] = useState<Record<string, number> | null>(null);
  const active = bots.filter((b) => !b.archivedAt);
  const ids = active.map((b) => b.id).join(",");

  useEffect(() => {
    let cancelled = false;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    void Promise.all(
      active.map(async (bot) => {
        const res = await transport
          .get<{ turns: Turn[] }>(`/api/usage?botId=${encodeURIComponent(bot.id)}`)
          .catch(() => ({ turns: [] as Turn[] }));
        const today = res.turns
          .filter((t) => new Date(t.createdAt) >= startOfDay)
          .reduce((sum, t) => sum + (t.usage.usd ?? 0), 0);
        return [bot.id, today] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setSpent(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // `ids` stands in for the bot list, which is rebuilt every render.
  }, [transport, ids]);

  if (active.length === 0) return null;
  return (
    <SettingsGroup title="Today">
      {active.map((bot) => {
        const usd = spent?.[bot.id];
        const limit = bot.limits?.dailyUsd;
        return (
          <SettingRow
            key={bot.id}
            leading={<BotAvatar bot={bot} size={28} motion="none" />}
            label={bot.name}
            help={
              limit !== undefined
                ? `Limit $${limit.toFixed(2)} a day. Change it in the bot's profile.`
                : "No daily limit. Set one in the bot's profile."
            }
          >
            <span
              className="spend-today"
              data-over={limit !== undefined && usd !== undefined && usd >= limit}
            >
              {usd === undefined ? "…" : `$${usd.toFixed(2)}`}
            </span>
          </SettingRow>
        );
      })}
    </SettingsGroup>
  );
}
