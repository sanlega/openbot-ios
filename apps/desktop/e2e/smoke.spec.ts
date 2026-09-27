import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test.describe("OpenBot desktop shell", () => {
  test("loads the WS5 UI and survives window close", async () => {
    const openbotHome = await mkdtemp(join(tmpdir(), "openbot-desktop-e2e-"));

    const app = await electron.launch({
      args: [desktopRoot, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
      env: {
        ...process.env,
        OPENBOT_HOME: openbotHome,
        OPENBOT_FAKE_JEV: "1",
        OPENBOT_FAKE_ENGINES: "1",
        OPENBOT_FAKE_COMPUTER: "1",
        OPENBOT_HARNESS_NODE: "1",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });

    try {
      const window = await app.firstWindow({ timeout: 45_000 });
      await expect(window.getByTestId("setup-wizard")).toBeVisible({ timeout: 30_000 });
      await window.close();
      expect(app.windows().length).toBe(0);
    } finally {
      await app.close();
      await rm(openbotHome, { recursive: true, force: true });
    }
  });
});
