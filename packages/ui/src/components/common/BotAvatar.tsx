import type { Bot } from "@openbot/contracts";
import { Blobatar } from "@blobatar/react";
import { thinking, unsure } from "blobatar/expression";
import "blobatar/motion.css";
import { Crown } from "lucide-react";

export type BotStatus = "idle" | "working" | "needs-you";

/** A stable color per Bot, from its id, so each teammate is recognizable at a glance. */
const HUES = [228, 262, 292, 330, 12, 32, 152, 176, 198];

export function botHue(bot: Pick<Bot, "id">): number {
  let hash = 0;
  for (const ch of bot.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length]!;
}

/** Mid, saturated tones: pale ones wash out on the dark theme. */
const BOT_LOOK = { traits: { tone: [0.45, 0.55, 0.65, 0.75] } };
/** The Chief of Staff wears the app's accent and a round body, recognizable in any list. */
const COS_LOOK = { hue: 285, traits: { shape: 0.11, tone: 0.6 } };

interface BotAvatarProps {
  bot: Pick<Bot, "id" | "name" | "avatar" | "isChiefOfStaff">;
  size?: number;
  status?: BotStatus;
  /**
   * `hover` (default) animates on pointer-over; `always` for a single, prominent
   * avatar (thread header, empty state). Static avatars render as one <img>.
   */
  motion?: "hover" | "always" | "none";
}

/**
 * Each Bot is a blobatar: a creature generated from its id (renaming keeps the
 * face), whose expression shows what it's doing — thinking while it works,
 * unsure while it waits for you.
 */
export function BotAvatar({ bot, size = 32, status, motion = "hover" }: BotAvatarProps) {
  const isEmoji = bot.avatar && /\p{Extended_Pictographic}/u.test(bot.avatar);
  if (isEmoji) {
    return (
      <span
        className="avatar avatar-emoji"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
        aria-hidden
      >
        {bot.avatar}
        {status && status !== "idle" ? (
          <span className="avatar-status" data-status={status} />
        ) : null}
      </span>
    );
  }

  const expression = status === "working" ? thinking : status === "needs-you" ? unsure : undefined;
  // A working Bot's eyes keep moving (the "thinking" pose), so it animates.
  const animate = status === "working" ? "always" : motion === "none" ? undefined : motion;

  return (
    <span className="avatar avatar-blob" style={{ width: size, height: size }} aria-hidden>
      {animate ? (
        <Blobatar
          name={bot.id}
          size={size}
          animate={animate}
          expression={expression}
          background="circle"
          {...(bot.isChiefOfStaff ? COS_LOOK : BOT_LOOK)}
        />
      ) : (
        <Blobatar
          name={bot.id}
          size={size}
          expression={expression}
          background="circle"
          {...(bot.isChiefOfStaff ? COS_LOOK : BOT_LOOK)}
        />
      )}
      {bot.isChiefOfStaff ? (
        <span className="avatar-crown">
          <Crown size={Math.max(8, Math.round(size * 0.3))} strokeWidth={2.4} />
        </span>
      ) : null}
      {status && status !== "idle" ? <span className="avatar-status" data-status={status} /> : null}
    </span>
  );
}
