import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDecisionService } from "./decision-service.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures/jev");

const live = process.env.JEV_API_KEY ? describe : describe.skip;

live("DecisionService live Jev (JEV_API_KEY)", () => {
  it("answers a real route fixture", async () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, "choice/route.request.json"), "utf8"),
    ) as { state: Record<string, unknown>; questions: Record<string, unknown> };

    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    const result = await service.decide({
      purpose: "delegate",
      state: fixture.state,
      questions: fixture.questions as never,
    });

    expect(result.provider).toBe("jev");
    expect(result.requestId).toBeTruthy();
    expect(result.answers.route?.type).toBe("choice");
  }, 15_000);

  it("validateKey succeeds against api.typesafe.ai", async () => {
    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    await expect(service.validateKey(process.env.JEV_API_KEY!)).resolves.toMatchObject({
      ok: true,
    });
  }, 15_000);
});
