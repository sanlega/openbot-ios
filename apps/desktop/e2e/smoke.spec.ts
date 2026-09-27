import { test, expect, _electron as electron } from "@playwright/test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test.describe("OpenBot desktop shell", () => {
  test("shows harness connected and survives window close", async () => {
    const app = await electron.launch({
      args: [desktopRoot],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });

    const window = await app.firstWindow();
    await expect(window.locator("#harness-status")).toContainText("Harness connected", {
      timeout: 20_000,
    });

    await window.close();
    expect(app.windows().length).toBe(0);

    await app.close();
  });
});
