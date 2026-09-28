import type { Action, ActResult, Observation } from "@openbot/contracts";
import type { LocalDriver, ShellRunner } from "./driver-types.js";

/** macOS driver via osascript + System Events accessibility (plan WS9). */
export class DarwinLocalDriver implements LocalDriver {
  readonly platform = "darwin" as const;
  private lastElements: Observation["elements"] = [];

  constructor(private readonly shell: ShellRunner) {}

  async observe(): Promise<Observation> {
    const script = `
      set elementList to {}
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        repeat with uiElem in entire contents of frontApp
          try
            set elemName to name of uiElem
            set elemRole to role of uiElem
            if elemName is not missing value and elemName is not "" then
              set end of elementList to (elemRole as string) & "|" & elemName
            end if
          end try
        end repeat
      end tell
      return (appName as string) & "\\n" & (elementList as string)
    `;
    const result = await this.shell.run("osascript", ["-e", script]);
    const lines = result.stdout.trim().split("\n");
    const title = lines[0]?.trim() || "macOS desktop";
    const raw = lines.slice(1).join("\n");
    const tokens = raw.replace(/,\s/g, "\n").split("\n").filter(Boolean).slice(0, 40);
    const elements = tokens.map((token, index) => {
      const [role, label] = token.split("|");
      return { index, role: role?.trim() || "element", label: label?.trim() || token };
    });
    this.lastElements = elements;
    return { url: "local://macos", title, elements };
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
        await this.shell.run("osascript", [
          "-e",
          `tell application "System Events" to keystroke ${appleScriptString(action.text)}`,
        ]);
        return { ok: true };
      case "key":
        {
          const code = MAC_KEY_CODES[action.text ?? ""];
          if (code === undefined) return { ok: false, reason: `unknown key: ${action.text}` };
          await this.shell.run("osascript", [
            "-e",
            `tell application "System Events" to key code ${code}`,
          ]);
        }
        return { ok: true };
      case "wait":
      case "scroll":
      case "done":
        return { ok: true };
      default:
        return { ok: false, reason: `unsupported op: ${action.op}` };
    }
  }

  private async click(target: number | undefined): Promise<ActResult> {
    if (target === undefined) return { ok: false, reason: "click requires target" };
    const element = this.lastElements[target];
    if (!element) return { ok: false, reason: `unknown target ${target}` };
    const escaped = element.label.replace(/"/g, '\\"');
    const script = `
      tell application "System Events"
        tell (first application process whose frontmost is true)
          click (first UI element whose name is "${escaped}")
        end tell
      end tell
    `;
    const result = await this.shell.run("osascript", ["-e", script]);
    if (result.code !== 0) return { ok: false, reason: result.stderr || "osascript click failed" };
    return { ok: true };
  }
}

/** Logical key names (see COMPUTER_KEYS) → macOS virtual key codes. */
const MAC_KEY_CODES: Record<string, number> = { Enter: 36, Return: 36, Tab: 48, Escape: 53 };

/** An AppleScript string literal: backslashes and quotes escaped, so typed text can't break out. */
export function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
