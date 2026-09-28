import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerSpec } from "@openbot/contracts";
import type { ConnectorTemplate } from "./curated.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Compiled stdio bridge for remote servers (see `remote-launcher.ts`). */
export const REMOTE_LAUNCHER_PATH = join(PACKAGE_ROOT, "dist", "remote-launcher.js");

const PLACEHOLDER_RE = /\$\{([A-Za-z0-9_]+)\}/g;

/** Placeholder keys a string refers to. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

/** Every placeholder key a template refers to, by where it appears. */
export function templateKeys(template: ConnectorTemplate): {
  args: string[];
  secretSafe: string[];
} {
  if (template.transport === "remote") {
    return {
      args: placeholdersIn(template.url),
      secretSafe: Object.values(template.headers ?? {}).flatMap(placeholdersIn),
    };
  }
  return {
    args: template.args.flat().flatMap(placeholdersIn),
    secretSafe: Object.values(template.env ?? {}).flatMap(placeholdersIn),
  };
}

/** `undefined` when the text refers to a value that is missing or empty (the item is dropped). */
function fill(text: string, values: Record<string, string>): string | undefined {
  let missing = false;
  const out = text.replace(PLACEHOLDER_RE, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === "") missing = true;
    return value ?? "";
  });
  return missing ? undefined : out;
}

function fillRecord(
  record: Record<string, string> | undefined,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record ?? {})) {
    const value = fill(raw, values);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The MCP server an engine spawns for one connection. Local servers run their
 * command directly; remote servers run through {@link REMOTE_LAUNCHER_PATH}
 * with the URL and headers in env (engine MCP configs are stdio-only).
 */
export function renderServer(
  name: string,
  template: ConnectorTemplate,
  values: Record<string, string>,
): McpServerSpec {
  if (template.transport === "local") {
    const args: string[] = [];
    for (const item of template.args) {
      const group = Array.isArray(item) ? item : [item];
      const filled = group.map((part) => fill(part, values));
      if (filled.every((part): part is string => part !== undefined)) args.push(...filled);
    }
    return { name, command: template.command, args, env: fillRecord(template.env, values) };
  }

  const headers = fillRecord(template.headers, values);
  const names = Object.keys(headers);
  const env: Record<string, string> = {
    OPENBOT_REMOTE_URL: fill(template.url, values) ?? template.url,
    OPENBOT_REMOTE_HEADER_NAMES: names.join(","),
  };
  names.forEach((header, i) => {
    env[`OPENBOT_REMOTE_HEADER_${i}`] = headers[header]!;
  });
  // Same rule as the OpenBot MCP server: in the desktop app, run Electron as Node.
  const inElectron = Boolean(process.versions.electron) || Boolean(process.env.OPENBOT_NODE_BIN);
  if (inElectron) env.ELECTRON_RUN_AS_NODE = "1";
  return {
    name,
    command: process.env.OPENBOT_NODE_BIN ?? process.execPath,
    args: [REMOTE_LAUNCHER_PATH],
    env,
  };
}
