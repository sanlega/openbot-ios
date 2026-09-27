import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@openbot/core placeholder", () => {
  it("exports its package name as a build/import smoke test", () => {
    expect(PACKAGE_NAME).toBe("@openbot/core");
  });
});
