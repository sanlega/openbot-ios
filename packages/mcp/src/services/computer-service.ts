import { newId } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { createComputerAgent, type ComputerAgentImpl } from "@openbot/computer";
import type { ComputerTaskInput, SessionContext, ToolResult } from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpComputerService } from "./interfaces.js";

export class McpComputerServiceAdapter implements McpComputerService {
  private agent: ComputerAgentImpl | undefined;

  constructor(private readonly ctx: CoreContext) {}

  async computerTask(
    session: SessionContext,
    input: ComputerTaskInput,
  ): Promise<ToolResult<{ taskId: string; status: string; steps: number }>> {
    if (session.mode === "dry_run") {
      return allowed({ taskId: newId("computerTask"), status: "simulated", steps: 0 });
    }
    if (!this.ctx.computerProvider) return refused("no computer provider wired");
    if (!this.ctx.decisionService) return refused("no decision service wired");

    const taskId = newId("computerTask");
    const providerId = this.ctx.computerProvider.id as "docker" | "local" | "fake";
    const now = this.ctx.clock.now().toISOString();
    this.ctx.repos.computerTasks.create({
      id: taskId,
      botId: session.botId,
      chainId: session.chainId,
      goal: input.goal,
      provider: providerId,
      status: "running",
      steps: 0,
      usd: 0,
      createdAt: now,
    });

    const result = await this.getAgent().runTask({
      botId: session.botId,
      chainId: session.chainId,
      goal: input.goal,
      startUrl: input.startUrl,
      maxSteps: input.maxSteps,
      provider: providerId,
    });

    const status =
      result.status === "completed"
        ? "completed"
        : result.status === "escalated"
          ? "escalated"
          : "failed";
    this.ctx.repos.computerTasks.update(taskId, {
      status,
      steps: result.steps,
      usd: result.usd,
    });

    return allowed({ taskId, status, steps: result.steps });
  }

  async computerScreenshot(
    session: SessionContext,
  ): Promise<ToolResult<{ screenshotPath: string }>> {
    if (!this.ctx.computerProvider) return refused("no computer provider wired");
    await this.ctx.computerProvider.ensureStarted();
    const screen = await this.ctx.computerProvider.screen(session.botId);
    const observation = await screen.observe();
    return allowed({
      screenshotPath: observation.screenshotPath ?? `/screens/${session.botId}/latest.png`,
    });
  }

  private getAgent(): ComputerAgentImpl {
    if (!this.agent) {
      if (!this.ctx.decisionService || !this.ctx.computerProvider) {
        throw new Error("computer agent requires decisionService and computerProvider");
      }
      this.agent = createComputerAgent(this.ctx.decisionService, [this.ctx.computerProvider], {
        defaultProvider: this.ctx.computerProvider.id,
      });
    }
    return this.agent;
  }
}
