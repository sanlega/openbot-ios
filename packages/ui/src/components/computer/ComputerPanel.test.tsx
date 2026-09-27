import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transport } from "../../transport/types.js";
import { ComputerPanel } from "./ComputerPanel.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({ useOpenBot: () => ({ transport }) }));

afterEach(cleanup);

function setTransport(
  get: (path: string) => Promise<unknown>,
  post: (path: string) => Promise<unknown> = async () => ({}),
) {
  transport = {
    baseUrl: "http://127.0.0.1:4577",
    get,
    post,
  } as unknown as Transport;
}

describe("ComputerPanel", () => {
  it("shows a recoverable error when loading status fails", async () => {
    setTransport(async (path) => {
      if (path === "/api/computer/status") throw new Error("offline");
      return { tasks: [] };
    });

    render(<ComputerPanel botId="bot-a" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.queryByText("Loading computer…")).not.toBeInTheDocument();
  });

  it("shows a failed start and lets the user retry", async () => {
    const post = vi.fn(async () => {
      throw new Error("Docker unavailable");
    });
    setTransport(
      async (path) =>
        path === "/api/computer/status" ? { ready: false, provider: "docker" } : { tasks: [] },
      post,
    );

    render(<ComputerPanel botId="bot-a" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Start computer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Docker unavailable");
    expect(screen.getByRole("button", { name: "Start computer" })).toBeEnabled();
    expect(post).toHaveBeenCalledWith("/api/computer/start");
  });

  it("shows the Mac desktop explanation for local mode", async () => {
    const get = vi.fn(async (path: string) =>
      path === "/api/computer/status" ? { ready: true, provider: "local" } : { tasks: [] },
    );
    setTransport(get);

    render(<ComputerPanel botId="bot-a" />);

    expect(await screen.findByText(/Your Mac desktop is the live view/)).toBeInTheDocument();
    expect(screen.queryByTitle("Bot screen live view")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/computer/screens/bot-a/live");
  });

  it("restarts an unavailable computer when retrying Live View", async () => {
    let liveAvailable = false;
    const get = vi.fn(async (path: string) => {
      if (path === "/api/computer/status") return { ready: true, provider: "docker" };
      if (path === "/api/computer/screens/bot-a/live") {
        if (!liveAvailable) throw new Error("connection refused");
        return { url: "http://127.0.0.1:6080/vnc.html", token: "valid", expiresAt: "later" };
      }
      return { tasks: [] };
    });
    const post = vi.fn(async () => {
      liveAvailable = true;
      return {};
    });
    setTransport(get, post);

    render(<ComputerPanel botId="bot-a" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry Live View" }));

    const liveFrame = await screen.findByTitle("Bot screen live view");
    expect(liveFrame).toHaveAttribute("allow", "fullscreen");
    expect(liveFrame).toHaveAttribute("allowfullscreen");
    expect(post).toHaveBeenCalledWith("/api/computer/start");
  });
});
