import { describe, expect, it } from "vitest";
import type { BrokerRequest } from "./broker-types.js";
import { builtinDenyReason, usesHostBrowser } from "./rules.js";

function req(overrides: Partial<BrokerRequest>): BrokerRequest {
  return {
    botId: "bot_a",
    chainId: "chn_a",
    kind: "tool",
    action: "Bash",
    summary: "Permission prompt",
    detail: "",
    computerAccess: "docker",
    ...overrides,
  };
}

const chromeWindows = String.raw`"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless`;

describe("a Bot whose computer is the virtual machine stays off the host's browser", () => {
  it.each([
    [
      "a Playwright connector tool",
      {
        kind: "connector_action" as const,
        action: "browser_navigate",
        summary: "Playwright browser: browser_navigate",
      },
    ],
    ["a browser_* tool from another server", { action: "mcp__x__browser_click" }],
    ["opening a URL from the shell", { args: { command: "start https://example.com" } }],
    ["launching chrome by path", { args: { command: chromeWindows } }],
    [
      "launching msedge after another command",
      { args: { command: "cd x && msedge --new-window" } },
    ],
    ["opening a URL on macOS", { args: { command: "open https://example.com" } }],
    [
      "open -a with a named browser",
      { args: { command: 'open -a "Google Chrome" https://example.com' } },
    ],
    ["cmd /c start", { args: { command: "cmd /c start https://example.com" } }],
    [
      "google-chrome on Linux",
      { args: { command: "google-chrome --headless https://example.com" } },
    ],
    ["chromium", { args: { command: "chromium --no-sandbox" } }],
    ["xdg-open a page", { args: { command: "xdg-open index.html" } }],
    [
      "PowerShell Start-Process",
      { args: { command: "powershell -c Start-Process https://example.com" } },
    ],
    ["python webbrowser", { args: { command: "python -m webbrowser https://example.com" } }],
    ["npx playwright", { args: { command: "npx playwright test" } }],
    ["a shell wrapper", { args: { command: 'sh -c "open https://example.com"' } }],
    ["bash -c xdg-open", { args: { command: 'bash -c "xdg-open https://example.com"' } }],
    [
      "powershell -Command",
      { args: { command: 'powershell -NoProfile -Command "Start-Process chrome"' } },
    ],
    ["wslview", { args: { command: "wslview https://example.com" } }],
    ["Invoke-Item", { args: { command: "Invoke-Item index.html" } }],
    ["vite --open", { args: { command: "vite --open" } }],
    ["a dev server that opens the browser", { args: { command: "npm run dev -- --open" } }],
    ["a script running puppeteer", { args: { command: "node scrape-puppeteer.js" } }],
  ])("denies %s", (_name, overrides) => {
    const reason = builtinDenyReason(req(overrides));
    expect(reason).toMatch(/virtual machine.*computer_task/);
  });

  it("does not deny the same tool for a Bot that also has local computer access", () => {
    expect(
      builtinDenyReason(req({ computerAccess: "docker+local", action: "browser_navigate" })),
    ).toBeUndefined();
  });

  it("does not enforce anything when the request doesn't say which computer the Bot has", () => {
    expect(
      builtinDenyReason(req({ computerAccess: undefined, action: "browser_navigate" })),
    ).toBeUndefined();
  });

  it.each([
    "grep -r chrome docs && git status",
    "npm run build",
    "python -m http.server 8934",
    "curl -sL https://example.com/file.jpg -o file.jpg",
    "echo openbot > notes.txt",
    "open README.md",
    "start-server --port 3000",
    "npm install left-pad",
    "git log --oneline -5",
    'git commit -m "open https://example.com in the docs"',
    "npm run dev -- --host 0.0.0.0",
    'sh -c "ls -la && git status"',
  ])("does not mistake %s for a browser launch", (command) => {
    expect(usesHostBrowser(req({ args: { command } }))).toBe(false);
  });
});

describe("built-in denies for OpenBot's and the engines' own secrets", () => {
  const deny = (command: string) =>
    builtinDenyReason({
      botId: "b",
      chainId: "c",
      kind: "tool",
      action: "shell",
      summary: "",
      detail: "",
      args: { command },
    });

  it.each([
    "cat C:/Users/x/.openbot/sessions/bot_123.token",
    String.raw`type C:\Users\x\.openbot\sessions\bot_123.token`,
    "cat ~/.codex/auth.json",
    String.raw`type C:\Users\x\.openbot\codex-home\auth.json`,
    String.raw`cat C:\Users\x\.ssh\id_ed25519`,
    "cat ~/.openbot/vault.key",
    "cat ~/.openbot/logs/threads/2026-09-30.ndjson",
    "ls ~/.openbot/sess*",
    "cat ~/.openbot/codex-home/config.toml",
    "cd ~/.openbot && cat sessions/bot_1.token",
    String.raw`Get-Content $env:USERPROFILE\.openbot\sessionsot_1.token`,
  ])("denies %s", (command) => {
    expect(deny(command)).toMatch(/credential path|database or vault/);
  });

  it("still lets a Bot use its own workspace and uploads under .openbot", () => {
    expect(deny("cat ~/.openbot/workspace/notes.md")).toBeUndefined();
    expect(deny("ls ~/.openbot/uploads")).toBeUndefined();
    expect(deny("cd ~/.openbot/workspace && git status")).toBeUndefined();
  });

  // The engines' requests reach the broker as JSON, which doubles every backslash of a Windows path.
  const inJson = (path: string) =>
    builtinDenyReason({
      botId: "b",
      chainId: "c",
      kind: "tool",
      action: "shell",
      summary: "",
      detail: JSON.stringify({ cwd: path }),
      args: { cwd: path, file_path: path, paths: [path] },
    });

  it("lets a Bot use its own workspace and uploads when the path is JSON-encoded on Windows", () => {
    const home = String.raw`C:\Users\someone\.openbot`;
    expect(inJson(String.raw`${home}\workspace`)).toBeUndefined();
    expect(inJson(String.raw`${home}\workspace\site\index.html`)).toBeUndefined();
    expect(inJson(String.raw`${home}\uploads\photo.png`)).toBeUndefined();
  });

  it("still denies OpenBot's own files when the path is JSON-encoded on Windows", () => {
    const home = String.raw`C:\Users\someone\.openbot`;
    for (const path of [
      String.raw`${home}\openbot.db`,
      String.raw`${home}\vault.bin`,
      String.raw`${home}\sessions\bot_1.token`,
      String.raw`${home}\codex-home\auth.json`,
      String.raw`${home}\logs\threads\x.ndjson`,
      String.raw`${home}\workspace-evil\x`,
    ]) {
      expect(inJson(path), path).toMatch(/credential path|database or vault/);
    }
  });

  it("does not deny ordinary commands", () => {
    expect(deny("git status && ls sessions")).toBeUndefined();
    expect(deny("cat notes/sessions.md")).toBeUndefined();
  });
});
