import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type FixtureDirection = "send" | "recv" | "stderr";

export interface FixtureLine {
  direction?: FixtureDirection;
  raw: Record<string, unknown>;
}

const enginesFixturesRoot = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../fixtures",
);

export function fixturesRoot(): string {
  return enginesFixturesRoot;
}

export async function loadFixture(relativePath: string): Promise<FixtureLine[]> {
  const full = path.join(enginesFixturesRoot, relativePath);
  const text = await readFile(full, "utf8");
  return parseFixtureText(text);
}

export function parseFixtureText(text: string): FixtureLine[] {
  const lines: FixtureLine[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const direction = parsed.direction as FixtureDirection | undefined;
    if (direction === "send" || direction === "recv" || direction === "stderr") {
      const { direction: _d, ts: _t, ...rest } = parsed;
      lines.push({ direction, raw: rest });
      continue;
    }
    lines.push({ direction: "recv", raw: parsed });
  }
  return lines;
}

export function recvLines(fixture: FixtureLine[]): Record<string, unknown>[] {
  return fixture.filter((l) => l.direction === "recv" || l.direction == null).map((l) => l.raw);
}

export function sendLines(fixture: FixtureLine[]): Record<string, unknown>[] {
  return fixture.filter((l) => l.direction === "send").map((l) => l.raw);
}
