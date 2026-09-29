import { describe, expect, it } from "vitest";
import { bareFrame } from "./frames";

describe("bareFrame", () => {
  it("unwraps JSON-quoted frames from older desktop builds", () => {
    expect(bareFrame('"QqPo+/k="')).toBe("QqPo+/k=");
  });

  it("leaves bare frames and non-JSON text alone", () => {
    expect(bareFrame("QqPo+/k=")).toBe("QqPo+/k=");
    expect(bareFrame('"broken')).toBe('"broken');
    expect(bareFrame('"a"b"')).toBe('"a"b"');
  });
});
