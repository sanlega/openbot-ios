import { test, expect } from "@playwright/test";
import { FakeJevServer } from "@openbot/decisions";
import {
  api,
  callTool,
  connectWs,
  createBot,
  sessionTokenFor,
  startTestHarness,
  type TestHarness,
} from "../src/harness.js";

const JEV_KEY = "ts_e2e_key";

interface ToolOutcome {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
  bot?: { id: string };
  delivery?: string;
}

function spawnRequest(name: string, userRequested: boolean) {
  return {
    name,
    description: `${name} owns one recurring area`,
    responsibility: `keep ${name} up to date every week`,
    why_not_existing: "no bot owns this area",
    lifetime: "recurring",
    boundary: [name.toLowerCase()],
    user_requested: userRequested,
  };
}

/** Runs the harness against a scripted HTTP Jev, so the real DecisionService and gates run. */
async function withScriptedJev(
  run: (
    jev: FakeJevServer,
    harness: () => TestHarness,
    restart: () => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const jev = new FakeJevServer({ apiKey: JEV_KEY });
  const { url } = await jev.listen();
  const target = { kind: "http" as const, url, apiKey: JEV_KEY };
  let harness = await startTestHarness({ jev: target });
  const home = harness.home;
  try {
    await run(
      jev,
      () => harness,
      async () => {
        await harness.stop();
        harness = await startTestHarness({ home, jev: target });
      },
    );
  } finally {
    await harness.close();
    await jev.close();
  }
}

test.describe("M2 Selective team (real gates, scripted Jev)", () => {
  test("the CoS spawns only when justified, and the third spawn in 24 h is refused", async () => {
    await withScriptedJev(async (jev, harness, restart) => {
      // Caps are read at startup: allow back-to-back spawns so S2 is what refuses.
      await api(harness(), "/api/settings", {
        method: "PUT",
        body: { caps: { s3_spawnCooldownMin: 0 } },
      });
      await restart();

      const { bot: cos } = await createBot(harness(), {
        name: "Chief of Staff",
        description: "runs the team",
        isChiefOfStaff: true,
        routing: { mode: "pinned", engine: "fake" },
      });
      const token = await sessionTokenFor(harness(), { botId: cos.id });

      // Jev is unsure (all 0.5): a spawn the user did not ask for is refused.
      const unjustified = await callTool<ToolOutcome>(
        harness(),
        token,
        "create_bot",
        spawnRequest("Newsletter", false),
      );
      expect(unjustified.allowed).toBe(false);
      expect(unjustified.reason).toContain("spawn denied");

      jev.scriptedAnswers.user_requested = { type: "noul", noul: 0.95 };
      const first = await callTool<ToolOutcome>(
        harness(),
        token,
        "create_bot",
        spawnRequest("Travel", true),
      );
      const second = await callTool<ToolOutcome>(
        harness(),
        token,
        "create_bot",
        spawnRequest("Finance", true),
      );
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);

      const why = await api<{ justification?: { responsibility: string; userRequested: boolean } }>(
        harness(),
        `/api/bots/${first.bot!.id}/why`,
      );
      expect(why.body.justification).toMatchObject({
        responsibility: "keep Travel up to date every week",
        userRequested: true,
      });

      const third = await callTool<ToolOutcome>(
        harness(),
        token,
        "create_bot",
        spawnRequest("Health", true),
      );
      expect(third).toMatchObject({ allowed: false, suggestion: "cos_itself" });
      expect(third.reason).toContain("daily spawn cap");
    });
  });

  test("progress chatter is held; a final result is delivered", async () => {
    await withScriptedJev(async (jev, harness) => {
      const { bot, thread } = await createBot(harness(), {
        name: "Researcher",
        description: "researches things",
        routing: { mode: "pinned", engine: "fake" },
      });
      const ws = await connectWs(harness());
      const { chainId } = await ws.command<{ chainId: string }>("message.send", {
        botId: bot.id,
        text: "research flights to Lisbon",
      });
      ws.close();
      const token = await sessionTokenFor(harness(), { botId: bot.id, chainId });

      // Default fake answers (0.5 everywhere) do not clear the notify bar: the
      // message is logged as held (a structured outcome, not an error).
      const chatter = await callTool<ToolOutcome>(harness(), token, "message_user", {
        kind: "result",
        body: "still looking at options...",
      });
      expect(chatter).toMatchObject({ allowed: true, delivery: "held" });

      jev.scriptedAnswers.is_final_result = { type: "noul", noul: 0.95 };
      jev.scriptedAnswers.is_duplicate_or_noise = { type: "noul", noul: 0.05 };
      const result = await callTool<ToolOutcome>(harness(), token, "message_user", {
        kind: "result",
        body: "Cheapest: TAP, 7 Oct, 89 EUR",
      });
      expect(result).toMatchObject({ allowed: true, delivery: "delivered" });

      const messages = await api<{ messages: Array<{ text: string; proactive: boolean }> }>(
        harness(),
        `/api/threads/${thread.id}/messages?delivery=delivered`,
      );
      const proactive = messages.body.messages.filter((m) => m.proactive).map((m) => m.text);
      expect(proactive).toEqual(["Cheapest: TAP, 7 Oct, 89 EUR"]);

      // Held messages only show under the activity log's "Not delivered" filter.
      const held = await api<{ messages: Array<{ text: string }> }>(
        harness(),
        `/api/threads/${thread.id}/messages?delivery=held`,
      );
      expect(held.body.messages.map((m) => m.text)).toEqual(["still looking at options..."]);
    });
  });
});
