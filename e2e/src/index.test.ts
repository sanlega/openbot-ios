import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@openbot/e2e placeholder", () => {
  it("exports its package name as a build/import smoke test", () => {
    expect(PACKAGE_NAME).toBe("@openbot/e2e");
  });
});
