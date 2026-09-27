import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { allEventTypesLabeled } from "./EventCard.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { RouteChip } from "../thread/RouteChip.js";
import type { Approval } from "@openbot/contracts";

describe("EventCard", () => {
  it("labels every contract event type", () => {
    expect(allEventTypesLabeled()).toBe(true);
  });
});

describe("ApprovalCard", () => {
  it("renders allow/deny actions", async () => {
    const user = userEvent.setup();
    let resolution: string | undefined;
    const approval: Approval = {
      id: "apr_1",
      kind: "tool",
      botId: "bot_1",
      summary: "Write file",
      detail: "path/to/file",
      status: "pending",
      resolution: undefined,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    render(
      <ApprovalCard
        approval={approval}
        onResolve={(r) => {
          resolution = r;
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Allow" }));
    expect(resolution).toBe("allow");
  });
});

describe("RouteChip", () => {
  it("shows engine model and confidence", () => {
    render(<RouteChip route={{ engine: "claude", model: "sonnet", confidence: 0.88 }} />);
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
  });
});

describe("parseDigestText", () => {
  it("reads the harness digest body into sections", async () => {
    const { parseDigestText } = await import("../digest/DigestMessage.js");
    const digest = parseDigestText(
      "Daily digest\n\nHeld messages:\n- Research: still looking\n\nRoutine results:\n- Summary (done): ok",
      "2026-09-27T18:00:00.000Z",
    );
    expect(digest.sections).toEqual([
      { title: "Held messages", items: ["Research: still looking"] },
      { title: "Routine results", items: ["Summary (done): ok"] },
    ]);
  });
});
