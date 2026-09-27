import { afterEach, describe, expect, it } from "vitest";
import { newId, type InputRequest } from "@openbot/contracts";
import { openDb } from "./db.js";
import { InputRequestsRepo } from "./input-requests-repo.js";

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

describe("InputRequestsRepo", () => {
  it("stores a request, lists pending ones, and resolves it once", () => {
    const opened = openDb({ path: ":memory:" });
    close = opened.close;
    const repo = new InputRequestsRepo(opened.db);
    const request: InputRequest = {
      id: newId("inputRequest"),
      botId: "bot_1",
      threadId: "thr_1",
      title: "About you",
      fields: [
        { id: "name", type: "text", label: "Name", required: true, multiline: false },
        {
          id: "tone",
          type: "choice",
          label: "Tone",
          required: false,
          options: ["Short", "Detailed"],
          multiple: false,
          allowOther: false,
        },
      ],
      status: "pending",
      createdAt: "2026-09-27T10:00:00.000Z",
    };
    repo.create(request);

    expect(repo.list({ status: "pending" })).toEqual([request]);
    const at = new Date("2026-09-27T10:05:00.000Z");
    expect(repo.resolve(request.id, "answered", at, { name: "Alex", tone: null })).toBe(true);
    expect(repo.resolve(request.id, "dismissed", at)).toBe(false);
    expect(repo.getById(request.id)).toMatchObject({
      status: "answered",
      answers: { name: "Alex", tone: null },
      resolvedAt: at.toISOString(),
    });
    expect(repo.list({ status: "pending" })).toEqual([]);
  });
});
