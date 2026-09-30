import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transport } from "../../transport/types.js";
import { SavedLogins } from "./SavedLogins.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport }),
}));

afterEach(cleanup);

function fakeTransport(initial: Array<{ site: string; username?: string; hasPassword: boolean }>) {
  const logins = initial.map((l) => ({ ...l, updatedAt: "2026-09-30T10:00:00Z" }));
  const put = vi.fn(async (path: string, body: { username?: string; password?: string }) => {
    const site = decodeURIComponent(path.replace("/api/logins/", ""));
    logins.push({
      site,
      username: body.username,
      hasPassword: Boolean(body.password),
      updatedAt: "2026-09-30T10:00:00Z",
    });
    return {};
  });
  const del = vi.fn(async (path: string) => {
    const site = decodeURIComponent(path.replace("/api/logins/", ""));
    logins.splice(
      logins.findIndex((l) => l.site === site),
      1,
    );
    return { ok: true };
  });
  transport = {
    baseUrl: "http://127.0.0.1:4577",
    get: async () => ({ logins }),
    put,
    delete: del,
  } as unknown as Transport;
  return { put, del };
}

describe("SavedLogins", () => {
  it("lists saved logins with the username, never a password", async () => {
    fakeTransport([{ site: "example.com", username: "me@example.com", hasPassword: true }]);
    render(<SavedLogins />);
    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.getByText(/me@example\.com · password saved/)).toBeInTheDocument();
  });

  it("saves a new login and shows it", async () => {
    const { put } = fakeTransport([]);
    render(<SavedLogins />);
    await screen.findByText(/No saved logins/);

    await userEvent.type(screen.getByLabelText("Website"), "linkedin.com");
    await userEvent.type(screen.getByLabelText("Username or email"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Save login" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/logins/linkedin.com", {
        username: "me@example.com",
        password: "hunter2",
      }),
    );
    expect(await screen.findByText("linkedin.com")).toBeInTheDocument();
    // The form clears, so the password isn't left on screen.
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("asks before removing a login", async () => {
    const { del } = fakeTransport([{ site: "example.com", username: "a", hasPassword: true }]);
    render(<SavedLogins />);
    await userEvent.click(await screen.findByRole("button", { name: /Remove the login for/ }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove login" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/logins/example.com"));
    expect(await screen.findByText(/No saved logins/)).toBeInTheDocument();
  });
});
