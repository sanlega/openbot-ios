import { describe, expect, it } from "vitest";
import { runComputerProviderConformance } from "@openbot/testkit";
import { FakeComputerProvider } from "./index.js";

runComputerProviderConformance("default fixtures", () => new FakeComputerProvider());

describe("FakeComputerProvider", () => {
  it("throws if screen() is requested before ensureStarted()", async () => {
    const provider = new FakeComputerProvider();
    await expect(provider.screen("bot_1")).rejects.toThrow(/ensureStarted/);
  });

  it("returns an independent screen per botId", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const a = await provider.screen("bot_a");
    const b = await provider.screen("bot_b");
    await a.act({ op: "click", target: (await a.observe()).elements[0]?.index });
    const bObservation = await b.observe();
    expect(bObservation.title).toBe("Inbox — 2 unread");
  });

  it("walks the inbox -> compose -> sent -> inbox fixture flow via click navigation", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");

    const inbox = await screen.observe();
    expect(inbox.title).toBe("Inbox — 2 unread");
    const composeLink = inbox.elements.find((el) => el.label === "Compose");
    expect(composeLink).toBeDefined();

    await screen.act({ op: "click", target: composeLink!.index });
    const compose = await screen.observe();
    expect(compose.title).toBe("New message");

    const sendButton = compose.elements.find((el) => el.label === "Send");
    await screen.act({ op: "type", target: compose.elements[0]!.index, text: "alice@example.com" });
    await screen.act({ op: "click", target: sendButton!.index });

    const sent = await screen.observe();
    expect(sent.title).toBe("Message sent");

    const backLink = sent.elements[0];
    await screen.act({ op: "click", target: backLink!.index });
    const backToInbox = await screen.observe();
    expect(backToInbox.title).toBe("Inbox — 2 unread");
  });

  it("navigate() jumps directly to a fixture page by url", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const result = await screen.act({ op: "navigate", url: "https://fake.local/compose" });
    expect(result.ok).toBe(true);
    const observation = await screen.observe();
    expect(observation.title).toBe("New message");
  });

  it("navigate() to an unknown url fails without changing the page", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const result = await screen.act({ op: "navigate", url: "https://fake.local/does-not-exist" });
    expect(result.ok).toBe(false);
    const observation = await screen.observe();
    expect(observation.title).toBe("Inbox — 2 unread");
  });

  it("rejects act() on an index from a stale observation after navigating away", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const inbox = await screen.observe();
    const composeLink = inbox.elements.find((el) => el.label === "Compose")!;

    await screen.act({ op: "click", target: composeLink.index });
    // Reusing the stale inbox-page index on the now-current compose page must fail.
    const result = await screen.act({ op: "click", target: composeLink.index });
    expect(result.ok).toBe(false);
  });

  it("blocked op reports blocked: true", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const result = await screen.act({ op: "blocked" });
    expect(result).toMatchObject({ ok: false, blocked: true });
  });
});
