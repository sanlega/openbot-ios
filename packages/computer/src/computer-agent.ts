import type {
  ComputerAgent,
  ComputerProvider,
  ComputerTaskRequest,
  ComputerTaskResult,
  DecisionService,
} from "@openbot/contracts";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";
import { runFastLoop } from "./fast-loop.js";

export interface ComputerAgentOptions {
  defaultProvider?: string;
  broker?: ComputerActionBroker;
}

/**
 * Runs the Jev fast loop (plan §4.5 / WS9) on a bot's screen from any
 * registered `ComputerProvider`.
 */
export class ComputerAgentImpl implements ComputerAgent {
  private readonly providers = new Map<string, ComputerProvider>();
  private readonly broker: ComputerActionBroker;

  constructor(
    private readonly decisionService: DecisionService,
    options: ComputerAgentOptions = {},
  ) {
    this.defaultProvider = options.defaultProvider ?? "fake";
    this.broker = options.broker ?? new DefaultComputerActionBroker();
  }

  private readonly defaultProvider: string;

  registerProvider(provider: ComputerProvider): void {
    this.providers.set(provider.id, provider);
  }

  async runTask(task: ComputerTaskRequest): Promise<ComputerTaskResult> {
    const providerId = task.provider ?? this.defaultProvider;
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { status: "failed", steps: 0, usd: 0, summary: `unknown provider: ${providerId}` };
    }

    await provider.ensureStarted();
    const screen = await provider.screen(task.botId);
    const result = await runFastLoop({
      screen,
      decisionService: this.decisionService,
      goal: task.goal,
      botId: task.botId,
      chainId: task.chainId,
      providerId,
      maxSteps: task.maxSteps,
      startUrl: task.startUrl,
      broker: this.broker,
    });

    return {
      status:
        result.status === "takeover"
          ? "escalated"
          : result.status === "cancelled"
            ? "failed"
            : result.status,
      steps: result.steps,
      usd: estimateUsd(result.steps),
      summary: result.summary,
    };
  }
}

/** Rough per-step cost for budgeting (plan WS9 eval target: <$0.01/step). */
function estimateUsd(steps: number): number {
  return steps * 0.000_8;
}

export function createComputerAgent(
  decisionService: DecisionService,
  providers: ComputerProvider[],
  options?: ComputerAgentOptions,
): ComputerAgentImpl {
  const agent = new ComputerAgentImpl(decisionService, options);
  for (const provider of providers) {
    agent.registerProvider(provider);
  }
  return agent;
}
