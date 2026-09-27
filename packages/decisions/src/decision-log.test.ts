import { describe, expect, it } from "vitest";
import { openDb, DecisionsRepo } from "@openbot/store";
import { DecisionLog, InMemoryDecisionLog, type DecisionLogStore } from "./decision-log.js";

class RepoDecisionLogStore implements DecisionLogStore {
  constructor(
    private readonly repo: DecisionsRepo,
    private readonly memory: InMemoryDecisionLog,
  ) {}

  insert(decision: Parameters<DecisionLogStore["insert"]>[0]): void {
    this.repo.insert(decision);
    this.memory.insert(decision);
  }

  list(): ReturnType<DecisionLogStore["list"]> {
    return this.memory.list();
  }
}

describe("DecisionLog with DecisionsRepo", () => {
  it("persists decisions to SQLite", () => {
    const { db, close } = openDb({ path: ":memory:" });
    const repo = new DecisionsRepo(db);
    const memory = new InMemoryDecisionLog();
    const log = new DecisionLog(new RepoDecisionLogStore(repo, memory));

    const id = log.record({
      purpose: "route",
      provider: "jev",
      model: "jev-1.13.0",
      state: { task: "hello" },
      answers: {
        route: { type: "choice", choice: "claude:sonnet", confidence: 0.9, probabilities: {} },
      },
      requestId: "req_test",
      primaryAnswerId: "route",
    });

    const stored = repo.getById(id);
    expect(stored?.requestId).toBe("req_test");
    expect(stored?.provider).toBe("jev");
    close();
  });
});
