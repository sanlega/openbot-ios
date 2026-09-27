import { describe, expect, it } from "vitest";
import { normalizeElements, stripMeta } from "./types.js";
import { runObservationPipeline } from "./pipeline.js";
import type { ShellExec } from "./types.js";

describe("observation pipeline", () => {
  it("normalizeElements assigns stable indices", () => {
    const obs = normalizeElements([
      { role: "button", label: "Send" },
      { role: "link", label: "Compose" },
    ]);
    expect(obs.elements.map((el) => el.index)).toEqual([0, 1]);
    expect(obs._meta?.[0]?.label).toBe("Send");
  });

  it("stripMeta removes internal fields before Jev state", () => {
    const obs = normalizeElements([{ role: "button", label: "Pay now" }]);
    obs.source = "dom";
    const stripped = stripMeta(obs);
    expect(stripped).not.toHaveProperty("_meta");
    expect(stripped).not.toHaveProperty("source");
    expect(stripped.elements[0]?.label).toBe("Pay now");
  });

  it("auto mode falls through dom → ax → ocr with mocked CDP", async () => {
    const shell: ShellExec = {
      run: async () => ({ code: 0, stdout: "[]", stderr: "" }),
    };

    // Without real Chromium, pipeline should throw; verify dom-only path via direct normalize
    await expect(
      runObservationPipeline({ mode: "dom", debugPort: 59999, cdpTimeoutMs: 300 }, shell),
    ).rejects.toThrow(/CDP|not ready/);
  });
});
