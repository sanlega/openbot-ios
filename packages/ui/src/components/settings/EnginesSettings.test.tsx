import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SetupState } from "@openbot/contracts";
import type { EnginesResponse } from "../../api/types.js";
import type { Transport } from "../../transport/types.js";
import { EnginesSettings, splitCommandLine } from "./EnginesSettings.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport }),
}));

afterEach(cleanup);

const engines: EnginesResponse["engines"] = [
  {
    id: "claude",
    installed: true,
    login: { ok: true, account: "me@example.com" },
    available: true,
    descriptor: { label: "Claude Code", kind: "native" },
  },
  {
    id: "opencode",
    installed: true,
    version: "1.18.31",
    login: { ok: true },
    available: true,
    descriptor: { label: "OpenCode", kind: "acp", loginCommand: "opencode auth login" },
  },
  {
    id: "cursor",
    installed: true,
    login: { ok: false },
    available: false,
    descriptor: { label: "Cursor", kind: "acp", loginCommand: "cursor-agent login" },
  },
];

function fakeTransport(localModels: Array<{ id: string; label: string; local?: boolean }>) {
  let custom: Array<{ slug: string; label: string; command: string; args: string[] }> = [];
  const put = vi.fn(async (_path: string, body: { engines: typeof custom }) => {
    custom = body.engines;
    return { engines: custom, restartRequired: true };
  });
  transport = {
    baseUrl: "http://127.0.0.1:4577",
    get: async (path: string) =>
      path === "/api/models"
        ? { engines: [{ engine: "opencode", models: localModels }] }
        : { engines: custom },
    put,
  } as unknown as Transport;
  return { put };
}

const setup = {} as SetupState;

describe("EnginesSettings", () => {
  it("shows ACP agents with their sign-in command and the local models found", async () => {
    fakeTransport([
      { id: "ollama/qwen3:8b", label: "qwen3:8b (Ollama)", local: true },
      { id: "opencode/big-pickle", label: "big-pickle" },
    ]);
    render(<EnginesSettings engines={engines} setup={setup} />);
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getByText(/cursor-agent login/)).toBeInTheDocument();
    expect(await screen.findByText("1 found")).toBeInTheDocument();
    expect(screen.getByText(/qwen3:8b \(Ollama\)/)).toBeInTheDocument();
  });

  it("says how to get local models when none are running", async () => {
    fakeTransport([]);
    render(<EnginesSettings engines={engines} setup={setup} />);
    expect(await screen.findByText("None running")).toBeInTheDocument();
  });

  it("adds a custom ACP agent from its command line and asks for a restart", async () => {
    const { put } = fakeTransport([]);
    render(<EnginesSettings engines={engines} setup={setup} />);
    await userEvent.type(await screen.findByLabelText("Agent name"), "Goose");
    await userEvent.type(screen.getByLabelText("Command line"), "goose acp --flag");
    await userEvent.click(screen.getByRole("button", { name: /Add/ }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/engines/custom", {
        engines: [{ slug: "goose", label: "Goose", command: "goose", args: ["acp", "--flag"] }],
      }),
    );
    expect(await screen.findByText(/Restart OpenBot/)).toBeInTheDocument();
    expect(screen.getByText("goose acp --flag")).toBeInTheDocument();
  });

  it("splits a command line, keeping quoted parts", () => {
    expect(splitCommandLine('"C:\\Program Files\\Agent\\agent.exe" acp --name "my bot"')).toEqual([
      "C:\\Program Files\\Agent\\agent.exe",
      "acp",
      "--name",
      "my bot",
    ]);
  });
});
