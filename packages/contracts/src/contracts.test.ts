import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  OBEvent,
  EventType,
  JevRequest,
  JevResponse,
  JevModelsResponse,
  JevValidationErrorBody,
  JevApiErrorBody,
  isValidationErrorBody,
  isApiErrorBody,
  newId,
  isId,
  bandConfidence,
  bandNoul,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const eventsFixturesDir = join(here, "../fixtures/events");
const jevFixturesDir = join(here, "../../decisions/fixtures/jev");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("OBEvent fixtures", () => {
  const files = readdirSync(eventsFixturesDir).filter((f: string) => f.endsWith(".json"));

  it("has exactly one fixture per EventType", () => {
    const typesInFixtures = files.map((f: string) => f.replace(/\.json$/, "").replace(/-/g, "."));
    expect(new Set(typesInFixtures)).toEqual(new Set(EventType.options));
    expect(files.length).toBe(EventType.options.length);
  });

  it.each(files)("%s parses as a valid OBEvent", (file: string) => {
    const parsed = OBEvent.safeParse(readJson(join(eventsFixturesDir, file)));
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(
      true,
    );
  });
});

describe("Jev fixtures (recorded live against api.typesafe.ai)", () => {
  it("choice/route request+response match the JevRequest/JevResponse schema", () => {
    const req = JevRequest.parse(readJson(join(jevFixturesDir, "choice/route.request.json")));
    expect(req.questions.route?.type).toBe("choice");
    const res = JevResponse.parse(readJson(join(jevFixturesDir, "choice/route.response.json")));
    const answer = res.answers.route;
    expect(answer?.type).toBe("choice");
    if (answer?.type === "choice") expect(answer.confidence).toBe(1.0);
  });

  it("score/complexity response legend is keyed by string index", () => {
    const res = JevResponse.parse(readJson(join(jevFixturesDir, "score/complexity.response.json")));
    const answer = res.answers.complexity;
    expect(answer?.type).toBe("score");
    if (answer?.type === "score") {
      expect(answer.legend["3"]).toMatch(/Complex/);
    }
  });

  it("noul answers never carry a confidence field", () => {
    const res = JevResponse.parse(
      readJson(join(jevFixturesDir, "noul/needs-engine.response.json")),
    );
    const answer = res.answers.needs_engine;
    expect(answer?.type).toBe("noul");
    expect(answer && "confidence" in answer).toBe(false);
  });

  it("batch response covers choice+score+3 nouls in one call", () => {
    const res = JevResponse.parse(readJson(join(jevFixturesDir, "batch/triage.response.json")));
    expect(Object.keys(res.answers).sort()).toEqual(
      ["existing_can_do", "intent", "needs_engine", "recurring_ownership", "urgency"].sort(),
    );
  });

  it("models list response matches JevModelsResponse", () => {
    const res = JevModelsResponse.parse(
      readJson(join(jevFixturesDir, "models/list-models.response.json")),
    );
    expect(res.models.map((m) => m.name)).toEqual(["jev-latest", "jev-preview"]);
  });

  it("422 error body is a validation-error ARRAY, not an object", () => {
    const body = readJson(join(jevFixturesDir, "errors/422-missing-criteria.response.json"));
    expect(Array.isArray((body as { detail: unknown }).detail)).toBe(true);
    expect(isValidationErrorBody(body)).toBe(true);
    expect(isApiErrorBody(body)).toBe(false);
    JevValidationErrorBody.parse(body);
  });

  it("401 error body is a single OBJECT, not an array", () => {
    const body = readJson(join(jevFixturesDir, "errors/401-invalid-key.response.json"));
    expect(Array.isArray((body as { detail: unknown }).detail)).toBe(false);
    expect(isApiErrorBody(body)).toBe(true);
    expect(isValidationErrorBody(body)).toBe(false);
    JevApiErrorBody.parse(body);
  });
});

describe("banding", () => {
  it("choice/score confidence bands at 0.9/0.5", () => {
    expect(bandConfidence(0.95)).toBe("auto");
    expect(bandConfidence(0.7)).toBe("confirm");
    expect(bandConfidence(0.2)).toBe("human");
  });

  it("noul bands off distance from 0.5, not a confidence field", () => {
    expect(bandNoul(0.99)).toBe("auto");
    expect(bandNoul(0.01)).toBe("auto");
    expect(bandNoul(0.32)).toBe("human");
    expect(bandNoul(0.5)).toBe("human");
  });
});

describe("prefixed ULIDs", () => {
  it("newId produces an id matching isId for its own kind", () => {
    const id = newId("bot");
    expect(id.startsWith("bot_")).toBe(true);
    expect(isId("bot", id)).toBe(true);
    expect(isId("thread", id)).toBe(false);
  });

  it("newId is monotonically sortable", () => {
    const a = newId("chain");
    const b = newId("chain");
    expect(a < b).toBe(true);
  });
});
