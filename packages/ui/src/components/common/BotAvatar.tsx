import type { Bot } from "@openbot/contracts";
import { Crown } from "lucide-react";

export type BotStatus = "idle" | "working" | "needs-you";

/** A stable color per Bot, from its id, so each teammate is recognizable at a glance. */
const HUES = [228, 262, 292, 330, 12, 32, 152, 176, 198];

export function botHue(bot: Pick<Bot, "id">): number {
  let hash = 0;
  for (const ch of bot.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length]!;
}

interface BotAvatarProps {
  bot: Pick<Bot, "id" | "name" | "avatar" | "isChiefOfStaff">;
  size?: number;
  status?: BotStatus;
}

export function BotAvatar({ bot, size = 32, status }: BotAvatarProps) {
  const hue = botHue(bot);
  const initials = bot.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const isEmoji = bot.avatar && /\p{Extended_Pictographic}/u.test(bot.avatar);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: bot.isChiefOfStaff
          ? "linear-gradient(135deg, #8b7bff, #5a48e6)"
          : `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${hue + 18} 64% 48%))`,
      }}
      aria-hidden
    >
      {isEmoji ? (
        bot.avatar
      ) : bot.isChiefOfStaff ? (
        <Crown size={Math.round(size * 0.5)} strokeWidth={2.2} />
      ) : (
        initials || "?"
      )}
      {status && status !== "idle" ? <span className="avatar-status" data-status={status} /> : null}
    </span>
  );
}
