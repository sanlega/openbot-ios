import {
  JEV_REQUEST_ID_HEADER,
  type JevModelsResponse,
  type JevQuestion,
  type JevResponse,
  type JevState,
  isApiErrorBody,
} from "@openbot/contracts";

/** Pinned model per plan U1/E5. */
export const PINNED_JEV_MODEL = "jev-1.13.0";

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  retryBudgetMs?: number;
}

export interface SystemOneCall {
  state: JevState;
  questions: Record<string, JevQuestion>;
  timeoutMs: number;
}

export interface SystemOneResult {
  response: JevResponse;
  requestId?: string;
  latencyMs: number;
}

export class JevClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "JevClientError";
  }
}

/**
 * Direct HTTP client for Jev (`POST /v1/systemone`, `GET /v1/models`) with SDK-aligned
 * retry defaults (docs.typesafe.ai/sdk/python/api/retries): max 2 retries, 0.5s→5s
 * backoff with ±25% jitter, honors Retry-After / retry-after-ms, 30s retry budget.
 */
export class JevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly retryBudgetMs: number;

  constructor(options: JevClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = options.model ?? PINNED_JEV_MODEL;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBudgetMs = options.retryBudgetMs ?? 30_000;
  }

  get endpoint(): string {
    return this.baseUrl;
  }

  async validateKey(): Promise<{ ok: boolean; rpmLimit?: number }> {
    try {
      await this.listModels();
      return { ok: true, rpmLimit: 1200 };
    } catch {
      return { ok: false };
    }
  }

  async listModels(): Promise<JevModelsResponse> {
    const res = await this.fetchWithAuth(`${this.baseUrl}/v1/models`, { method: "GET" });
    if (!res.ok) {
      throw await this.errorFromResponse(res);
    }
    return (await res.json()) as JevModelsResponse;
  }

  async systemOne(call: SystemOneCall): Promise<SystemOneResult> {
    const started = Date.now();
    const retryDeadline = started + this.retryBudgetMs;
    let attempt = 0;
    let lastError: JevClientError | undefined;

    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), call.timeoutMs);
      try {
        const res = await this.fetchWithAuth(`${this.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            state: call.state,
            questions: call.questions,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          return {
            response: (await res.json()) as JevResponse,
            requestId: res.headers.get(JEV_REQUEST_ID_HEADER) ?? undefined,
            latencyMs: Date.now() - started,
          };
        }

        const err = await this.errorFromResponse(res);
        lastError = err;
        if (!err.retryable || attempt >= this.maxRetries || Date.now() >= retryDeadline) {
          throw err;
        }

        await this.sleepBeforeRetry(res, attempt, retryDeadline);
        attempt += 1;
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof JevClientError) {
          lastError = error;
          if (!error.retryable || attempt >= this.maxRetries || Date.now() >= retryDeadline) {
            throw error;
          }
          await this.sleepBeforeRetry(undefined, attempt, retryDeadline);
          attempt += 1;
          continue;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new JevClientError(
            `Jev request timed out after ${call.timeoutMs}ms`,
            408,
            undefined,
            true,
          );
        }
        throw error;
      }
    }

    throw lastError ?? new JevClientError("Jev request failed", 500);
  }

  private async fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    });
  }

  private async errorFromResponse(res: Response): Promise<JevClientError> {
    const requestId = res.headers.get(JEV_REQUEST_ID_HEADER) ?? undefined;
    let message = `Jev HTTP ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (isApiErrorBody(body)) message = body.detail.message;
      else if (Array.isArray((body as { detail?: unknown }).detail)) {
        const first = (body as { detail: Array<{ msg: string }> }).detail[0];
        message = first?.msg ?? message;
      }
    } catch {
      // ignore parse errors
    }
    return new JevClientError(message, res.status, requestId, RETRYABLE_STATUSES.has(res.status));
  }

  private async sleepBeforeRetry(
    res: Response | undefined,
    attempt: number,
    retryDeadline: number,
  ): Promise<void> {
    const retryAfterMs = parseRetryAfterMs(res);
    const base = Math.min(500 * 2 ** attempt, 5000);
    const jitter = base * (0.75 + Math.random() * 0.5);
    const delay = retryAfterMs ?? jitter;
    const remaining = retryDeadline - Date.now();
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
  }
}

function parseRetryAfterMs(res?: Response): number | undefined {
  if (!res) return undefined;
  const retryAfterMs = res.headers.get("retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number(retryAfterMs);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const retryAfter = res.headers.get("Retry-After");
  if (!retryAfter) return undefined;
  const asNumber = Number(retryAfter);
  if (!Number.isNaN(asNumber)) return asNumber * 1000;
  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function jevTimeoutMs(purpose: string): number {
  return purpose === "computer" ? 400 : 1500;
}
