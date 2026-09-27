import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { monotonicFactory } from "ulid";
import {
  JEV_REQUEST_ID_HEADER,
  type JevAnswer,
  type JevModel,
  type JevQuestion,
  type JevResponse,
} from "@openbot/contracts";
import { synthesizeAnswer } from "./answer-synthesis.js";

const ulid = monotonicFactory();

interface JevValidationDetail {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
}

export interface FakeJevOptions {
  /** If set, `POST /v1/systemone` and `GET /v1/models` require `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  models?: JevModel[];
}

const DEFAULT_MODELS: JevModel[] = [
  {
    name: "jev-latest",
    description: "The latest iteration of TypeSafe's System One Model: Jev",
    release_date: new Date(0).toISOString(),
  },
  {
    name: "jev-preview",
    description: "A preview version of `jev-latest`: should be better in most ways",
    release_date: new Date(0).toISOString(),
  },
];

/**
 * A real HTTP server implementing exactly the Jev wire contract (plan §5 WS0
 * fakes list: "`fake-jev` (`/v1/systemone` and `/v1/models`, with scriptable
 * answers and injectable 429 responses)"), seeded from the sanitized fixtures
 * in `fixtures/jev/`. `DecisionService` implementations (WS7) and any other
 * workstream's tests point at this instead of `https://api.typesafe.ai`.
 *
 * Reproduces every gotcha confirmed live (jev-spike §7): `422` bodies are a
 * validation-error ARRAY, `401`/other API errors are a single OBJECT, `noul`
 * answers never carry `confidence`, and every response (success or error)
 * carries an `x-typesafe-request-id` header.
 */
export class FakeJevServer {
  private server: Server | undefined;
  private readonly apiKey?: string;
  private readonly models: JevModel[];
  private rateLimitRemaining = 0;
  /** Per-question-id canned answers, checked before falling back to deterministic synthesis. */
  readonly scriptedAnswers: Record<string, JevAnswer> = {};

  constructor(options: FakeJevOptions = {}) {
    this.apiKey = options.apiKey;
    this.models = options.models ?? DEFAULT_MODELS;
  }

  /** The next `count` `POST /v1/systemone` calls return `429` instead of being answered. */
  scheduleRateLimit(count: number): void {
    this.rateLimitRemaining = count;
  }

  async listen(port = 0): Promise<{ url: string; port: number }> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => {
      this.server?.listen(port, "127.0.0.1", resolve);
    });
    const address = this.server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${address.port}`, port: address.port };
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader(JEV_REQUEST_ID_HEADER, `req_${ulid()}`);

    if (this.apiKey) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${this.apiKey}`) {
        this.sendJson(res, 401, {
          detail: {
            error_type: "authentication_error",
            message:
              "Cannot authenticate with the server. Please check your API key and try again.",
          },
        });
        return;
      }
    }

    if (req.method === "GET" && req.url === "/v1/models") {
      this.sendJson(res, 200, { models: this.models });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/systemone") {
      this.readBody(req)
        .then((raw) => this.handleSystemOne(raw, res))
        .catch((err: unknown) => {
          this.sendJson(res, 500, {
            detail: { error_type: "internal_error", message: String(err) },
          });
        });
      return;
    }

    res.statusCode = 404;
    res.end();
  }

  private handleSystemOne(rawBody: string, res: ServerResponse): void {
    if (this.rateLimitRemaining > 0) {
      this.rateLimitRemaining -= 1;
      res.setHeader("Retry-After", "1");
      this.sendJson(res, 429, {
        detail: {
          error_type: "rate_limit_error",
          message: "Rate limit exceeded, please retry later.",
        },
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      this.sendJson(res, 422, {
        detail: [{ type: "json_invalid", loc: ["body"], msg: "Invalid JSON body" }],
      });
      return;
    }

    const errors = validateSystemOneRequest(parsed);
    if (errors.length > 0) {
      this.sendJson(res, 422, { detail: errors });
      return;
    }

    const body = parsed as { model: string; questions: Record<string, JevQuestion> };
    const answers: Record<string, JevAnswer> = {};
    let inputChars = 0;
    for (const [questionId, question] of Object.entries(body.questions)) {
      inputChars += JSON.stringify(question).length;
      answers[questionId] = this.scriptedAnswers[questionId] ?? synthesizeAnswer(question);
    }

    const response: JevResponse = {
      model: body.model,
      answers,
      usage: {
        input_tokens: Math.max(1, Math.round(inputChars / 4)),
        output_tokens: Object.keys(answers).length * 20,
      },
    };
    this.sendJson(res, 200, response);
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
}

function validateSystemOneRequest(body: unknown): JevValidationDetail[] {
  if (typeof body !== "object" || body === null) {
    return [{ type: "type_error", loc: ["body"], msg: "value is not a valid dict" }];
  }
  const obj = body as Record<string, unknown>;
  const errors: JevValidationDetail[] = [];

  if (typeof obj.model !== "string") {
    errors.push({ type: "missing", loc: ["body", "model"], msg: "Field required" });
  }
  if (obj.state === undefined) {
    errors.push({ type: "missing", loc: ["body", "state"], msg: "Field required" });
  }

  const questions = obj.questions;
  if (typeof questions !== "object" || questions === null) {
    errors.push({ type: "missing", loc: ["body", "questions"], msg: "Field required" });
    return errors;
  }

  for (const [questionId, rawQuestion] of Object.entries(questions as Record<string, unknown>)) {
    if (typeof rawQuestion !== "object" || rawQuestion === null) {
      errors.push({
        type: "type_error",
        loc: ["body", "questions", questionId],
        msg: "value is not a valid dict",
      });
      continue;
    }
    const question = rawQuestion as Record<string, unknown>;
    if (
      question.type === "choice" &&
      (typeof question.criteria !== "object" || question.criteria === null)
    ) {
      errors.push({
        type: "missing",
        loc: ["body", "questions", questionId, "choice", "criteria"],
        msg: "Field required",
        input: question,
      });
    } else if (question.type === "score" && !Array.isArray(question.criteria)) {
      errors.push({
        type: "missing",
        loc: ["body", "questions", questionId, "score", "criteria"],
        msg: "Field required",
        input: question,
      });
    } else if (
      question.type !== "choice" &&
      question.type !== "score" &&
      question.type !== "noul"
    ) {
      errors.push({
        type: "value_error",
        loc: ["body", "questions", questionId, "type"],
        msg: `unexpected question type: ${String(question.type)}`,
        input: question,
      });
    }
  }

  return errors;
}
