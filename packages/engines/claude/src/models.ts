import type { ModelInfo } from "@openbot/contracts";

export const CLAUDE_MIN_VERSION = "2.1.283";

export const CLAUDE_MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 200_000 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", contextWindow: 200_000 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000 },
];

/**
 * Models this API key can use, from the Anthropic Models API (`GET /v1/models`).
 * Only for API-key mode: a Claude Code login (OAuth session) has no documented
 * model listing, so those users get the bundled catalog. Falls back to it on any
 * error, so a flaky network never empties the model picker.
 */
export async function listClaudeModelsForKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl = "https://api.anthropic.com",
): Promise<{ models: ModelInfo[]; source: "api" | "bundled" }> {
  try {
    const models: ModelInfo[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = new URL("/v1/models", baseUrl);
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);
      const res = await fetchImpl(url, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`models API ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{ id?: unknown; display_name?: unknown }>;
        has_more?: boolean;
        last_id?: string;
      };
      for (const entry of body.data ?? []) {
        if (typeof entry.id !== "string" || !entry.id) continue;
        models.push({
          id: entry.id,
          label: typeof entry.display_name === "string" ? entry.display_name : entry.id,
        });
      }
      if (!body.has_more || !body.last_id) break;
      afterId = body.last_id;
    }
    return models.length > 0
      ? { models, source: "api" }
      : { models: CLAUDE_MODELS, source: "bundled" };
  } catch {
    return { models: CLAUDE_MODELS, source: "bundled" };
  }
}
