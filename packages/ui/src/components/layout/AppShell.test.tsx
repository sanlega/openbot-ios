import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenBotProvider } from "../../state/context.js";
import { HttpTransport } from "../../transport/http-transport.js";
import { MockClientApiServer } from "../../mock/mock-server.js";
import { AppShell } from "../layout/AppShell.js";

describe("AppShell", () => {
  let server: MockClientApiServer;
  let transport: HttpTransport;

  beforeEach(async () => {
    server = new MockClientApiServer();
    const { url } = await server.listen(0);
    transport = new HttpTransport({ baseUrl: url, mode: "local" });
  });

  afterEach(async () => {
    cleanup();
    // Requests still in flight from the unmounted app must not hit a closed server.
    await transport.close();
    await server.close();
  });

  it("renders bot list and thread from mock API", async () => {
    render(
      <OpenBotProvider transport={transport}>
        <AppShell />
      </OpenBotProvider>,
    );

    await waitFor(() => {
      const botList = screen.getByTestId("bot-list");
      expect(within(botList).getByText("Chief of Staff")).toBeInTheDocument();
    });
    expect(screen.getByTestId("thread-messages")).toBeInTheDocument();
  });

  it("shows activity not-delivered tab", async () => {
    const user = userEvent.setup();
    render(
      <OpenBotProvider transport={transport}>
        <AppShell />
      </OpenBotProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("bot-list").children.length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Activity" })[0]!);
    const activity = await screen.findByTestId("activity-view");
    expect(within(activity).getByRole("button", { name: "Held for digest" })).toBeInTheDocument();
  });
});
