import type { FastifyInstance } from "fastify";
import {
  AnswerInputBody,
  InputRequestStatus,
  type InputAnswer,
  type InputField,
  type InputRequest,
} from "@openbot/contracts";
import type { CoreContext } from "../../context.js";
import { delegationsOf } from "../../delegations.js";
import { requireAuth } from "../auth.js";
import { parseOrReject } from "../validation.js";

/**
 * `ask_user` forms: list, answer, dismiss. Answers go back to the Bot as a new
 * user turn; secret answers go to the vault and the Bot only sees a reference.
 */
export function registerInputRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/inputs", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const query = request.query as { status?: string; botId?: string };
    const status = InputRequestStatus.safeParse(query.status);
    return {
      inputs: ctx.repos.inputRequests.list({
        status: status.success ? status.data : undefined,
        botId: query.botId,
      }),
    };
  });

  app.get("/api/inputs/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const input = ctx.repos.inputRequests.getById(id);
    if (!input) return reply.code(404).send({ error: "not_found" });
    return { input };
  });

  app.post("/api/inputs/:id/answer", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const input = ctx.repos.inputRequests.getById(id);
    if (!input) return reply.code(404).send({ error: "not_found" });
    if (input.status !== "pending") {
      return reply.code(409).send({ error: "already_resolved", input });
    }
    const body = parseOrReject(AnswerInputBody, request.body, reply);
    if (!body) return;

    const checked = checkAnswers(input.fields, body.answers);
    if ("error" in checked) return reply.code(400).send({ error: checked.error });

    // Secrets never reach the store, the event log, or the Bot's turn.
    const stored: Record<string, InputAnswer> = {};
    for (const field of input.fields) {
      const value = checked.answers[field.id] ?? null;
      if (field.type === "secret" && typeof value === "string" && value) {
        const key = `input.${input.id}.${field.id}`;
        await ctx.vault.set(key, value);
        stored[field.id] = `secret:${key}`;
      } else {
        stored[field.id] = value;
      }
    }

    if (!ctx.repos.inputRequests.resolve(id, "answered", ctx.clock.now(), stored)) {
      return reply.code(409).send({ error: "already_resolved" });
    }
    await ctx.eventBus.publish({
      type: "input.answered",
      botId: input.botId,
      threadId: input.threadId,
      chainId: input.chainId,
      payload: { requestId: id },
    });
    const turn = await ctx.mailbox?.enqueue({
      botId: input.botId,
      chainId: input.chainId,
      text: answersMessage(input, stored),
      delegationId: await resumeDelegation(ctx, input),
    });
    return { input: ctx.repos.inputRequests.getById(id), turn };
  });

  app.post("/api/inputs/:id/dismiss", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const input = ctx.repos.inputRequests.getById(id);
    if (!input) return reply.code(404).send({ error: "not_found" });
    if (!ctx.repos.inputRequests.resolve(id, "dismissed", ctx.clock.now())) {
      return reply.code(409).send({ error: "already_resolved", input });
    }
    await ctx.eventBus.publish({
      type: "input.dismissed",
      botId: input.botId,
      threadId: input.threadId,
      chainId: input.chainId,
      payload: { requestId: id },
    });
    const turn = await ctx.mailbox?.enqueue({
      botId: input.botId,
      chainId: input.chainId,
      text: `I dismissed your form "${input.title}" without answering it.`,
      delegationId: await resumeDelegation(ctx, input),
    });
    return { input: ctx.repos.inputRequests.getById(id), turn };
  });
}

/** A form a delegated worker asked (shown in its requester's thread): its task is back to work. */
async function resumeDelegation(
  ctx: CoreContext,
  input: InputRequest,
): Promise<string | undefined> {
  const tracker = delegationsOf(ctx);
  const open = tracker.openInThread(input.botId, input.threadId);
  if (!open) return undefined;
  await tracker.resume(open.id);
  tracker.expectTurn(open.id);
  return open.id;
}

function checkAnswers(
  fields: InputField[],
  answers: Record<string, InputAnswer>,
): { answers: Record<string, InputAnswer> } | { error: string } {
  const out: Record<string, InputAnswer> = {};
  for (const field of fields) {
    const raw = answers[field.id];
    const empty =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim() === "") ||
      (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (field.required) return { error: `"${field.label}" is required` };
      out[field.id] = null;
      continue;
    }
    switch (field.type) {
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return { error: `"${field.label}" must be a number` };
        if (field.min !== undefined && n < field.min)
          return { error: `"${field.label}" is too small` };
        if (field.max !== undefined && n > field.max)
          return { error: `"${field.label}" is too large` };
        out[field.id] = n;
        break;
      }
      case "confirm":
        if (typeof raw !== "boolean") return { error: `"${field.label}" must be yes or no` };
        out[field.id] = raw;
        break;
      case "choice": {
        const values = Array.isArray(raw) ? raw : [raw];
        if (!field.multiple && values.length > 1) {
          return { error: `"${field.label}" takes one option` };
        }
        for (const v of values) {
          if (typeof v !== "string" || (!field.allowOther && !field.options.includes(v))) {
            return { error: `"${field.label}" has an unknown option` };
          }
        }
        out[field.id] = field.multiple ? (values as string[]) : (values[0] as string);
        break;
      }
      case "date":
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
          return { error: `"${field.label}" must be a date` };
        }
        out[field.id] = raw;
        break;
      default:
        if (typeof raw !== "string") return { error: `"${field.label}" must be text` };
        out[field.id] = raw.trim();
    }
  }
  return { answers: out };
}

/** The user's reply as the Bot reads it: one line per field, keyed by id. */
function answersMessage(input: InputRequest, answers: Record<string, InputAnswer>): string {
  const lines = input.fields.map((field) => {
    const value = answers[field.id];
    const shown =
      value === null || value === undefined
        ? "(not answered)"
        : field.type === "secret"
          ? `stored securely as ${String(value)}`
          : Array.isArray(value)
            ? value.join(", ")
            : typeof value === "boolean"
              ? value
                ? "yes"
                : "no"
              : String(value);
    return `- ${field.label} (${field.id}): ${shown}`;
  });
  return `My answers to "${input.title}":\n${lines.join("\n")}`;
}
