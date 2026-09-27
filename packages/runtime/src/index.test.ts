import { FakeEngineDriver } from "@openbot/engines-fake";
import { FakeDecisionService } from "@openbot/decisions";
import { describe, expect, it } from "vitest";
import { createRuntime } from "./index.js";

describe("createRuntime", () => {
  it("wires every WS2 piece together from fakes alone", () => {
    const runtime = createRuntime({
      decisions: new FakeDecisionService(),
      drivers: { fake: new FakeEngineDriver() },
    });
    expect(runtime.mailbox).toBeDefined();
    expect(runtime.broker).toBeDefined();
    expect(runtime.chains).toBeDefined();
    expect(runtime.delivery).toBeDefined();
    expect(runtime.spendCaps).toBeDefined();
    expect(runtime.capCounters).toBeDefined();
  });
});
