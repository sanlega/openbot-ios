import { describe, expect, it } from "vitest";
import { LiveComposioClient } from "./composio/live-client.js";
import { MockComposioClient } from "./composio/mock-client.js";
import { assertNoSecrets, containsLikelySecret, redactSecrets } from "./redaction.js";

describe("redaction", () => {
  it("flags and redacts common secret patterns", () => {
    const raw = "authorization: Bearer composio_test_key_12345678";
    expect(containsLikelySecret(raw)).toBe(true);
    expect(redactSecrets(raw)).not.toContain("composio_test");
  });
});

describe("MockComposioClient", () => {
  it("validates the configured API key", async () => {
    const client = new MockComposioClient("composio_test_key_12345678");
    await expect(client.validateKey("composio_test_key_12345678")).resolves.toEqual({ ok: true });
    await expect(client.validateKey("bad")).resolves.toEqual({ ok: false });
  });
});

describe("LiveComposioClient (opt-in)", () => {
  it.runIf(process.env.OPENBOT_COMPOSIO_LIVE === "1" && !!process.env.COMPOSIO_API_KEY)(
    "validates a real Composio key",
    async () => {
      const client = new LiveComposioClient(process.env.COMPOSIO_API_KEY!);
      const result = await client.validateKey(process.env.COMPOSIO_API_KEY!);
      expect(result.ok).toBe(true);
    },
  );
});

describe("package exports", () => {
  it("does not leak secrets through assertNoSecrets", () => {
    expect(() => assertNoSecrets("safe output", ["leaked_secret_value"])).not.toThrow();
    expect(() => assertNoSecrets("leaked_secret_value", ["leaked_secret_value"])).toThrow();
  });
});
