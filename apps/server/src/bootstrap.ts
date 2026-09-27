import type { Approval, Chain, ComputerProvider, Message, Rule, Turn } from "@openbot/contracts";
import { newId, type Clock } from "@openbot/contracts";
import { wireConnectors } from "@openbot/connectors";
import type { CoreContext, TurnMailbox } from "@openbot/core";
import {
  CapCounterService,
  DEFAULT_AUTONOMY_CAPS,
  DigestService,
  NotifyGate as CosNotifyGate,
  SpawnGate,
  type AutonomyCaps,
} from "@openbot/cos";
import { createMcpServices, integrateMcp } from "@openbot/mcp";
import { getPwaStaticRoot } from "@openbot/pwa";
import { attachRemoteServices, registerRemoteIntegration } from "@openbot/remote";
import { integrateRoutines, RoutineRuntimeAdapter } from "@openbot/routines";
import {
  createRuntime,
  type ApprovalStore,
  type ChainStore,
  type EventSink,
  type MessageStore,
  type NotifyGate as RuntimeNotifyGate,
  type NotifyRequest,
  type NotifyResult,
  type RuleStore,
  type Runtime,
  type SchedulingClock,
  type TurnStore,
} from "@openbot/runtime";
import type { FastifyInstance } from "fastify";
import { bootstrapProviders } from "./providers.js";

export interface BootstrapOptions {
  computerProvider?: ComputerProvider;
}

export interface BootstrapResult {
  runtime: Runtime;
  orchestrator: Awaited<ReturnType<typeof integrateRoutines>>["orchestrator"];
  mcpServices: ReturnType<typeof createMcpServices>;
  digest: DigestService;
  availableEngines: string[];
}

export async function bootstrapHarness(
  ctx: CoreContext,
  app: FastifyInstance,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const providers = await bootstrapProviders(ctx);
  ctx.decisionService = providers.decisionService;

  const autonomyCaps = loadAutonomyCaps(ctx);
  const caps = new CapCounterService(ctx.clock);
  const spawnGate = new SpawnGate({ decisions: providers.decisionService, caps, autonomyCaps });
  const cosNotifyGate = new CosNotifyGate({ decisions: providers.decisionService, caps, autonomyCaps });
  const runtimeNotify = new CosNotifyGateAdapter(ctx, cosNotifyGate, caps, autonomyCaps);

  const events = createCoreEventSink(ctx);
  const runtime = createRuntime({
    decisions: providers.decisionService,
    drivers: providers.drivers,
    notify: runtimeNotify,
    clock: schedulingClock(ctx.clock),
    events,
    chainStore: new RepoChainStore(ctx),
    messageStore: new RepoMessageStore(ctx),
    approvalStore: new RepoApprovalStore(ctx),
    turnStore: new RepoTurnStore(ctx),
    ruleStore: new RepoRuleStore(ctx),
  });

  ctx.mailbox = createTurnMailbox(ctx, runtime);
  ctx.computerProvider = options.computerProvider ?? providers.computerProvider;

  await wireConnectors(ctx);
  await attachRemoteServices(ctx);
  await registerRemoteIntegration(app, ctx, getPwaStaticRoot());

  const digest = new DigestService({
    clock: ctx.clock,
    onDigest: (body) => {
      void ctx.eventBus.publish({ type: "digest.posted", payload: { body } });
    },
  });

  const { orchestrator } = await integrateRoutines(app, ctx, {
    runtime: new RoutineRuntimeAdapter(runtime, ctx),
  });

  const mcpServices = createMcpServices(ctx, {
    runtime,
    spawnGate,
    notifyGate: cosNotifyGate,
    caps,
    orchestrator,
  });
  await integrateMcp(app, ctx, { services: mcpServices });

  digest.start();
  return {
    runtime,
    orchestrator,
    mcpServices,
    digest,
    availableEngines: providers.availableEngines,
  };
}

function loadAutonomyCaps(ctx: CoreContext): AutonomyCaps {
  const settings = ctx.repos.settings.get();
  if (!settings) return DEFAULT_AUTONOMY_CAPS;
  const caps = settings.caps;
  return {
    ...DEFAULT_AUTONOMY_CAPS,
    cosCreatedBotsMax: caps.s1_cosBotsCap ?? DEFAULT_AUTONOMY_CAPS.cosCreatedBotsMax,
    newBotsPerDay: caps.s2_newBotsPer24h ?? DEFAULT_AUTONOMY_CAPS.newBotsPerDay,
    spawnCooldownMin: caps.s3_spawnCooldownMin ?? DEFAULT_AUTONOMY_CAPS.spawnCooldownMin,
    proactivePerBotHour: caps.s4_proactivePerBotPerHour ?? DEFAULT_AUTONOMY_CAPS.proactivePerBotHour,
    proactivePerBotDay: caps.s4_proactivePerBotPerDay ?? DEFAULT_AUTONOMY_CAPS.proactivePerBotDay,
    proactiveGlobalHour: caps.s5_proactiveAllBotsPerHour ?? DEFAULT_AUTONOMY_CAPS.proactiveGlobalHour,
    dedupeWindowHours: caps.s6_dedupeWindowHours ?? DEFAULT_AUTONOMY_CAPS.dedupeWindowHours,
    mergeWindowMin: caps.s10_mergeWindowMin ?? DEFAULT_AUTONOMY_CAPS.mergeWindowMin,
    quietHours: settings.quietHours,
  };
}

function schedulingClock(clock: Clock): SchedulingClock {
  return {
    now: () => clock.now(),
    setTimeout: (fn, delayMs) => setTimeout(fn, delayMs) as unknown as number,
    clearTimeout: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  };
}

function createCoreEventSink(ctx: CoreContext): EventSink {
  return {
    emit(event) {
      const input = {
        ...event,
        ts: event.ts ?? ctx.clock.now().toISOString(),
      };
      void ctx.eventBus.publish(input);
      return {
        id: event.id ?? newId("event"),
        seq: 0,
        type: input.type,
        ts: input.ts,
        botId: input.botId,
        threadId: input.threadId,
        turnId: input.turnId,
        chainId: input.chainId,
        payload: input.payload ?? {},
      };
    },
  };
}

function createTurnMailbox(ctx: CoreContext, runtime: Runtime): TurnMailbox {
  return {
    enqueue: async (input: {
      botId: string;
      threadId: string;
      chainId: string;
      text: string;
      engine: "claude" | "codex" | "fake";
    }) => {
      const bot = ctx.repos.bots.getById(input.botId);
      if (!bot) return { ok: false, reason: `unknown bot ${input.botId}` };

      let chainId = input.chainId;
      if (!ctx.repos.chains.getById(chainId)) {
        const chain = runtime.chains.create({ origin: "user", mode: "live" });
        chainId = chain.id;
        ctx.repos.chains.create(chain);
      }

      void runtime.mailbox.submit({
        bot,
        text: input.text,
        attachments: [],
        systemPrompt: bot.description,
        cwd: ctx.config.workspaceDir,
        addDirs: [],
        auth: { mode: "api_key", env: {} },
        mcpServers: [],
        permission: bot.permissionPreset,
        allowTools: [],
        denyTools: [],
        model: bot.routing.model ?? "fake-default",
        limits: { maxSteps: 50 },
        engine: input.engine,
        chainId,
        threadId: input.threadId,
      });
      return { ok: true };
    },
    stop: async (turnId: string) => {
      const turn = ctx.repos.turns.getById(turnId);
      if (!turn) return { ok: false, reason: "turn not found" };
      await runtime.mailbox.stop(turn.botId);
      return { ok: true };
    },
    steer: async (turnId: string, text: string) => {
      const turn = ctx.repos.turns.getById(turnId);
      if (!turn) return { ok: false, reason: "turn not found" };
      try {
        await runtime.mailbox.steer(turn.botId, text);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    },
  };
}

class CosNotifyGateAdapter implements RuntimeNotifyGate {
  constructor(
    private readonly ctx: CoreContext,
    private readonly gate: CosNotifyGate,
    private readonly caps: CapCounterService,
    private readonly autonomyCaps: AutonomyCaps,
  ) {}

  async notify(req: NotifyRequest): Promise<NotifyResult> {
    const now = this.ctx.clock.now();
    const settings = this.ctx.repos.settings.get();
    const recentDelivered = this.ctx.repos.messages
      .list({ delivery: "delivered", limit: 50 })
      .filter((message) => message.proactive)
      .map((message) => ({
        dedupeKey: message.dedupeKey,
        body: message.text,
        botId: message.author.id ?? req.botId,
        at: new Date(message.createdAt),
      }));

    const lastFromBot = recentDelivered.find((message) => message.botId === req.botId);
    const result = await this.gate.evaluate({
      botId: req.botId,
      message: {
        kind: req.kind,
        body: req.body,
        options: req.options,
        deadline: req.deadline,
        dedupeKey: req.dedupeKey ?? `${req.botId}:${req.kind}:${req.body.slice(0, 32)}`,
      },
      recentDelivered,
      proactiveCountBotHour: this.caps.peek("notify", `${req.botId}:hour`, 3600),
      proactiveCountBotDay: this.caps.peek("notify", `${req.botId}:day`, 86_400),
      proactiveCountGlobalHour: this.caps.peek("notify", "global:hour", 3600),
      lastMessageFromBotAt: lastFromBot?.at,
      quietHours: settings?.quietHours ?? this.autonomyCaps.quietHours,
      now,
    });

    if (!result.allowed) {
      return { delivery: "held", pushed: false };
    }

    const outcome = result.details?.outcome ?? "delivered";
    const push = result.details?.push ?? false;
    if (outcome === "delivered") {
      this.caps.checkAndIncrement("notify", `${req.botId}:hour`, 3600, this.autonomyCaps.proactivePerBotHour);
      this.caps.checkAndIncrement("notify", `${req.botId}:day`, 86_400, this.autonomyCaps.proactivePerBotDay);
      this.caps.checkAndIncrement("notify", "global:hour", 3600, this.autonomyCaps.proactiveGlobalHour);
    }

    return {
      delivery: outcome,
      pushed: push,
      notifyDecisionId: result.decisionId,
    };
  }
}

class RepoChainStore implements ChainStore {
  constructor(private readonly ctx: CoreContext) {}

  save(chain: Chain): void {
    if (!this.ctx.repos.chains.getById(chain.id)) {
      this.ctx.repos.chains.create(chain);
      return;
    }
    this.ctx.repos.chains.setStatus(chain.id, chain.status);
  }

  get(id: string): Chain | undefined {
    return this.ctx.repos.chains.getById(id);
  }

  list(): Chain[] {
    return this.ctx.repos.chains.list();
  }
}

class RepoMessageStore implements MessageStore {
  constructor(private readonly ctx: CoreContext) {}

  create(input: Omit<Message, "id" | "createdAt">): Message {
    const message: Message = {
      ...input,
      id: newId("message"),
      createdAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.messages.create(message);
    return message;
  }

  list(threadId: string): Message[] {
    return this.ctx.repos.messages.list({ threadId });
  }
}

class RepoApprovalStore implements ApprovalStore {
  constructor(private readonly ctx: CoreContext) {}

  create(input: {
    kind: Approval["kind"];
    botId: string;
    chainId?: string;
    summary: string;
    detail: string;
    risk?: number;
    expiresAt: string;
  }): Approval {
    const approval: Approval = {
      id: newId("approval"),
      kind: input.kind,
      botId: input.botId,
      chainId: input.chainId,
      summary: input.summary,
      detail: input.detail,
      risk: input.risk,
      status: "pending",
      resolution: undefined,
      expiresAt: input.expiresAt,
      createdAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.approvals.create(approval);
    return approval;
  }

  get(id: string): Approval | undefined {
    return this.ctx.repos.approvals.getById(id);
  }

  resolve(id: string, resolution: "allow" | "deny" | "expired"): Approval {
    this.ctx.repos.approvals.resolve(id, resolution);
    const approval = this.ctx.repos.approvals.getById(id);
    if (!approval) throw new Error(`ApprovalStore: unknown approval ${id}`);
    return approval;
  }

  listPending(): Approval[] {
    return this.ctx.repos.approvals.list({ status: "pending" });
  }
}

class RepoTurnStore implements TurnStore {
  constructor(private readonly ctx: CoreContext) {}

  create(input: Omit<Turn, "id" | "createdAt" | "usage" | "status"> & { id?: string }): Turn {
    const turn: Turn = {
      ...input,
      id: input.id ?? newId("turn"),
      status: "queued",
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      createdAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.turns.create(turn);
    return turn;
  }

  update(id: string, patch: Partial<Pick<Turn, "status" | "usage" | "sessionId">>): Turn {
    if (patch.status || patch.usage) {
      this.ctx.repos.turns.updateStatus(id, patch.status ?? "running", patch.usage);
    }
    const turn = this.ctx.repos.turns.getById(id);
    if (!turn) throw new Error(`TurnStore: unknown turn ${id}`);
    return { ...turn, ...patch };
  }

  get(id: string): Turn | undefined {
    return this.ctx.repos.turns.getById(id);
  }
}

class RepoRuleStore implements RuleStore {
  constructor(private readonly ctx: CoreContext) {}

  list(scope: string): Rule[] {
    return this.ctx.repos.rules
      .list()
      .filter((rule) => rule.scope === scope || rule.scope === "global");
  }

  add(rule: Omit<Rule, "id" | "createdAt">): Rule {
    const full: Rule = {
      ...rule,
      id: newId("rule"),
      createdAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.rules.create(full);
    return full;
  }
}
