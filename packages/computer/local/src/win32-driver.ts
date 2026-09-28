import type { Action, ActResult, Observation } from "@openbot/contracts";
import type { LocalDriver, ShellRunner } from "./driver-types.js";

/** Windows driver via PowerShell UI Automation (plan WS9). */
export class Win32LocalDriver implements LocalDriver {
  readonly platform = "win32" as const;
  private lastElements: Observation["elements"] = [];

  constructor(private readonly shell: ShellRunner) {}

  async observe(): Promise<Observation> {
    const ps = `
Add-Type -AssemblyName UIAutomationClient
$root = [Windows.Automation.AutomationElement]::RootElement
$cond = New-Object Windows.Automation.PropertyCondition(
  [Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty, $true)
$elements = $root.FindAll([Windows.Automation.TreeScope]::Children, $cond)
$lines = @()
foreach ($el in $elements) {
  $name = $el.Current.Name
  $role = $el.Current.ControlType.ProgrammaticName
  if ($name) { $lines += "$role|$name" }
  if ($lines.Count -ge 40) { break }
}
$lines -join [Environment]::NewLine
`;
    const result = await this.shell.run("powershell", ["-NoProfile", "-Command", ps]);
    const tokens = result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const elements = tokens.map((token, index) => {
      const [role, label] = token.split("|");
      return { index, role: role?.trim() || "element", label: label?.trim() || token };
    });
    this.lastElements = elements;
    return { url: "local://windows", title: "Windows desktop", elements };
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
        await this.shell.run("powershell", [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${action.text.replace(/'/g, "''")}')`,
        ]);
        return { ok: true };
      case "key":
        if (action.text) {
          await this.shell.run("powershell", [
            "-NoProfile",
            "-Command",
            `[System.Windows.Forms.SendKeys]::SendWait('${action.text}')`,
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
    const ps = `
Add-Type -AssemblyName UIAutomationClient
$root = [Windows.Automation.AutomationElement]::RootElement
$cond = New-Object Windows.Automation.PropertyCondition(
  [Windows.Automation.AutomationElement]::NameProperty, '${element.label.replace(/'/g, "''")}')
$el = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
if ($null -eq $el) { exit 2 }
$pattern = $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
$pattern.Invoke()
`;
    const result = await this.shell.run("powershell", ["-NoProfile", "-Command", ps]);
    if (result.code !== 0) return { ok: false, reason: result.stderr || "UIA click failed" };
    return { ok: true };
  }
}
