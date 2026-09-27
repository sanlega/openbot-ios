import { describe, expect, it, afterEach, vi } from "vitest";
import { formatHarnessStatus, fetchHarnessStatus } from "./harness-client.js";

describe("formatHarnessStatus", () => {
  it("shows a connected message with version when connected", () => {
    expect(formatHarnessStatus({ connected: true, version: "0.1.0" })).toBe(
      "Harness connected (v0.1.0)",
    );
  });

  it("shows a plain connected message without a version", () => {
    expect(formatHarnessStatus({ connected: true })).toBe("Harness connected");
  });

  it("shows a disconnected message when not connected", () => {
    expect(formatHarnessStatus({ connected: false })).toBe("Harness disconnected");
  });
});

describe("fetchHarnessStatus", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("formats a successful response from the server", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ connected: true, version: "0.1.0" }), { status: 200 }),
    ) as typeof fetch;

    const text = await fetchHarnessStatus("http://127.0.0.1:4577");
    expect(text).toBe("Harness connected (v0.1.0)");
  });

  it("reports disconnected on a non-ok response", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as typeof fetch;
    const text = await fetchHarnessStatus("http://127.0.0.1:4577");
    expect(text).toBe("Harness disconnected");
  });

  it("reports disconnected on a network error", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const text = await fetchHarnessStatus("http://127.0.0.1:4577");
    expect(text).toBe("Harness disconnected");
  });
});
