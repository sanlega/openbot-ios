import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPwaStaticRoot } from "./index.js";

describe("@openbot/pwa", () => {
  it("ships installable static assets", async () => {
    const root = getPwaStaticRoot();
    const html = await readFile(join(root, "index.html"), "utf8");
    const manifest = await readFile(join(root, "manifest.webmanifest"), "utf8");
    expect(html).toContain("manifest.webmanifest");
    expect(JSON.parse(manifest).display).toBe("standalone");
  });
});
