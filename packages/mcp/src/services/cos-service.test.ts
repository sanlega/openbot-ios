import { afterEach, describe, expect, it } from "vitest";
import type { DecisionService } from "@openbot/contracts";
import {
  CapCounterService,
  DEFAULT_AUTONOMY_CAPS,
  NotifyGate,
  SpawnGate,
  type AutonomyCaps,
} from "@openbot/cos";
import type { Runtime } from "@openbot/runtime";
import { createMcpTestHarness, makeBot } from "../test-helpers.js";
import type { SessionContext } from "../types.js";
import { McpCosServiceAdapter } from "./cos-service.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

/** Jev stub: the user asked for each bot, so only the S1–S3 caps can refuse. */
const userRequestedJev: DecisionService = {
  async decide() {
    return {
      answers: {
        route: { type: "choice", choice: "new_bot", confidence: 0.95, probabilities: {} },
        user_requested: { type: "noul", noul: 0.95 },
      },
      provider: "heuristic",
      model: "stub",
      latencyMs: 0,
      decisionId: "dec_stub",
    };
  },
  route: async () => ({ engine: "fake", model: "fake", band: "auto", decisionId: "dec_stub" }),
  band: () => "auto",
  budgets: () => ({
    gates: { limitRpm: 0, usedRpm: 0, queued: 0 },
    interactive: { limitRpm: 0, usedRpm: 0, queued: 0 },
    computer: { limitRpm: 0, usedRpm: 0, queued: 0 },
    background: { limitRpm: 0, usedRpm: 0, queued: 0 },
  }),
  validateKey: async () => ({ ok: true }),
};

async function setup(autonomyCaps: AutonomyCaps) {
  harness = await createMcpTestHarness();
  const caps = new CapCounterService(harness.clock);
  const adapter = new McpCosServiceAdapter(harness.ctx, {
    spawnGate: new SpawnGate({ decisions: userRequestedJev, caps, autonomyCaps }),
    notifyGate: new NotifyGate({ decisions: userRequestedJev, caps, autonomyCaps }),
    runtime: {} as Runtime,
    caps,
  });
  const cos = makeBot({ name: "Chief", slug: "chief", isChiefOfStaff: true });
  harness.ctx.repos.bots.create(cos);
  const session: SessionContext = {
    botId: cos.id,
    turnId: "turn_test",
    chainId: "chn_test",
    mode: "live",
    exp: Number.MAX_SAFE_INTEGER,
    bot: cos,
    isChiefOfStaff: true,
  };
  let n = 0;
  const createBot = () =>
    adapter.createBot(session, {
      name: `Helper ${++n}`,
      description: "helps",
      responsibility: "r",
      why_not_existing: "w",
      lifetime: "recurring",
      boundary: [],
      user_requested: true,
    });
  return { clock: harness.clock, createBot };
}

describe("McpCosServiceAdapter.createBot caps", () => {
  it("allows two spawns per 24 h (S2) and refuses the third", async () => {
    const { clock, createBot } = await setup({ ...DEFAULT_AUTONOMY_CAPS, spawnCooldownMin: 0 });

    expect((await createBot()).allowed).toBe(true);
    clock.advance(60_000);
    expect((await createBot()).allowed).toBe(true);
    clock.advance(60_000);
    const third = await createBot();
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.reason).toContain("daily spawn cap");

    clock.advance(24 * 60 * 60_000);
    expect((await createBot()).allowed).toBe(true);
  });

  it("does not count refused attempts against the daily cap", async () => {
    const { clock, createBot } = await setup(DEFAULT_AUTONOMY_CAPS);

    expect((await createBot()).allowed).toBe(true);
    // Refused by the S3 cooldown, several times.
    for (let i = 0; i < 3; i++) {
      const refused = await createBot();
      expect(refused.allowed).toBe(false);
      if (!refused.allowed) expect(refused.reason).toContain("cooldown");
    }
    clock.advance(DEFAULT_AUTONOMY_CAPS.spawnCooldownMin * 60_000);
    expect((await createBot()).allowed).toBe(true);
  });

  it("enforces the spawn cooldown (S3) against the current time", async () => {
    const { clock, createBot } = await setup(DEFAULT_AUTONOMY_CAPS);

    expect((await createBot()).allowed).toBe(true);
    clock.advance(29 * 60_000);
    expect((await createBot()).allowed).toBe(false);
    clock.advance(60_000);
    expect((await createBot()).allowed).toBe(true);
  });
});
