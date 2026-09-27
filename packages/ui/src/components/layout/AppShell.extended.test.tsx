import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenBotProvider } from "../../state/context.js";
import { HttpTransport } from "../../transport/http-transport.js";
import { MockClientApiServer } from "../../mock/mock-server.js";
import { AppShell } from "../layout/AppShell.js";

async function waitForBots() {
  await waitFor(() => {
    expect(within(screen.getByTestId("bot-list")).getByText("Chief of Staff")).toBeInTheDocument();
  });
}

describe("WS5 extended screens", () => {
  let server: MockClientApiServer;
  let transport: HttpTransport;

  beforeEach(async () => {
    server = new MockClientApiServer();
    const { url } = await server.listen(0);
    transport = new HttpTransport({ baseUrl: url, mode: "local" });
  });

  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 25));
    await server.close();
  });

  it("renders routines with enable live flow", async () => {
    const user = userEvent.setup();
    render(
      <OpenBotProvider transport={transport}>
        <AppShell />
      </OpenBotProvider>,
    );

    await waitForBots();
    await user.click(screen.getByRole("button", { name: "Routines" }));
    expect(await screen.findByTestId("routines-view")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Morning competitor scan")).toBeInTheDocument();
    });
  });

  it("renders settings view", async () => {
    const user = userEvent.setup();
    render(
      <OpenBotProvider transport={transport}>
        <AppShell />
      </OpenBotProvider>,
    );

    await waitForBots();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByTestId("settings-view")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Autonomy" })).toBeInTheDocument();
  });

  it("renders devices and computer panel", async () => {
    const user = userEvent.setup();
    render(
      <OpenBotProvider transport={transport}>
        <AppShell />
      </OpenBotProvider>,
    );

    await waitForBots();
    await user.click(screen.getByRole("button", { name: "Devices" }));
    expect(await screen.findByTestId("devices-view")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bots" }));
    await waitFor(() => expect(screen.getByTestId("thread-messages")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Computer" }));
    expect(await screen.findByTestId("computer-panel")).toBeInTheDocument();
  });

  it("shows bot why panel and digest in CoS thread", async () => {
    const user = userEvent.setup();
    render(
      <OpenBotProvider transport={transport}>
        <AppShell />
      </OpenBotProvider>,
    );

    await waitForBots();
    const roster = () => within(screen.getByTestId("bot-list"));
    await user.click(roster().getByRole("button", { name: /Research/i }));
    await waitFor(() =>
      expect(roster().getByRole("button", { name: /Research/i })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(await screen.findByTestId("bot-why-panel")).toBeInTheDocument();
    expect(screen.getByText("Long-form research with citations")).toBeInTheDocument();

    await user.click(roster().getByRole("button", { name: /Chief of Staff/i }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByTestId("digest-message")).toBeInTheDocument();
  });
});
