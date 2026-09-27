import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@openbot/ui placeholder", () => {
  it("exports its package name as a build/import smoke test", () => {
    expect(PACKAGE_NAME).toBe("@openbot/ui");
  });
});
