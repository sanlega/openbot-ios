// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockClientApiServer } from "./mock-server.js";

describe("MockClientApiServer", () => {
  let server: MockClientApiServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new MockClientApiServer();
    const info = await server.listen(0);
    baseUrl = info.url;
  });

  afterEach(async () => {
    await server.close();
  });

  it("serves bots and threads", async () => {
    const bots = await fetch(`${baseUrl}/api/bots`).then((r) => r.json());
    expect(bots.bots.length).toBeGreaterThan(0);

    const threads = await fetch(`${baseUrl}/api/threads`).then((r) => r.json());
    expect(threads.threads[0].participantIds).toContain("user");
  });

  it("filters held activity", async () => {
    const res = await fetch(`${baseUrl}/api/activity?delivery=held`).then((r) => r.json());
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.messages.every((m: { delivery?: string }) => m.delivery === "held")).toBe(true);
  });

  it("returns audit entries", async () => {
    const res = await fetch(`${baseUrl}/api/audit`).then((r) => r.json());
    expect(res.approvals.length).toBeGreaterThan(0);
  });

  it("validates setup keys", async () => {
    const bad = await fetch(`${baseUrl}/api/setup/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "typesafe", value: "short" }),
    }).then((r) => r.json());
    expect(bad.result.ok).toBe(false);

    const ok = await fetch(`${baseUrl}/api/setup/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "typesafe", value: "long-enough-key" }),
    }).then((r) => r.json());
    expect(ok.result.ok).toBe(true);
  });
});
