import { z } from "zod";

/**
 * Wire contract for TypeSafe AI's System One model ("Jev"), confirmed live against
 * `api.typesafe.ai` (see `internal/jev-spike.md` in the project's shared store, and
 * the sanitized fixtures under `packages/decisions/fixtures/jev/`). `fake-jev`
 * (this package's `fakeJev` server) implements exactly this contract so
 * `DecisionService` and its callers (WS2, WS8, WS9, WS12) never need a real key in
 * tests or CI.
 */

export const JevQuestionType = z.enum(["choice", "score", "noul"]);
export type JevQuestionType = z.infer<typeof JevQuestionType>;

/**
 * `choice`: `criteria` is a map of option name -> description. `score`: `criteria`
 * is an ORDERED array of level descriptions (index 0 = lowest). `noul`: a yes/no
 * probability; `criteria` is optional (observed both with and without it live).
 */
export const JevChoiceQuestion = z.object({
  type: z.literal("choice"),
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()),
});
export type JevChoiceQuestion = z.infer<typeof JevChoiceQuestion>;

export const JevScoreQuestion = z.object({
  type: z.literal("score"),
  instructions: z.string(),
  criteria: z.array(z.string()).min(2),
});
export type JevScoreQuestion = z.infer<typeof JevScoreQuestion>;

export const JevNoulQuestion = z.object({
  type: z.literal("noul"),
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()).optional(),
});
export type JevNoulQuestion = z.infer<typeof JevNoulQuestion>;

export const JevQuestion = z.discriminatedUnion("type", [
  JevChoiceQuestion,
  JevScoreQuestion,
  JevNoulQuestion,
]);
export type JevQuestion = z.infer<typeof JevQuestion>;

/** `state` can be a plain string or any JSON value — confirmed both work live. */
export const JevState = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);
export type JevState = z.infer<typeof JevState>;

export const JevRequest = z.object({
  model: z.string(),
  state: JevState,
  questions: z.record(z.string(), JevQuestion),
});
export type JevRequest = z.infer<typeof JevRequest>;

/**
 * Choice/score answers always carry `confidence` (0-1, distinct from
 * `probabilities`); **noul answers never carry `confidence`** — this is a
 * confirmed API invariant (jev-spike §3.3, §7.4), not an omission. `band()` must
 * branch on answer type, not assume every answer has `confidence`.
 */
export const JevChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
});
export type JevChoiceAnswer = z.infer<typeof JevChoiceAnswer>;

export const JevScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  /** Keyed by string index into the request's `criteria` array, e.g. `"0"`..`"3"`. */
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
});
export type JevScoreAnswer = z.infer<typeof JevScoreAnswer>;

export const JevNoulAnswer = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});
export type JevNoulAnswer = z.infer<typeof JevNoulAnswer>;

export const JevAnswer = z.discriminatedUnion("type", [
  JevChoiceAnswer,
  JevScoreAnswer,
  JevNoulAnswer,
]);
export type JevAnswer = z.infer<typeof JevAnswer>;

export const JevUsage = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type JevUsage = z.infer<typeof JevUsage>;

export const JevResponse = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevAnswer),
  usage: JevUsage,
});
export type JevResponse = z.infer<typeof JevResponse>;

export const JevModel = z.object({
  name: z.string(),
  description: z.string(),
  release_date: z.string(),
});
export type JevModel = z.infer<typeof JevModel>;

export const JevModelsResponse = z.object({
  models: z.array(JevModel),
});
export type JevModelsResponse = z.infer<typeof JevModelsResponse>;

/**
 * Error body shape is INCONSISTENT between status codes (a real, confirmed
 * gotcha — jev-spike §7.1): `422` is a FastAPI/Pydantic validation-error ARRAY;
 * `401` (and other auth/API errors) is a single OBJECT. Code that assumes one
 * shape for all 4xx bodies will crash on the other. Always branch on
 * `Array.isArray(body.detail)` (or on HTTP status first) before reading `.message`
 * vs indexing `[0]`.
 */
export const JevValidationErrorDetail = z.object({
  type: z.string(),
  loc: z.array(z.union([z.string(), z.number()])),
  msg: z.string(),
  input: z.unknown().optional(),
});
export type JevValidationErrorDetail = z.infer<typeof JevValidationErrorDetail>;

export const JevValidationErrorBody = z.object({
  detail: z.array(JevValidationErrorDetail),
});
export type JevValidationErrorBody = z.infer<typeof JevValidationErrorBody>;

export const JevApiErrorBody = z.object({
  detail: z.object({
    error_type: z.string(),
    message: z.string(),
  }),
});
export type JevApiErrorBody = z.infer<typeof JevApiErrorBody>;

export const JevErrorBody = z.union([JevValidationErrorBody, JevApiErrorBody]);
export type JevErrorBody = z.infer<typeof JevErrorBody>;

/** Header present on every real Jev call (success or error) — the only per-call support-correlation handle Jev returns. Log it on every `Decision` row. */
export const JEV_REQUEST_ID_HEADER = "x-typesafe-request-id";

export function isValidationErrorBody(body: unknown): body is JevValidationErrorBody {
  return JevValidationErrorBody.safeParse(body).success;
}

export function isApiErrorBody(body: unknown): body is JevApiErrorBody {
  return JevApiErrorBody.safeParse(body).success;
}
