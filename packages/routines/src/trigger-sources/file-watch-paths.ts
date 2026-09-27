import { resolve } from "node:path";
import type { Routine } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";

/** Allowed watch roots for a routine (plan §5 WS12: shared workspace + bot area). */
export function allowedWatchRoots(ctx: CoreContext, botId: string): string[] {
  return [resolve(ctx.config.workspaceDir), resolve(ctx.config.screensDir, botId)];
}

/**
 * Resolves `trigger.path` to an absolute path under the shared workspace or the
 * owning bot's screen/workspace area. Returns `undefined` when the path escapes
 * allowed roots.
 */
export function resolveWatchPath(
  ctx: CoreContext,
  routine: Routine,
  triggerPath?: string,
): string | undefined {
  if (routine.trigger.type !== "event" || routine.trigger.source !== "file") return undefined;

  const rel = (triggerPath ?? "**").replace(/^\//, "");
  const roots = allowedWatchRoots(ctx, routine.botId);

  const candidates: string[] = [];
  if (rel.startsWith("screens/")) {
    candidates.push(resolve(ctx.config.screensDir, routine.botId, rel.slice("screens/".length)));
  } else {
    candidates.push(resolve(ctx.config.workspaceDir, rel));
  }

  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    if (roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
      return normalized;
    }
  }
  return undefined;
}
