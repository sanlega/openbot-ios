import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageText } from "./MessageText.js";

describe("MessageText code blocks", () => {
  afterEach(cleanup);

  it("shows the language and copies the code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MessageText markdown text={"Run this:\n\n```sh\npnpm build\n```"} />);

    expect(screen.getByText("sh")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("pnpm build");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
