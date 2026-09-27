import { z } from "zod";

/**
 * Structured questions a Bot asks the user (`ask_user`), answered in a form card
 * instead of free text. See `.ai/memory/plans/2026-09-27-user-inputs.md`.
 */
const FieldBase = {
  /** Stable key the Bot reads the answer by (snake_case). */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(200),
  help: z.string().max(500).optional(),
  required: z.boolean().default(false),
};

export const InputField = z.discriminatedUnion("type", [
  z.object({
    ...FieldBase,
    type: z.literal("text"),
    multiline: z.boolean().default(false),
    placeholder: z.string().max(200).optional(),
  }),
  z.object({
    ...FieldBase,
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    ...FieldBase,
    type: z.literal("choice"),
    options: z.array(z.string().min(1).max(200)).min(2).max(20),
    multiple: z.boolean().default(false),
    allowOther: z.boolean().default(false),
  }),
  z.object({ ...FieldBase, type: z.literal("confirm") }),
  z.object({ ...FieldBase, type: z.literal("date") }),
  /** The value goes to the vault; the Bot only ever sees a `secret:<id>` reference. */
  z.object({ ...FieldBase, type: z.literal("secret") }),
]);
export type InputField = z.infer<typeof InputField>;

export const InputRequestStatus = z.enum(["pending", "answered", "dismissed", "cancelled"]);
export type InputRequestStatus = z.infer<typeof InputRequestStatus>;

/** One answer: text/number/date/confirm/choice value, a list for multi-choice, or null if skipped. */
export const InputAnswer = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type InputAnswer = z.infer<typeof InputAnswer>;

export const InputRequest = z.object({
  id: z.string(),
  botId: z.string(),
  threadId: z.string(),
  chainId: z.string().optional(),
  title: z.string().min(1).max(200),
  intro: z.string().max(2000).optional(),
  fields: z.array(InputField).min(1).max(20),
  status: InputRequestStatus,
  /** Secrets are stored as `secret:<vault key>`, never as the value. */
  answers: z.record(z.string(), InputAnswer).optional(),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
});
export type InputRequest = z.infer<typeof InputRequest>;

export const AnswerInputBody = z.object({
  answers: z.record(z.string(), InputAnswer),
});
export type AnswerInputBody = z.infer<typeof AnswerInputBody>;
