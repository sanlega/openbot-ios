import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Bot } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { BotProfileEditor } from "./BotProfileEditor.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({
    transport,
    refresh: async () => {},
    threads: [],
    selectThread: () => {},
  }),
}));

afterEach(cleanup);

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot_a",
    slug: "bot-a",
    name: "Helper",
    description: "helps",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
    ...overrides,
  };
}

function setTransport(patch: (path: string, body?: unknown) => Promise<unknown>) {
  transport = {
    baseUrl: "http://127.0.0.1:4577",
    get: async () => ({ engines: [] }),
    patch,
  } as unknown as Transport;
}

describe("BotProfileEditor — unrestricted routine budget", () => {
  it("is unchecked by default, off for a bot with no override", async () => {
    setTransport(async () => ({}));
    render(<BotProfileEditor bot={makeBot()} />);
    expect(
      screen.getByRole("checkbox", { name: /run past their cost\/token cap/i }),
    ).not.toBeChecked();
  });

  it("reflects an already-enabled bot, and saves the whole limits object when toggled off", async () => {
    const patch = vi.fn(async () => ({}));
    setTransport(patch);
    const bot = makeBot({ limits: { dailyUsd: 5, unrestrictedRoutineBudget: true } });
    render(<BotProfileEditor bot={bot} />);

    const checkbox = screen.getByRole("checkbox", { name: /run past their cost\/token cap/i });
    expect(checkbox).toBeChecked();

    const user = userEvent.setup();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(patch).toHaveBeenCalledWith(
      "/api/bots/bot_a",
      expect.objectContaining({
        limits: { dailyUsd: 5, unrestrictedRoutineBudget: false },
      }),
    );
  });
});
