import { newId, type Turn, type TurnStatus, type TurnUsage } from "@openbot/contracts";

/** Plan §4.1 `Turn`. WS1 backs this with `@openbot/store`'s `turns` table; this in-memory adapter is enough for WS2's own tests. */
export interface TurnStore {
  create(input: Omit<Turn, "id" | "createdAt" | "usage" | "status"> & { id?: string }): Turn;
  update(id: string, patch: Partial<Pick<Turn, "status" | "usage" | "sessionId">>): Turn;
  get(id: string): Turn | undefined;
}

export class InMemoryTurnStore implements TurnStore {
  private readonly turns = new Map<string, Turn>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  create(input: Omit<Turn, "id" | "createdAt" | "usage" | "status"> & { id?: string }): Turn {
    const turn: Turn = {
      ...input,
      id: input.id ?? newId("turn"),
      status: "running",
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      createdAt: this.now(),
    };
    this.turns.set(turn.id, turn);
    return turn;
  }

  update(id: string, patch: Partial<Pick<Turn, "status" | "usage" | "sessionId">>): Turn {
    const turn = this.turns.get(id);
    if (!turn) throw new Error(`TurnStore: unknown turn ${id}`);
    const updated: Turn = { ...turn, ...patch };
    this.turns.set(id, updated);
    return updated;
  }

  get(id: string): Turn | undefined {
    return this.turns.get(id);
  }
}

export function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, usd: 0 };
}

export type { TurnStatus };
