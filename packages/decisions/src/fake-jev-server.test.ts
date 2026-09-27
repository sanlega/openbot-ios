import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  JEV_REQUEST_ID_HEADER,
  JevResponse,
  JevModelsResponse,
  JevValidationErrorBody,
  JevApiErrorBody,
  isValidationErrorBody,
  isApiErrorBody,
} from "@openbot/contracts";
import { FakeJevServer } from "./fake-jev-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures/jev");

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, path), "utf8"));
}

async function postSystemOne(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("FakeJevServer", () => {
  let server: FakeJevServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new FakeJevServer();
    ({ url: baseUrl } = await server.listen());
  });

  afterEach(async () => {
    await server.close();
  });

  it("every response — success and error — carries the x-typesafe-request-id header", async () => {
    const okRes = await postSystemOne(baseUrl, readFixture("choice/route.request.json"));
    expect(okRes.headers.get(JEV_REQUEST_ID_HEADER)).toBeTruthy();

    const badRes = await postSystemOne(
      baseUrl,
      readFixture("errors/422-missing-criteria.request.json"),
    );
    expect(badRes.headers.get(JEV_REQUEST_ID_HEADER)).toBeTruthy();

    const modelsRes = await fetch(`${baseUrl}/v1/models`);
    expect(modelsRes.headers.get(JEV_REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("GET /v1/models returns a JevModelsResponse", async () => {
    const res = await fetch(`${baseUrl}/v1/models`);
    expect(res.status).toBe(200);
    const body = await json<JevModelsResponse>(res);
    const parsed = JevModelsResponse.safeParse(body);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(
      true,
    );
  });

  it("answers a choice question with a valid JevResponse", async () => {
    const res = await postSystemOne(baseUrl, readFixture("choice/route.request.json"));
    expect(res.status).toBe(200);
    const body = await json<JevResponse>(res);
    const parsed = JevResponse.safeParse(body);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(
      true,
    );
    const route = body.answers.route;
    expect(route?.type).toBe("choice");
    expect(route?.type === "choice" && route.confidence).toBeGreaterThanOrEqual(0);
  });

  it("answers a score question with a legend keyed by criteria index", async () => {
    const res = await postSystemOne(baseUrl, readFixture("score/complexity.request.json"));
    const body = await json<JevResponse>(res);
    const complexity = body.answers.complexity;
    expect(complexity?.type).toBe("score");
    expect(complexity?.type === "score" && Object.keys(complexity.legend)).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
  });

  it("noul answers never carry a confidence field", async () => {
    const res = await postSystemOne(baseUrl, readFixture("noul/needs-engine.request.json"));
    const body = await json<JevResponse>(res);
    const answer = body.answers.needs_engine;
    expect(answer?.type).toBe("noul");
    expect(answer?.type === "noul" && typeof answer.noul).toBe("number");
    expect(answer).not.toHaveProperty("confidence");
  });

  it("a batch request answers every question in one call", async () => {
    const res = await postSystemOne(baseUrl, readFixture("batch/triage.request.json"));
    const body = await json<JevResponse>(res);
    const requestBody = readFixture("batch/triage.request.json") as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(body.answers).sort()).toEqual(Object.keys(requestBody.questions).sort());
  });

  it("422: a choice question missing criteria is rejected as a validation-error ARRAY", async () => {
    const res = await postSystemOne(
      baseUrl,
      readFixture("errors/422-missing-criteria.request.json"),
    );
    expect(res.status).toBe(422);
    const body = await json<JevValidationErrorBody>(res);
    expect(Array.isArray(body.detail)).toBe(true);
    const parsed = JevValidationErrorBody.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(isValidationErrorBody(body)).toBe(true);
    expect(isApiErrorBody(body)).toBe(false);
  });

  it("401: a missing/invalid Authorization header is rejected as a single OBJECT", async () => {
    server = new FakeJevServer({ apiKey: "sk-real-fake-key" });
    ({ url: baseUrl } = await server.listen());

    const res = await postSystemOne(baseUrl, readFixture("noul/needs-engine.request.json"), {
      Authorization: "Bearer sk-wrong",
    });
    expect(res.status).toBe(401);
    const body = await json<JevApiErrorBody>(res);
    expect(Array.isArray(body.detail)).toBe(false);
    const parsed = JevApiErrorBody.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(isApiErrorBody(body)).toBe(true);
    expect(isValidationErrorBody(body)).toBe(false);
  });

  it("a valid Authorization header is accepted when an apiKey is configured", async () => {
    server = new FakeJevServer({ apiKey: "sk-real-fake-key" });
    ({ url: baseUrl } = await server.listen());

    const res = await postSystemOne(baseUrl, readFixture("noul/needs-engine.request.json"), {
      Authorization: "Bearer sk-real-fake-key",
    });
    expect(res.status).toBe(200);
  });

  it("scheduleRateLimit() makes the next N calls return 429, then resumes normal answers", async () => {
    server.scheduleRateLimit(2);

    const first = await postSystemOne(baseUrl, readFixture("noul/needs-engine.request.json"));
    const second = await postSystemOne(baseUrl, readFixture("noul/needs-engine.request.json"));
    const third = await postSystemOne(baseUrl, readFixture("noul/needs-engine.request.json"));

    expect(first.status).toBe(429);
    expect(second.status).toBe(429);
    expect(third.status).toBe(200);
    expect(first.headers.get("Retry-After")).toBeTruthy();
  });

  it("scriptedAnswers overrides the deterministic default for a given question id", async () => {
    server.scriptedAnswers.route = {
      type: "choice",
      choice: "new_bot",
      confidence: 0.42,
      probabilities: { new_bot: 1 },
    };
    const res = await postSystemOne(baseUrl, readFixture("choice/route.request.json"));
    const body = await json<JevResponse>(res);
    expect(body.answers.route).toMatchObject({ choice: "new_bot", confidence: 0.42 });
  });
});
