import {
  detectLocalPlatform,
  MemoryLocalDriver,
  type LocalDriver,
  type ShellRunner,
} from "./driver-types.js";
import { LinuxLocalDriver } from "./linux-driver.js";
import { DarwinLocalDriver } from "./darwin-driver.js";
import { Win32LocalDriver } from "./win32-driver.js";
import { createShellRunner } from "./shell-runner.js";

export * from "./driver-types.js";
export * from "./linux-driver.js";
export * from "./darwin-driver.js";
export * from "./win32-driver.js";
export * from "./shell-runner.js";

export function createLocalDriver(shell?: ShellRunner): LocalDriver {
  const runner = shell ?? createShellRunner();
  const platform = detectLocalPlatform();

  switch (platform) {
    case "linux":
      return new LinuxLocalDriver(runner);
    case "darwin":
      return new DarwinLocalDriver(runner);
    case "win32":
      return new Win32LocalDriver(runner);
    default:
      return new MemoryLocalDriver("unsupported");
  }
}
