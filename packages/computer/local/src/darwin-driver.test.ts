import { describe, expect, it } from "vitest";
import { appleScriptString } from "./darwin-driver.js";

describe("appleScriptString", () => {
  it("escapes quotes and backslashes so typed text stays a literal", () => {
    expect(appleScriptString('say "hi"')).toBe('"say \\"hi\\""');
    expect(appleScriptString('a\\" & do shell script "x')).toBe(
      '"a\\\\\\" & do shell script \\"x"',
    );
  });
});
