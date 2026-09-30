import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./Composer.js";

describe("Composer", () => {
  afterEach(cleanup);

  it("keeps the draft and doesn't send while reconnecting", async () => {
    const onSend = vi.fn();
    render(
      <Composer
        botName="Helper"
        running={false}
        onSend={onSend}
        onStop={() => undefined}
        offline
      />,
    );

    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "hello{Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("hello");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/your message will wait here/)).toBeInTheDocument();
  });

  it("gives the text back when sending fails", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Not connected to OpenBot"));
    render(<Composer botName="Helper" running={false} onSend={onSend} onStop={() => undefined} />);

    const box = screen.getByLabelText("Message");
    await userEvent.type(box, "hello{Enter}");

    expect(onSend).toHaveBeenCalledWith("hello");
    expect(box).toHaveValue("hello");
  });
});
