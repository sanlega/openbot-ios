import type {
  Bot,
  DecideRequest,
  EngineDriver,
  JevAnswer,
  JevQuestion,
  TurnInput,
} from "@openbot/contracts";
import type { LlmFallback } from "./fallbacks.js";

const FALLBACK_BOT: Bot = {
  id: "bot_llm_fallback",
  slug: "llm-fallback",
  name: "LLM Fallback",
  description: "One-shot structured decision fallback when Jev is unavailable.",
  pinned: false,
  hidden: true,
  isChiefOfStaff: false,
  createdBy: "system",
  routing: { mode: "pinned", engine: "fake", model: "fallback" },
  permissionPreset: "read_only",
  computer: "none",
  connectors: [],
  limits: {},
};

export interface EngineLlmFallbackOptions {
  driver: EngineDriver;
  /** Bot profile passed to the engine turn; defaults to an internal system bot. */
  bot?: Bot;
  model?: string;
  timeoutMs?: number;
}

/**
 * LLM one-shot fallback (plan WS7): runs a single engine turn with a JSON-schema
 * prompt and parses structured Jev-shaped answers. Uses the `EngineDriver`
 * contract so WS3 drivers (Claude/Codex) or `FakeEngineDriver` can back it.
 */
export class EngineLlmFallback implements LlmFallback {
  readonly modelLabel: string;
  private readonly driver: EngineDriver;
  private readonly bot: Bot;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: EngineLlmFallbackOptions) {
    this.driver = options.driver;
    this.modelLabel = `${options.driver.id}-llm-fallback`;
    this.bot = options.bot ?? FALLBACK_BOT;
    this.model = options.model ?? "fallback";
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async answer(req: DecideRequest): Promise<Record<string, JevAnswer> | null> {
    const prompt = buildStructuredPrompt(req);
    const text = await runOneShotTurn(this.driver, this.bot, prompt, {
      model: this.model,
      timeoutMs: this.timeoutMs,
    });
    if (!text) return null;
    return parseStructuredAnswers(text, req.questions);
  }
}

export async function runOneShotTurn(
  driver: EngineDriver,
  bot: Bot,
  prompt: string,
  options: { model: string; timeoutMs: number },
): Promise<string | null> {
  const chunks: string[] = [];
  let errored = false;

  const input: TurnInput = {
    bot,
    text: prompt,
    attachments: [],
    systemPrompt:
      "You are a structured decision engine. Reply with a single JSON object only — no markdown fences, no prose.",
    cwd: process.cwd(),
    addDirs: [],
    auth: { mode: "api_key", env: {} },
    mcpServers: [],
    permission: bot.permissionPreset,
    allowTools: [],
    denyTools: ["*"],
    model: options.model,
    limits: { maxSteps: 1 },
  };

  const handle = driver.startTurn(input, {
    emit(event) {
      if (event.type === "text_delta") chunks.push(event.text);
      if (event.type === "error") errored = true;
    },
    requestApproval: async () => "deny",
  });

  const result = await Promise.race([
    handle.done,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), options.timeoutMs)),
  ]);

  if (result === null || errored || (result && result.isError)) return null;
  return chunks.join("").trim();
}

export function buildStructuredPrompt(req: DecideRequest): string {
  const schema = buildAnswerSchema(req.questions);
  return [
    "Given the state and questions below, return JSON matching the schema.",
    "Use only the allowed choice keys / score indices / noul probabilities (0-1).",
    "",
    `Purpose: ${req.purpose}`,
    `State: ${JSON.stringify(req.state)}`,
    "",
    "Questions:",
    JSON.stringify(req.questions, null, 2),
    "",
    "Required JSON schema for `answers`:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

export function buildAnswerSchema(questions: Record<string, JevQuestion>): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(questions)) {
    switch (question.type) {
      case "choice":
        answers[id] = {
          type: "choice",
          choice: Object.keys(question.criteria)[0],
          confidence: 0.0,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map((k) => [k, 0])),
        };
        break;
      case "score":
        answers[id] = {
          type: "score",
          score: 0,
          confidence: 0.0,
          legend: Object.fromEntries(question.criteria.map((c, i) => [String(i), c])),
          probabilities: Object.fromEntries(question.criteria.map((_c, i) => [String(i), 0])),
        };
        break;
      case "noul":
        answers[id] = { type: "noul", noul: 0.0 };
        break;
    }
  }
  return { answers };
}

export function parseStructuredAnswers(
  text: string,
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const root = parsed as { answers?: Record<string, unknown> };
  if (!root.answers || typeof root.answers !== "object") return null;

  const result: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const raw = root.answers[id];
    const answer = coerceAnswer(raw, question);
    if (!answer) return null;
    result[id] = answer;
  }
  return result;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function coerceAnswer(raw: unknown, question: JevQuestion): JevAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  switch (question.type) {
    case "choice": {
      const choice = String(obj.choice ?? "");
      if (!Object.hasOwn(question.criteria, choice)) return null;
      const confidence = clamp01(Number(obj.confidence ?? 0.5));
      return {
        type: "choice",
        choice,
        confidence,
        probabilities:
          typeof obj.probabilities === "object" && obj.probabilities
            ? (obj.probabilities as Record<string, number>)
            : { [choice]: confidence },
      };
    }
    case "score": {
      const score = Number(obj.score ?? 0);
      const confidence = clamp01(Number(obj.confidence ?? 0.5));
      const legend =
        typeof obj.legend === "object" && obj.legend
          ? (obj.legend as Record<string, string>)
          : Object.fromEntries(question.criteria.map((c, i) => [String(i), c]));
      return {
        type: "score",
        score,
        confidence,
        legend,
        probabilities:
          typeof obj.probabilities === "object" && obj.probabilities
            ? (obj.probabilities as Record<string, number>)
            : {},
      };
    }
    case "noul":
      return { type: "noul", noul: clamp01(Number(obj.noul ?? 0.5)) };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
