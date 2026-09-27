import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "@openbot/ui";

describe("@openbot/pwa", () => {
  it("re-exports ui package", () => {
    expect(PACKAGE_NAME).toBe("@openbot/ui");
  });
});
