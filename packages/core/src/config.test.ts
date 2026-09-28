import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveBindHost } from "./config.js";

/**
 * WS1 acceptance: "the harness never listens beyond loopback unless remote
 * access and device auth are on." `resolveBindHost` is the single decision
 * point `openbot serve` calls before `app.listen()` — this pins its truth
 * table so a future change can't silently widen exposure.
 */
describe("resolveBindHost", () => {
  it("binds to loopback by default (no remote access, no device auth)", () => {
    expect(resolveBindHost({ remoteEnabled: false, deviceAuthConfigured: false })).toBe(
      "127.0.0.1",
    );
  });

  it("stays on loopback if only remote access is enabled but no device is paired", () => {
    expect(resolveBindHost({ remoteEnabled: true, deviceAuthConfigured: false })).toBe("127.0.0.1");
  });

  it("stays on loopback if a device is paired but remote access isn't enabled", () => {
    expect(resolveBindHost({ remoteEnabled: false, deviceAuthConfigured: true })).toBe("127.0.0.1");
  });

  it("only binds beyond loopback once both remote access is enabled AND a device is paired", () => {
    expect(resolveBindHost({ remoteEnabled: true, deviceAuthConfigured: true })).toBe("0.0.0.0");
  });
});

describe("loadConfig", () => {
  it("derives every data-dir path under OPENBOT_HOME", () => {
    const home = join("tmp", "example-home");
    const config = loadConfig({ env: { OPENBOT_HOME: home } });
    expect(config.openbotHome).toBe(home);
    expect(config.dbPath.startsWith(home)).toBe(true);
    expect(config.vaultPath.startsWith(home)).toBe(true);
    expect(config.vaultKeyPath.startsWith(home)).toBe(true);
  });

  it("defaults the port to 4577 and respects PORT", () => {
    expect(loadConfig({ env: {} }).port).toBe(4577);
    expect(loadConfig({ env: { PORT: "9000" } }).port).toBe(9000);
  });

  it("lets explicit overrides win over derived values", () => {
    const config = loadConfig({
      env: { OPENBOT_HOME: "/tmp/example-home" },
      overrides: { dbPath: ":memory:" },
    });
    expect(config.dbPath).toBe(":memory:");
    expect(config.openbotHome).toBe("/tmp/example-home");
  });
});

describe("resolveBindHost with LAN access", () => {
  it("listens on the network when the owner allows phones on this Wi-Fi", () => {
    expect(
      resolveBindHost({ remoteEnabled: false, deviceAuthConfigured: false, lanAccess: true }),
    ).toBe("0.0.0.0");
    expect(
      resolveBindHost({ remoteEnabled: false, deviceAuthConfigured: true, lanAccess: false }),
    ).toBe("127.0.0.1");
  });
});
