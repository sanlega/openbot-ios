import type { ShellExec } from "./types.js";
import { normalizeElements, type ObservationResult } from "./types.js";

/** AT-SPI fallback on Linux when CDP AX tree is sparse (plan WS9: AX via AT-SPI). */
export async function observeAtspi(shell: ShellExec, display: string): Promise<ObservationResult> {
  const script = `
import json
try:
    import pyatspi
except ImportError:
    print(json.dumps([]))
    raise SystemExit(0)
desktop = pyatspi.Registry.getDesktop(0)
items = []
for app in desktop:
    for i, child in enumerate(app):
        try:
            name = child.name or ''
            role = child.getRoleName() or 'unknown'
        except Exception:
            continue
        if not name:
            continue
        items.append({'role': role, 'label': name[:120]})
        if len(items) >= 80:
            break
    if len(items) >= 80:
        break
print(json.dumps(items))
`;

  const result = await shell.run("python3", ["-c", script], { ...process.env, DISPLAY: display });
  if (result.code !== 0) {
    return normalizeElements([]);
  }

  let parsed: Array<{ role: string; label: string }> = [];
  try {
    parsed = JSON.parse(result.stdout.trim() || "[]") as Array<{ role: string; label: string }>;
  } catch {
    parsed = [];
  }

  const observation = normalizeElements(parsed);
  observation.url = "local://atspi";
  observation.title = "AT-SPI desktop";
  observation.source = "ax";
  return observation;
}
