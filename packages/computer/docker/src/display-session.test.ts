import { describe, expect, it } from "vitest";
import type { ObservationResult, ShellExec } from "@openbot/computer/observation";
import { DisplaySessionManager } from "./display-session.js";

const searchPage: ObservationResult = {
  url: "https://www.youtube.com/",
  title: "YouTube",
  elements: [
    { index: 0, role: "a", label: "Home" },
    { index: 1, role: "input", label: "Search", value: "" },
  ],
  _meta: [
    { index: 0, role: "a", label: "Home", bounds: { x: 0, y: 0, width: 40, height: 20 } },
    { index: 1, role: "input", label: "Search", bounds: { x: 400, y: 10, width: 200, height: 30 } },
  ],
};

function setup(navigateOk = true) {
  const commands: string[] = [];
  const navigations: string[] = [];
  const shell: ShellExec = {
    run: async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const sessions = new DisplaySessionManager({
    shell,
    startDisplay: async () => undefined,
    observePage: async () => searchPage,
    navigateTab: async (_port, url) => {
      navigations.push(url);
      return navigateOk;
    },
  });
  return { sessions, commands, navigations };
}

describe("DisplaySessionManager", () => {
  it("clicks the field before typing, so the text lands in it", async () => {
    const { sessions, commands } = setup();
    await sessions.observe("bot_1");

    const result = await sessions.act("bot_1", { op: "type", target: 1, text: "sanlega" });

    expect(result.ok).toBe(true);
    expect(commands).toEqual([
      "xdotool mousemove 500 25",
      "xdotool click 1",
      "xdotool key ctrl+a",
      "xdotool type --delay 20 -- sanlega",
    ]);
  });

  it("refuses to type into an element it never observed", async () => {
    const { sessions, commands } = setup();
    await sessions.observe("bot_1");

    const result = await sessions.act("bot_1", { op: "type", target: 7, text: "x" });

    expect(result.ok).toBe(false);
    expect(commands).toEqual([]);
  });

  it("navigates in the current tab instead of opening a new one", async () => {
    const { sessions, navigations } = setup();

    const result = await sessions.act("bot_1", {
      op: "navigate",
      url: "https://www.youtube.com/results?search_query=sanlega",
    });

    expect(result.ok).toBe(true);
    expect(navigations).toEqual(["https://www.youtube.com/results?search_query=sanlega"]);
  });
});
