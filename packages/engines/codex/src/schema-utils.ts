import { readFile } from "node:fs/promises";
import path from "node:path";
import { fixturesRoot } from "@openbot/engines-common";

/** Collect every JSON-RPC `method` enum value from codex schema oneOf entries. */
export async function listServerRequestMethods(relativeSchemaPath: string): Promise<string[]> {
  const schemaPath = path.join(fixturesRoot(), relativeSchemaPath);
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    oneOf?: Array<{ properties?: { method?: { enum?: string[] } } }>;
  };
  const methods = new Set<string>();
  for (const entry of schema.oneOf ?? []) {
    for (const value of entry.properties?.method?.enum ?? []) {
      methods.add(value);
    }
  }
  return [...methods];
}
