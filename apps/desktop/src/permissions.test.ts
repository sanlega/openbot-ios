import { describe, expect, it } from "vitest";
import { getLocalComputerPermissions } from "./permissions.js";

describe("getLocalComputerPermissions", () => {
  it("reports macOS media and accessibility status", () => {
    expect(
      getLocalComputerPermissions("darwin", undefined, {
        getMediaAccessStatus: () => "granted",
        isTrustedAccessibilityClient: () => true,
      }),
    ).toEqual({
      screenRecording: "granted",
      accessibilityTrusted: true,
    });
  });

  it("notes Wayland limitations on Linux", () => {
    const status = getLocalComputerPermissions("linux", "wayland");
    expect(status.waylandNote).toContain("Wayland");
  });
});
