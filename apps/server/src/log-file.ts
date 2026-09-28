import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Mirrors the harness's console output into `<home>/logs/harness.log` (one
 * previous file kept as `.1`), so problems in the desktop app — where nobody
 * sees stdout — can be diagnosed afterwards. Secrets must never be logged.
 */
export function startFileLog(openbotHome: string): string {
  const dir = join(openbotHome, "logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "harness.log");
  if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  const stream = createWriteStream(file, { flags: "a" });

  const write = (level: string, args: unknown[]) => {
    stream.write(`${new Date().toISOString()} ${level} ${format(...args)}\n`);
  };
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      write(level.toUpperCase(), args);
      original(...args);
    };
  }
  process.on("unhandledRejection", (reason) => write("UNHANDLED", [reason]));
  process.on("uncaughtException", (error) => write("UNCAUGHT", [error]));
  return file;
}
