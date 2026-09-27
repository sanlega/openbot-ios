import type { FastifyReply } from "fastify";
import type { z } from "zod";

/** Parses `input` against `schema`; on failure, sends a 400 with zod's issues and returns `undefined`. */
export function parseOrReject<T>(schema: z.ZodType<T>, input: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(input);
  if (!result.success) {
    reply.code(400).send({ error: "invalid_request", issues: result.error.issues });
    return undefined;
  }
  return result.data;
}
