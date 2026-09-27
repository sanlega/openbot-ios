import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS, listClaudeModelsForKey } from "./models.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("listClaudeModelsForKey", () => {
  it("lists the key's models across pages with their display names", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: URL, init?: RequestInit) => {
      seen.push(`${url.search} ${(init?.headers as Record<string, string>)["x-api-key"]}`);
      return url.searchParams.get("after_id")
        ? json({ data: [{ id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }] })
        : json({
            data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }],
            has_more: true,
            last_id: "claude-opus-5-5",
          });
    }) as typeof fetch;

    const result = await listClaudeModelsForKey("sk-test", fetchImpl);
    expect(result).toEqual({
      source: "api",
      models: [
        { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
      ],
    });
    expect(seen[0]).toContain("sk-test");
  });

  it("falls back to the bundled catalog when the API refuses or fails", async () => {
    const refused = (async () => json({ error: "unauthorized" }, 401)) as typeof fetch;
    const broken = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await listClaudeModelsForKey("bad", refused)).toEqual({
      models: CLAUDE_MODELS,
      source: "bundled",
    });
    expect((await listClaudeModelsForKey("k", broken)).source).toBe("bundled");
  });
});
