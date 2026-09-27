import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "../migrations");

export interface OpenDbOptions {
  /** `:memory:` for tests; a file path for real use (plan: `<OPENBOT_HOME>/openbot.db`). */
  path: string;
  /** Skip running migrations (e.g. to test against a deliberately-stale DB). Defaults to true. */
  migrate?: boolean;
}

export function openDb(options: OpenDbOptions): {
  db: Db;
  sqlite: Database.Database;
  close: () => void;
} {
  const sqlite = new Database(options.path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  if (options.migrate ?? true) {
    migrate(db, { migrationsFolder });
  }
  return { db, sqlite, close: () => sqlite.close() };
}
