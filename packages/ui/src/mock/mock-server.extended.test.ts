// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockClientApiServer } from "./mock-server.js";

describe("MockClientApiServer extended endpoints", () => {
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

  it("serves computer live view and takeover", async () => {
    const live = await fetch(`${baseUrl}/api/computer/screens/bot_code_01/live`).then((r) => r.json());
    expect(live.url).toContain("novnc");

    const takeover = await fetch(`${baseUrl}/api/computer/screens/bot_code_01/takeover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    }).then((r) => r.json());
    expect(takeover.takeover).toBe(true);
  });

  it("runs routine dry run and enable live", async () => {
    const dry = await fetch(`${baseUrl}/api/routines/rtn_summary/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    }).then((r) => r.json());
    expect(dry.dryRun).toBe(true);
    expect(dry.plannedActions?.length).toBeGreaterThan(0);

    const enabled = await fetch(`${baseUrl}/api/routines/rtn_summary/enable-live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    expect(enabled.routine.liveApproved).toBe(true);
  });

  it("patches settings and serves devices/remote", async () => {
    const patched = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caps: { S1: 8 } }),
    }).then((r) => r.json());
    expect(patched.settings.caps.S1).toBe(8);

    const devices = await fetch(`${baseUrl}/api/devices`).then((r) => r.json());
    expect(devices.devices.length).toBeGreaterThan(0);

    const digest = await fetch(`${baseUrl}/api/digest`).then((r) => r.json());
    expect(digest.digest.sections.length).toBeGreaterThan(0);
  });
});
