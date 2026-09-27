import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPwaStaticRoot } from "./index.js";

describe("@openbot/pwa", () => {
  it("ships the built WS5 UI shell", async () => {
    const root = getPwaStaticRoot();
    const html = await readFile(join(root, "index.html"), "utf8");
    expect(html).toContain('id="root"');
    expect(html).toMatch(/\/app\/assets\/.+\.js/);
  });
});
