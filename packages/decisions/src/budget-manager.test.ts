import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_LIMITS } from "@openbot/contracts";
import { BudgetManager } from "./budget-manager.js";

describe("BudgetManager", () => {
  it("maps purposes to fixed budgets", () => {
    const manager = new BudgetManager();
    expect(manager.purposeBudget("spawn")).toBe("gates");
    expect(manager.purposeBudget("triage")).toBe("interactive");
    expect(manager.purposeBudget("computer")).toBe("computer");
    expect(manager.purposeBudget("attention")).toBe("background");
  });

  it("reports O4 default limits", () => {
    const manager = new BudgetManager();
    const budgets = manager.budgets();
    expect(budgets.gates.limitRpm).toBe(DEFAULT_BUDGET_LIMITS.gates);
    expect(budgets.interactive.limitRpm).toBe(DEFAULT_BUDGET_LIMITS.interactive);
    expect(budgets.computer.limitRpm).toBe(DEFAULT_BUDGET_LIMITS.computer);
    expect(budgets.background.limitRpm).toBe(DEFAULT_BUDGET_LIMITS.background);
  });

  it("prefers gate queue entries over computer when computer budget is saturated", async () => {
    const manager = new BudgetManager({
      limits: { gates: 5, computer: 1, interactive: 5, background: 5 },
      totalRpmLimit: 20,
    });

    await manager.acquire("computer");
    const order: string[] = [];
    const gatePromise = manager.acquire("gates").then(() => {
      order.push("gate");
    });
    const computerPromise = manager.acquire("computer").then(() => {
      order.push("computer");
    });

    await gatePromise;
    expect(order[0]).toBe("gate");
    await computerPromise;
  });

  it("tracks per-computer-task rpm", async () => {
    const manager = new BudgetManager({ computerTaskRpmLimit: 2 });
    await manager.acquire("computer", { computerTaskId: "task_a" });
    await manager.acquire("computer", { computerTaskId: "task_a" });
    expect(manager.computerTaskUsedRpm("task_a")).toBe(2);
    expect(manager.isComputerTaskOverLimit("task_a")).toBe(true);
  });
});
