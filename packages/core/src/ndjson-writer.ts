import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { OBEvent } from "@openbot/contracts";

/**
 * Mirrors every event to `<OPENBOT_HOME>/logs/threads/*.ndjson` (plan §3/§4.2),
 * one file per UTC calendar day (derived from the event's own `ts`, not wall
 * clock, so replays under a `FakeClock` land in the right file too).
 */
export class NdjsonWriter {
  constructor(private readonly dir: string) {}

  async append(event: OBEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const day = event.ts.slice(0, 10);
    const line = `${JSON.stringify(event)}\n`;
    await appendFile(join(this.dir, `${day}.ndjson`), line, "utf8");
  }
}

/** A no-op writer for tests that don't care about the NDJSON mirror. */
export class NullNdjsonWriter {
  async append(_event: OBEvent): Promise<void> {
    // intentionally does nothing
  }
}
