import { describe, expect, it } from "vitest";
import { FakeTriggerSource } from "./fake-trigger-source.js";
import { FakeClock } from "./fake-clock.js";

describe("FakeTriggerSource", () => {
  it("push() before start() is a no-op", () => {
    const source = new FakeTriggerSource("test");
    expect(source.push({ hello: "world" })).toBeUndefined();
  });

  it("delivers pushed payloads to the registered listener after start()", async () => {
    const source = new FakeTriggerSource("test", new FakeClock(new Date("2026-01-01T00:00:00Z")));
    const received: unknown[] = [];
    await source.start((e) => received.push(e));

    const event = source.push({ foo: "bar" });

    expect(event).toBeDefined();
    expect(received).toEqual([event]);
    expect(event?.source).toBe("test");
    expect(event?.receivedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("assigns a stable, deterministic payloadHash for identical payloads", async () => {
    const source = new FakeTriggerSource("test");
    await source.start(() => {});
    const a = source.push({ same: true });
    const b = source.push({ same: true });
    expect(a?.payloadHash).toBe(b?.payloadHash);
  });

  it("stop() halts delivery until start() is called again", async () => {
    const source = new FakeTriggerSource("test");
    const received: unknown[] = [];
    await source.start((e) => received.push(e));
    await source.stop();

    expect(source.push({ x: 1 })).toBeUndefined();
    expect(received).toHaveLength(0);
  });
});
