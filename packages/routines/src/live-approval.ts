import type { CoreContext } from "@openbot/core";

/**
 * When the user allows a `routine_live` card (raised after a dry run planned
 * side effects), enables live runs for that routine. The card carries the dry
 * run's chain, which leads back to the run and its routine. Returns the
 * routine id when one was enabled.
 */
export function applyRoutineLiveApproval(
  ctx: CoreContext,
  approvalId: string,
  resolution: "allow" | "deny",
): string | undefined {
  if (resolution !== "allow") return undefined;
  const approval = ctx.repos.approvals.getById(approvalId);
  if (approval?.kind !== "routine_live" || !approval.chainId) return undefined;
  const runId = ctx.repos.chains.getById(approval.chainId)?.routineRunId;
  const routineId = runId ? ctx.repos.routineRuns.getById(runId)?.routineId : undefined;
  if (!routineId || !ctx.repos.routines.getById(routineId)) return undefined;
  ctx.repos.routines.update(routineId, { liveApproved: true });
  return routineId;
}
