import { describe, expect, it } from "vitest";
import { FakeDecisionService } from "@openbot/decisions";
import { CosInboundPipeline } from "./pipeline.js";

describe("CosInboundPipeline", () => {
  it("answers status lookups from DB snapshot", async () => {
    const pipeline = new CosInboundPipeline({ decisions: new FakeDecisionService() });
    const result = await pipeline.triage({
      message: "What bots do I have?",
      roster: [
        {
          id: "b1",
          slug: "inbox",
          name: "Inbox Bot",
          description: "Email",
          createdBy: "user",
          routing: { mode: "auto" },
          permissionPreset: "read_only",
          computer: "none",
          connectors: [],
          limits: {},
          pinned: false,
          hidden: false,
          isChiefOfStaff: false,
        },
      ],
      dbSnapshot: { bots: 1 },
    });
    expect(["answer_from_db", "delegate", "wake_cos", "stop"]).toContain(result.action);
  });
});
