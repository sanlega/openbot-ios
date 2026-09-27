import { newId, type Message } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { DigestService, type AutonomyCaps, type DigestEntry } from "@openbot/cos";

const DIGEST_KEY_PREFIX = "digest:";

function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The daily digest (plan WS8, M2 "the daily digest lists what was held"): at
 * the digest hour (local time), the Chief of Staff posts one message listing
 * what was held, routine results, and idle CoS-created Bots since the previous
 * digest. Everything is read from the store, so nothing is lost on restart and
 * the digest is posted at most once per day. Returns the posted message.
 */
export async function postDigestIfDue(
  ctx: CoreContext,
  caps: AutonomyCaps,
  options: { force?: boolean } = {},
): Promise<Message | undefined> {
  const now = ctx.clock.now();
  if (!options.force && now.getHours() !== caps.digestHour) return undefined;

  const bots = ctx.repos.bots.list({ includeHidden: true });
  const cos = bots.find((b) => b.isChiefOfStaff);
  const thread = cos ? ctx.repos.threads.getByBotId(cos.id) : undefined;
  if (!cos || !thread) return undefined;

  const dedupeKey = `${DIGEST_KEY_PREFIX}${localDateKey(now)}`;
  const cosMessages = ctx.repos.messages.list({ threadId: thread.id, limit: 500 });
  if (cosMessages.some((m) => m.dedupeKey === dedupeKey)) return undefined;
  const previous = cosMessages.find((m) => m.dedupeKey?.startsWith(DIGEST_KEY_PREFIX));
  const since = previous ? new Date(previous.createdAt) : new Date(now.getTime() - 86_400_000);
  const after = (iso?: string) => Boolean(iso) && new Date(iso!).getTime() > since.getTime();
  const nameOf = (botId?: string) => bots.find((b) => b.id === botId)?.name;

  const entries: DigestEntry[] = [];
  for (const m of ctx.repos.messages.list({ delivery: "held", limit: 500 })) {
    if (!m.proactive || !after(m.createdAt)) continue;
    const botId = m.author.type === "bot" ? m.author.id : undefined;
    entries.push({
      kind: "held_message",
      summary: m.text.slice(0, 140),
      botId,
      botName: nameOf(botId),
      at: new Date(m.createdAt),
    });
  }
  for (const routine of ctx.repos.routines.list()) {
    for (const run of ctx.repos.routineRuns.listByRoutine(routine.id)) {
      if (run.dryRun || !after(run.endedAt)) continue;
      entries.push({
        kind: "routine_result",
        summary: `${routine.name} (${run.status}): ${run.resultSummary ?? ""}`.trim(),
        botId: routine.botId,
        botName: nameOf(routine.botId),
        at: new Date(run.endedAt!),
      });
    }
  }

  const service = new DigestService({ clock: ctx.clock, onDigest: () => {} });
  const idle = DigestService.archiveCandidates(bots, caps.idleBotReviewDays, now);
  const message: Message = {
    id: newId("message"),
    threadId: thread.id,
    author: { type: "bot", id: cos.id },
    text: service.render(entries, idle),
    attachments: [],
    hop: 0,
    createdAt: now.toISOString(),
    proactive: true,
    kind: "result",
    dedupeKey,
    delivery: "delivered",
    pushed: false,
  };
  ctx.repos.messages.create(message);
  await ctx.eventBus.publish({
    type: "message.created",
    botId: cos.id,
    threadId: thread.id,
    payload: {
      messageId: message.id,
      text: message.text,
      author: "bot",
      proactive: true,
      delivery: "delivered",
      dedupeKey,
    },
  });
  await ctx.eventBus.publish({
    type: "digest.posted",
    botId: cos.id,
    threadId: thread.id,
    payload: { messageId: message.id, body: message.text, entries: entries.length },
  });
  return message;
}
