import {
  type Budget,
  type BudgetStatus,
  DEFAULT_BUDGET_LIMITS,
  DEFAULT_TOTAL_RPM_LIMIT,
  type Purpose,
  PURPOSE_BUDGET,
} from "@openbot/contracts";

/** Priority lane: lower number = higher priority (gates never queue behind computer). */
const BUDGET_PRIORITY: Record<Budget, number> = {
  gates: 0,
  interactive: 1,
  background: 2,
  computer: 3,
};

const ALL_BUDGETS: Budget[] = ["gates", "interactive", "computer", "background"];

export interface BudgetManagerOptions {
  totalRpmLimit?: number;
  limits?: Partial<Record<Budget, number>>;
  /** Per concurrent computer task (plan O4). */
  computerTaskRpmLimit?: number;
  maxConcurrentComputerTasks?: number;
}

interface PendingAcquire {
  budget: Budget;
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
}

/**
 * O4 purpose budgets with borrowing rules and priority lanes. Gates are reserved
 * (nothing borrows from gates); gates may borrow unused capacity from any bucket.
 * Computer may borrow only from background.
 */
export class BudgetManager {
  private readonly limits: Record<Budget, number>;
  private readonly totalRpmLimit: number;
  private readonly computerTaskRpmLimit: number;
  private readonly maxConcurrentComputerTasks: number;
  private readonly timestamps: Record<Budget, number[]> = {
    gates: [],
    interactive: [],
    computer: [],
    background: [],
  };
  private readonly computerTaskTimestamps = new Map<string, number[]>();
  private activeComputerTasks = 0;
  private readonly queue: PendingAcquire[] = [];
  private processing = false;

  constructor(options: BudgetManagerOptions = {}) {
    this.totalRpmLimit = options.totalRpmLimit ?? DEFAULT_TOTAL_RPM_LIMIT;
    this.limits = {
      gates: options.limits?.gates ?? DEFAULT_BUDGET_LIMITS.gates,
      interactive: options.limits?.interactive ?? DEFAULT_BUDGET_LIMITS.interactive,
      computer: options.limits?.computer ?? DEFAULT_BUDGET_LIMITS.computer,
      background: options.limits?.background ?? DEFAULT_BUDGET_LIMITS.background,
    };
    this.computerTaskRpmLimit = options.computerTaskRpmLimit ?? 120;
    this.maxConcurrentComputerTasks = options.maxConcurrentComputerTasks ?? 3;
  }

  purposeBudget(purpose: Purpose): Budget {
    return PURPOSE_BUDGET[purpose];
  }

  budgets(): Record<Budget, BudgetStatus> {
    this.pruneOld();
    const result = {} as Record<Budget, BudgetStatus>;
    for (const budget of ALL_BUDGETS) {
      result[budget] = {
        limitRpm: this.limits[budget],
        usedRpm: this.timestamps[budget].length,
        queued: this.queue.filter((item) => item.budget === budget).length,
      };
    }
    return result;
  }

  async acquire(budget: Budget, options: { computerTaskId?: string } = {}): Promise<() => void> {
    if (budget === "computer") {
      await this.acquireComputer(options.computerTaskId ?? "default");
    }

    await new Promise<void>((resolve, reject) => {
      this.queue.push({ budget, resolve, reject, enqueuedAt: Date.now() });
      void this.processQueue();
    });

    const now = Date.now();
    this.timestamps[budget].push(now);
    if (budget === "computer" && options.computerTaskId) {
      const taskTs = this.computerTaskTimestamps.get(options.computerTaskId) ?? [];
      taskTs.push(now);
      this.computerTaskTimestamps.set(options.computerTaskId, taskTs);
    }

    return () => {
      if (budget === "computer") {
        this.releaseComputerTask(options.computerTaskId ?? "default");
      }
    };
  }

  private async acquireComputer(taskId: string): Promise<void> {
    while (this.activeComputerTasks >= this.maxConcurrentComputerTasks) {
      await sleep(10);
    }
    this.activeComputerTasks += 1;
    this.computerTaskTimestamps.set(taskId, this.computerTaskTimestamps.get(taskId) ?? []);
  }

  private releaseComputerTask(taskId: string): void {
    this.activeComputerTasks = Math.max(0, this.activeComputerTasks - 1);
    this.computerTaskTimestamps.delete(taskId);
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        this.pruneOld();
        const nextIndex = this.pickNextQueueIndex();
        if (nextIndex === -1) {
          await sleep(5);
          continue;
        }
        const [next] = this.queue.splice(nextIndex, 1);
        if (!next) break;
        next.resolve();
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) void this.processQueue();
    }
  }

  private pickNextQueueIndex(): number {
    let bestIndex = -1;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.queue.length; i += 1) {
      const item = this.queue[i];
      if (!item) continue;
      if (!this.canServe(item.budget)) continue;
      const priority = BUDGET_PRIORITY[item.budget];
      if (priority < bestPriority) {
        bestPriority = priority;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private canServe(budget: Budget): boolean {
    const used = this.timestamps[budget].length;
    if (used < this.limits[budget]) return true;
    if (budget === "gates") {
      return this.borrowableCapacity(budget) > 0;
    }
    if (budget === "computer") {
      return this.borrowableCapacity("background") > 0;
    }
    return false;
  }

  private borrowableCapacity(excluding: Budget): number {
    let spare = 0;
    for (const bucket of ALL_BUDGETS) {
      if (bucket === excluding) continue;
      if (bucket === "gates") continue;
      spare += Math.max(0, this.limits[bucket] - this.timestamps[bucket].length);
    }
    const totalUsed = ALL_BUDGETS.reduce((sum, b) => sum + this.timestamps[b].length, 0);
    const globalSpare = Math.max(0, this.totalRpmLimit - totalUsed);
    return Math.min(spare, globalSpare);
  }

  private pruneOld(now = Date.now()): void {
    for (const budget of ALL_BUDGETS) {
      this.timestamps[budget] = this.timestamps[budget].filter((ts) => now - ts < 60_000);
    }
    for (const [taskId, tsList] of this.computerTaskTimestamps.entries()) {
      const recent = tsList.filter((ts) => now - ts < 60_000);
      if (recent.length === 0) this.computerTaskTimestamps.delete(taskId);
      else this.computerTaskTimestamps.set(taskId, recent);
    }
  }

  computerTaskUsedRpm(taskId: string): number {
    const now = Date.now();
    return (this.computerTaskTimestamps.get(taskId) ?? []).filter((ts) => now - ts < 60_000).length;
  }

  isComputerTaskOverLimit(taskId: string): boolean {
    return this.computerTaskUsedRpm(taskId) >= this.computerTaskRpmLimit;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
