import type { LocalComputerPermissionStatus } from "./types.js";

export interface SystemPreferencesLike {
  getMediaAccessStatus(mediaType: "screen"): string;
  isTrustedAccessibilityClient(prompt: boolean): boolean;
}

/** macOS Screen Recording / Accessibility and Linux Wayland guidance for the local computer provider. */
export function getLocalComputerPermissions(
  platform: NodeJS.Platform,
  sessionType: string | undefined,
  prefs?: SystemPreferencesLike,
): LocalComputerPermissionStatus {
  if (platform === "darwin" && prefs) {
    const screen = prefs.getMediaAccessStatus("screen");
    return {
      screenRecording: screen as LocalComputerPermissionStatus["screenRecording"],
      accessibilityTrusted: prefs.isTrustedAccessibilityClient(false),
    };
  }

  if (platform === "linux" && sessionType === "wayland") {
    return {
      waylandNote:
        "Wayland limits global input capture. The local computer provider may need the xdg-desktop-portal " +
        "and compositor-specific permissions; X11 is the supported Linux target for v1.",
    };
  }

  return {};
}
