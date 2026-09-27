// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TurnSteps } from "./TurnSteps.js";
import type { TurnActivity } from "../../state/reducer.js";

describe("TurnSteps", () => {
  it("shows the engine error for a failed turn even when no tool steps ran", () => {
    const turn: TurnActivity = {
      id: "turn_failed",
      botId: "bot_1",
      startedAt: "2026-09-27T10:00:00.000Z",
      endedAt: "2026-09-27T10:00:02.000Z",
      status: "failed",
      steps: [],
      text: "",
      errorMessage: "You've hit your session limit · resets at 11:30pm",
    };

    render(<TurnSteps turn={turn} />);

    expect(screen.getByText("Couldn't finish · 2s")).toBeTruthy();
    expect((screen.getByTestId("turn-steps") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("session limit");
  });
});
