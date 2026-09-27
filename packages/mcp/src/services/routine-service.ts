import { newId, RoutineLimits, RoutineTrigger, type Routine } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import {
  checkRoutineCreationCaps,
  DEFAULT_ROUTINE_LIMITS,
  RoutineScheduler,
  type RoutineOrchestrator,
} from "@openbot/routines";
import type {
  CreateRoutineInput,
  RunRoutineInput,
  SessionContext,
  ToolResult,
  UpdateRoutineInput,
} from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpRoutineService } from "./interfaces.js";

/**
 * Real `McpRoutineService` backed by the store and WS12 {@link RoutineOrchestrator}.
 * Replaces the in-memory `FakeRoutineService`.
 */
export class McpRoutineServiceAdapter implements McpRoutineService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly orchestrator: RoutineOrchestrator,
  ) {}

  async createRoutine(
    session: SessionContext,
    input: CreateRoutineInput,
  ): Promise<ToolResult<{ routineId: string; dryRunQueued: boolean }>> {
    const botId = input.botId && session.isChiefOfStaff ? input.botId : session.botId;
    const capCheck = checkRoutineCreationCaps(this.ctx, botId);
    if (!capCheck.allowed) {
      return refused(capCheck.reason);
    }

    const triggerParsed = RoutineTrigger.safeParse(input.trigger);
    if (!triggerParsed.success) {
      return refused(`invalid trigger: ${triggerParsed.error.message}`);
    }
    if (
      triggerParsed.data.type === "schedule" &&
      !RoutineScheduler.validateScheduleInterval(triggerParsed.data)
    ) {
      return refused("schedule interval below 15 minute minimum");
    }

    const limitsParsed = input.limits
      ? RoutineLimits.safeParse(input.limits)
      : { success: true as const, data: DEFAULT_ROUTINE_LIMITS };
    if (!limitsParsed.success) {
      return refused(`invalid limits: ${limitsParsed.error.message}`);
    }

    const routine: Routine = {
      id: newId("routine"),
      botId,
      name: input.name,
      prompt: input.prompt,
      createdBy: session.botId,
      enabled: true,
      liveApproved: false,
      trigger: triggerParsed.data,
      limits: limitsParsed.data,
      consecutiveFailures: 0,
      createdAt: this.ctx.clock.now().toISOString(),
    };

    this.ctx.repos.routines.create(routine);
    await this.ctx.eventBus.publish({
      type: "routine.created",
      botId: routine.botId,
      payload: { routine },
    });

    this.orchestrator.onRoutineCreated(routine);
    return allowed({ routineId: routine.id, dryRunQueued: true });
  }

  async listRoutines(session: SessionContext): Promise<ToolResult<{ routines: unknown[] }>> {
    const routines = session.isChiefOfStaff
      ? this.ctx.repos.routines.list()
      : this.ctx.repos.routines.listByBot(session.botId);
    return allowed({ routines });
  }

  async updateRoutine(
    session: SessionContext,
    input: UpdateRoutineInput,
  ): Promise<ToolResult<{ routineId: string }>> {
    const routine = this.ctx.repos.routines.getById(input.id);
    if (!routine) return refused("routine not found");
    if (!session.isChiefOfStaff && routine.botId !== session.botId) {
      return refused("not your routine");
    }

    const patch = input.patch;
    if (patch.limits && typeof patch.limits === "object") {
      const parsed = RoutineLimits.safeParse(patch.limits);
      if (!parsed.success) return refused(`invalid limits: ${parsed.error.message}`);
      if (
        parsed.data.perRun.usd > DEFAULT_ROUTINE_LIMITS.perRun.usd ||
        parsed.data.dailyUsd > DEFAULT_ROUTINE_LIMITS.dailyUsd
      ) {
        return refused("cannot raise limits above defaults");
      }
    }

    this.ctx.repos.routines.update(input.id, patch as Partial<Routine>);
    const updated = this.ctx.repos.routines.getById(input.id)!;
    await this.ctx.eventBus.publish({
      type: "routine.updated",
      botId: updated.botId,
      payload: { id: input.id, patch },
    });
    this.orchestrator.onRoutineUpdated(updated);
    return allowed({ routineId: input.id });
  }

  async runRoutine(
    session: SessionContext,
    input: RunRoutineInput,
  ): Promise<ToolResult<{ runId: string; dryRun: boolean }>> {
    const routine = this.ctx.repos.routines.getById(input.id);
    if (!routine) return refused("routine not found");
    if (!session.isChiefOfStaff && routine.botId !== session.botId) {
      return refused("not your routine");
    }

    const dryRun = input.dryRun ?? false;
    const result = await this.orchestrator.queueRun(routine.id, "manual", {
      dryRun,
      test: !dryRun,
    });

    if ("skipped" in result) {
      return refused(result.reason);
    }

    return allowed({ runId: result.id, dryRun: result.dryRun });
  }
}
