import type { Bot, DecisionService, JevAnswer } from "@openbot/contracts";
import { buildTriageQuestions, buildDecisionState, markUntrusted } from "@openbot/decisions";
import type { PipelineAction } from "./types.js";

function noul(answers: Record<string, JevAnswer>, id: string): number {
  const a = answers[id];
  if (a?.type === "noul") return a.noul;
  return 0;
}

function choice(answers: Record<string, JevAnswer>, id: string): string {
  const a = answers[id];
  if (a?.type === "choice") return a.choice;
  return "";
}

export interface InboundPipelineContext {
  message: string;
  roster: Bot[];
  /** Pre-fetched DB answers for status lookups (bot list, routine status, etc.). */
  dbSnapshot?: Record<string, unknown>;
}

export interface InboundPipelineOptions {
  decisions: DecisionService;
}

/**
 * CoS inbound pipeline (plan WS8): triage → DB answer, delegate hint, or wake CoS.
 */
export class CosInboundPipeline {
  private readonly decisions: DecisionService;

  constructor(options: InboundPipelineOptions) {
    this.decisions = options.decisions;
  }

  async triage(ctx: InboundPipelineContext): Promise<PipelineAction> {
    const state = buildDecisionState({
      message: markUntrusted(ctx.message),
      roster: ctx.roster.map((b) => ({ slug: b.slug, name: b.name, description: b.description })),
      db_snapshot: ctx.dbSnapshot,
    });

    const result = await this.decisions.decide({
      purpose: "triage",
      state,
      questions: buildTriageQuestions(),
    });

    const intent = choice(result.answers, "intent");
    const needsEngine = noul(result.answers, "needs_engine");
    const existingCanDo = noul(result.answers, "existing_can_do");

    if (intent === "status_lookup" && needsEngine < 0.5) {
      const reply = this.formatDbAnswer(ctx);
      if (reply) return { action: "answer_from_db", reply };
    }

    if (intent === "chit_chat" && needsEngine < 0.3) {
      return { action: "stop" };
    }

    if (existingCanDo >= 0.7) {
      const delegateBot = this.pickDelegateBot(ctx.roster, ctx.message);
      if (delegateBot) {
        return { action: "delegate", botId: delegateBot.id, hint: ctx.message };
      }
    }

    return { action: "wake_cos", reason: intent };
  }

  private formatDbAnswer(ctx: InboundPipelineContext): string | null {
    if (!ctx.dbSnapshot) return null;
    const bots = ctx.roster.filter((b) => !b.archivedAt);
    const lines = bots.map((b) => `${b.name}: ${b.description}`);
    return `Current roster (${bots.length} bots):\n${lines.join("\n")}`;
  }

  private pickDelegateBot(roster: Bot[], message: string): Bot | undefined {
    const active = roster.filter((b) => !b.archivedAt && !b.isChiefOfStaff);
    const lower = message.toLowerCase();
    return active.find((b) => {
      const desc = b.description.toLowerCase();
      const name = b.name.toLowerCase();
      return (
        lower.includes(name) || desc.split(/\s+/).some((w) => w.length > 4 && lower.includes(w))
      );
    });
  }
}
