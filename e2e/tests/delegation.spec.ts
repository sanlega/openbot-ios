import { test, expect } from "@playwright/test";
import { api, connectWs, createBot, eventually, startTestHarness } from "../src/harness.js";

interface ThreadMessages {
  messages: Array<{
    text: string;
    kind?: string;
    inputRequestId?: string;
    author: { type: string; id?: string };
  }>;
}

async function team(harness: Awaited<ReturnType<typeof startTestHarness>>) {
  const { bot: chief, thread: chiefThread } = await createBot(harness, {
    name: "Chief",
    description: "chief of staff",
    isChiefOfStaff: true,
    routing: { mode: "pinned", engine: "fake" },
  });
  const { bot: worker, thread: workerThread } = await createBot(harness, {
    name: "Deployer",
    description: "deploys websites",
    routing: { mode: "pinned", engine: "fake" },
  });
  return { chief, chiefThread, worker, workerThread };
}

const delegate = (task: string) =>
  `@tool send_message ${JSON.stringify({ bot: "deployer", text: task })}`;

test.describe("Delegation is bidirectional (fake engine and Jev)", () => {
  test("when the worker finishes, the Chief's user sees a card and the Chief takes a turn about it", async () => {
    const harness = await startTestHarness();
    try {
      const { chief, chiefThread, worker } = await team(harness);
      const ws = await connectWs(harness);
      await ws.command("message.send", { botId: chief.id, text: delegate("build the site") });

      const done = await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { state?: string } }).delegation?.state === "completed",
      );
      expect(done.botId).toBe(worker.id);

      // The result is in the thread the user is in: the Chief's, authored by the worker.
      const card = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${chiefThread.id}/messages`);
        return res.body.messages.find((m) => m.author.id === worker.id && m.kind === "result");
      });
      expect(card.text).toContain("Deployer finished");

      // And the Chief is woken by the harness (a second turn on its own, separate chain).
      const wake = await ws.waitForEvent(
        (e) => e.type === "turn.started" && e.botId === chief.id && e.chainId !== done.chainId,
      );
      expect(wake.botId).toBe(chief.id);
      ws.close();
    } finally {
      await harness.close();
    }
  });

  test("a blocker from the worker reaches the Chief, not the worker's own thread", async () => {
    const harness = await startTestHarness();
    try {
      const { chief, chiefThread, worker, workerThread } = await team(harness);
      const ws = await connectWs(harness);
      const blocker = `@tool message_user ${JSON.stringify({ kind: "blocker", body: "I have no hosting account" })}`;
      await ws.command("message.send", { botId: chief.id, text: delegate(blocker) });

      const blockedEvent = await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { wakeKind?: string } }).delegation?.wakeKind === "blocked",
      );
      const card = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${chiefThread.id}/messages`);
        return res.body.messages.find((m) => m.author.id === worker.id && m.kind === "blocker");
      });
      expect(card.text).toContain("blocked");
      expect(card.text).toContain("I have no hosting account");
      await ws.waitForEvent(
        (e) =>
          e.type === "turn.started" && e.botId === chief.id && e.chainId !== blockedEvent.chainId,
      );

      const own = await api<ThreadMessages>(harness, `/api/threads/${workerThread.id}/messages`);
      expect(own.body.messages.some((m) => m.text === "I have no hosting account")).toBe(false);
      ws.close();
    } finally {
      await harness.close();
    }
  });

  test("a worker's form shows up in the Chief's chat and the answer resumes the worker", async () => {
    const harness = await startTestHarness();
    try {
      const { chief, chiefThread, worker } = await team(harness);
      const ws = await connectWs(harness);
      const form = `@tool ask_user ${JSON.stringify({
        title: "Hosting login",
        fields: [{ id: "token", type: "secret", label: "API token", required: true }],
      })}`;
      await ws.command("message.send", { botId: chief.id, text: delegate(form) });

      const requested = await ws.waitForEvent((e) => e.type === "input.requested");
      // The form is drawn where the user is (the Chief's thread) and names the worker.
      expect(requested.threadId).toBe(chiefThread.id);
      const requestId = (requested.payload as { requestId: string }).requestId;
      const shown = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${chiefThread.id}/messages`);
        return res.body.messages.find((m) => m.inputRequestId === requestId);
      });
      expect(shown.text).toContain("Deployer asks");

      // The worker is blocked, and the Chief is not bothered about it.
      await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { state?: string } }).delegation?.state === "input_required",
      );

      const answered = await api(harness, `/api/inputs/${requestId}/answer`, {
        method: "POST",
        body: { answers: { token: "tok_secret_value" } },
      });
      expect(answered.status).toBe(200);

      // The worker takes its next turn on the same delegation and finishes it.
      await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { state?: string } }).delegation?.state === "completed",
      );
      const chiefCards = await api<ThreadMessages>(
        harness,
        `/api/threads/${chiefThread.id}/messages`,
      );
      expect(
        chiefCards.body.messages.some((m) => m.author.id === worker.id && m.kind === "result"),
      ).toBe(true);

      // The secret never appears in the conversation.
      expect(JSON.stringify(chiefCards.body)).not.toContain("tok_secret_value");
      ws.close();
    } finally {
      await harness.close();
    }
  });
  test("a worker's approval request shows in the Chief's chat, blocks the task, and the answer resumes the worker", async () => {
    const harness = await startTestHarness();
    try {
      const { chief, chiefThread, worker } = await team(harness);
      const ws = await connectWs(harness);
      const ask = `@tool request_approval ${JSON.stringify({ summary: "Publish the site", detail: "deploys to production" })}`;
      await ws.command("message.send", { botId: chief.id, text: delegate(ask) });

      const requested = await ws.waitForEvent((e) => e.type === "approval.requested");
      const approvalId = (requested.payload as { approvalId: string }).approvalId;
      expect(requested.botId).toBe(worker.id);
      expect((requested.payload as { kind: string }).kind).toBe("bot_request");
      expect((requested.payload as { summary: string }).summary).toBe("Publish the site");

      // Its task is blocked on the user, not reported as done to the Chief.
      await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (
            e.payload as { delegation?: { statusMessage?: string } }
          ).delegation?.statusMessage?.includes("approval") === true,
      );
      const before = await api<ThreadMessages>(harness, `/api/threads/${chiefThread.id}/messages`);
      expect(before.body.messages.some((m) => m.kind === "result")).toBe(false);

      const resolved = await api(harness, `/api/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: { resolution: "allow" },
      });
      expect(resolved.status).toBe(200);

      await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { state?: string } }).delegation?.state === "completed",
      );
      const after = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${chiefThread.id}/messages`);
        return res.body.messages.find((m) => m.author.id === worker.id && m.kind === "result");
      });
      expect(after.text).toContain("Deployer finished");
      ws.close();
    } finally {
      await harness.close();
    }
  });
  test("a worker parked on a permission card is blocked on the user, then continues and finishes", async () => {
    const harness = await startTestHarness();
    try {
      const { chief, chiefThread, worker } = await team(harness);
      const ws = await connectWs(harness);
      const risky = '@approve Bash {"command":"rm -rf build"}';
      await ws.command("message.send", { botId: chief.id, text: delegate(risky) });

      const requested = await ws.waitForEvent(
        (e) => e.type === "approval.requested" && e.botId === worker.id,
      );
      const approvalId = (requested.payload as { approvalId: string }).approvalId;
      await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { state?: string } }).delegation?.state === "input_required",
      );

      const resolved = await api(harness, `/api/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: { resolution: "allow" },
      });
      expect(resolved.status).toBe(200);

      await ws.waitForEvent(
        (e) =>
          e.type === "delegation.updated" &&
          (e.payload as { delegation?: { state?: string } }).delegation?.state === "completed",
      );
      const card = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${chiefThread.id}/messages`);
        return res.body.messages.find((m) => m.author.id === worker.id && m.kind === "result");
      });
      expect(card.text).toContain("Deployer finished");
      ws.close();
    } finally {
      await harness.close();
    }
  });
});
