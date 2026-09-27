import type { SetupState } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { setupState } from "./schema.js";

type SetupStateRow = typeof setupState.$inferSelect;
const SINGLETON_ID = "singleton";

/** Single setup-wizard-progress row (plan §4.1/§4.7 `setup`/`setup/validate`). */
export class SetupStateRepo {
  constructor(private readonly db: Db) {}

  get(): SetupState {
    const row = this.db.select().from(setupState).where(eq(setupState.id, SINGLETON_ID)).get();
    return row ? toState(row) : { id: "singleton" };
  }

  patch(patch: Partial<Omit<SetupState, "id">>): SetupState {
    const current = this.get();
    const next: SetupState = { ...current, ...patch, id: "singleton" };
    this.db
      .insert(setupState)
      .values({
        id: SINGLETON_ID,
        typesafe: next.typesafe,
        claude: next.claude,
        codex: next.codex,
        tailscale: next.tailscale,
        cloudflare: next.cloudflare,
        completedAt: next.completedAt ? new Date(next.completedAt) : undefined,
      })
      .onConflictDoUpdate({
        target: setupState.id,
        set: {
          typesafe: next.typesafe,
          claude: next.claude,
          codex: next.codex,
          tailscale: next.tailscale,
          cloudflare: next.cloudflare,
          completedAt: next.completedAt ? new Date(next.completedAt) : undefined,
        },
      })
      .run();
    return next;
  }
}

function toState(row: SetupStateRow): SetupState {
  return {
    id: "singleton",
    typesafe: row.typesafe ?? undefined,
    claude: (row.claude as SetupState["claude"]) ?? undefined,
    codex: (row.codex as SetupState["codex"]) ?? undefined,
    tailscale: row.tailscale ?? undefined,
    cloudflare: row.cloudflare ?? undefined,
    completedAt: row.completedAt?.toISOString(),
  };
}
