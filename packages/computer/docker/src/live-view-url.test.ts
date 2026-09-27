import { describe, expect, it } from "vitest";
import { createLiveViewUrl } from "./live-view-url.js";

describe("createLiveViewUrl", () => {
  it("scales the desktop into the viewer and requests high color quality", () => {
    const url = new URL(createLiveViewUrl(6080, "short-lived-token"));

    expect(url.origin).toBe("http://127.0.0.1:6080");
    expect(url.pathname).toBe("/vnc.html");
    expect(url.searchParams.get("autoconnect")).toBe("1");
    expect(url.searchParams.get("path")).toBe("websockify?token=short-lived-token");
    expect(url.searchParams.get("resize")).toBe("scale");
    expect(url.searchParams.get("quality")).toBe("9");
  });
});
