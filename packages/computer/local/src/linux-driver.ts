import type { Action, ActResult, Observation } from "@openbot/contracts";
import type { LocalDriver, ShellRunner } from "./driver-types.js";

/** Linux X11 driver: xdotool + optional AT-SPI names (plan WS9). */
export class LinuxLocalDriver implements LocalDriver {
  readonly platform = "linux" as const;
  private lastElements: Observation["elements"] = [];

  constructor(private readonly shell: ShellRunner) {}

  async observe(): Promise<Observation> {
    const ids = await this.shell.run("xdotool", ["search", "--onlyvisible", "--name", ".*"]);
    const windowIds = ids.stdout.trim().split("\n").filter(Boolean).slice(0, 30);
    const elements = [];

    for (let index = 0; index < windowIds.length; index += 1) {
      const id = windowIds[index]!;
      const nameResult = await this.shell.run("xdotool", ["getwindowname", id]);
      const label = nameResult.stdout.trim() || `window-${id}`;
      elements.push({ index, role: "window", label });
    }

    if (elements.length === 0) {
      const atspi = await this.shell.run("python3", [
        "-c",
        `import json
try:
 import pyatspi
 desktop = pyatspi.Registry.getDesktop(0)
 items = []
 for app in desktop:
  for child in app:
   if child.name: items.append({'role': child.getRoleName(), 'label': child.name[:120]})
   if len(items) >= 30: break
  if len(items) >= 30: break
 print(json.dumps(items))
except Exception:
 print('[]')`,
      ]);
      try {
        const parsed = JSON.parse(atspi.stdout.trim() || "[]") as Array<{
          role: string;
          label: string;
        }>;
        for (let index = 0; index < parsed.length; index += 1) {
          elements.push({ index, role: parsed[index]!.role, label: parsed[index]!.label });
        }
      } catch {
        // ignore parse errors
      }
    }

    this.lastElements = elements;
    return { url: "local://x11", title: "Linux desktop", elements };
  }

  async act(action: Action): Promise<ActResult> {
    switch (action.op) {
      case "click":
        return this.click(action.target);
      case "type":
        if (!action.text) return { ok: false, reason: "type requires text" };
        // Focus the chosen field first; otherwise the text goes wherever focus is.
        if (action.target !== undefined) {
          const focused = await this.click(action.target);
          if (!focused.ok) return focused;
        }
        await this.shell.run("xdotool", ["type", "--", action.text]);
        return { ok: true };
      case "key":
        if (action.text) await this.shell.run("xdotool", ["key", xdotoolKey(action.text)]);
        return { ok: true };
      case "scroll":
        await this.shell.run("xdotool", [
          "click",
          "--repeat",
          "5",
          action.text === "up" ? "4" : "5",
        ]);
        return { ok: true };
      case "wait":
      case "done":
        return { ok: true };
      case "navigate":
        return { ok: false, reason: "navigate not supported on local Linux driver" };
      default:
        return { ok: false, reason: `unsupported op: ${action.op}` };
    }
  }

  private async click(target: number | undefined): Promise<ActResult> {
    if (target === undefined) return { ok: false, reason: "click requires target" };
    const element = this.lastElements[target] ?? (await this.observe()).elements[target];
    if (!element) return { ok: false, reason: `unknown target ${target}` };
    const match = element.label.match(/^window-(\d+)$/);
    if (match) {
      await this.shell.run("xdotool", ["windowactivate", match[1]!, "click", "1"]);
      return { ok: true };
    }
    await this.shell.run("xdotool", ["key", "Return"]);
    return { ok: true };
  }
}

/** Logical key names (see COMPUTER_KEYS) → xdotool key names. */
function xdotoolKey(name: string): string {
  return name === "Enter" ? "Return" : name;
}
