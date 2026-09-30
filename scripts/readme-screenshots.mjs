// Regenerates the README screenshots in docs/screenshots/ from a demo scenario.
//
//   pnpm build   # packages/ui (mock) and apps/pwa/static must be built
//   node scripts/readme-screenshots.mjs
//
// The UI runs against the in-repo mock Client API (packages/ui/src/mock) with the
// scenario below: neutral names, no real accounts. The Computer tab's live view
// shows docs/screenshots/source/live-view.png, a real capture of the Docker
// desktop after Jev searched Wikipedia (see README "Computer use").
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../e2e/node_modules/@playwright/test/index.mjs";
import * as seed from "../packages/ui/dist/mock/seed-data.js";
import { MockClientApiServer } from "../packages/ui/dist/mock/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = join(root, "apps/pwa/static");
const OUT = join(root, "docs/screenshots");
const LIVE_VIEW = join(OUT, "source/live-view.png");

const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

// ---------- Scenario ----------

const bot = (id, name, description, extra = {}) => ({
  id,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  description,
  pinned: false,
  hidden: false,
  isChiefOfStaff: false,
  createdBy: "user",
  lastActiveAt: at(5),
  routing: { mode: "auto" },
  permissionPreset: "workspace_write",
  computer: "none",
  connectors: [],
  limits: { dailyUsd: 5 },
  ...extra,
});

const BOTS = [
  bot(
    "bot_cos",
    "Chief of Staff",
    "Your first point of contact. Handles work itself or brings in the right bot.",
    { isChiefOfStaff: true, pinned: true, permissionPreset: "full" },
  ),
  bot("bot_research", "Research Analyst", "Deep dives, timelines and sources.", {
    createdBy: "bot_cos",
    routing: { mode: "pinned", engine: "claude", model: "claude-sonnet-5" },
    justification: {
      responsibility: "Long-form research with sources",
      whyNotExisting: "No bot owned research yet",
      lifetime: "recurring",
      boundary: ["web research", "summaries"],
      userRequested: true,
      spawnDecisionId: "dec_spawn",
    },
  }),
  bot("bot_web", "Web Operator", "Uses the browser on the virtual computer.", {
    createdBy: "bot_cos",
    computer: "docker",
    routing: { mode: "pinned", engine: "codex", model: "gpt-5-codex" },
  }),
  bot("bot_release", "Release Manager", "Merges release PRs and writes the notes.", {
    routing: { mode: "pinned", engine: "codex", model: "gpt-5-codex" },
  }),
  bot("bot_inbox", "Inbox Triage", "Sorts email every morning and flags what needs you.", {
    lastActiveAt: at(300),
  }),
];

const THREADS = BOTS.map((b) => ({
  id: `thr_${b.id}`,
  botId: b.id,
  kind: "dm",
  createdAt: at(10_000),
}));

const msg = (id, botId, author, text, minutesAgo, extra = {}) => ({
  id,
  threadId: `thr_${botId}`,
  author: author === "user" ? { type: "user", id: "user" } : { type: "bot", id: author },
  text,
  attachments: [],
  chainId: `chn_${botId}`,
  hop: 0,
  createdAt: at(minutesAgo),
  proactive: false,
  delivery: "delivered",
  pushed: false,
  ...extra,
});

const BRIEF = `**Your brief is ready** · \`workspace/history-of-programming.md\`

| Year | Milestone |
| --- | --- |
| 1843 | Ada Lovelace publishes the first algorithm, for Babbage's Analytical Engine |
| 1957 | FORTRAN ships, the first widely used high-level language |
| 1972 | C appears at Bell Labs |
| 1991 | Python 0.9 is released |

Research Analyst wrote the timeline; Web Operator checked the facts on Wikipedia with the browser. Sources are at the end of the file.`;

const MESSAGES = [
  msg(
    "m_cos_1",
    "bot_cos",
    "user",
    "I'm giving a 10-minute talk on the history of programming at Friday's offsite. Can you get me a one-page brief with a short timeline and sources?",
    52,
  ),
  msg(
    "m_cos_2",
    "bot_cos",
    "bot_cos",
    "On it. I split the work:\n\n- **Research Analyst** drafts the timeline and picks the sources.\n- **Web Operator** checks the key facts on Wikipedia with the browser.\n\nYou'll get one brief when it's done, with no progress pings in between.",
    51,
  ),
  msg("m_cos_3", "bot_cos", "bot_cos", BRIEF, 6, {
    proactive: true,
    kind: "result",
    options: ["Looks good", "Make it shorter"],
  }),
  msg(
    "m_web_1",
    "bot_web",
    "bot_cos",
    "Check on Wikipedia: when did Ada Lovelace publish her notes on the Analytical Engine, and what was in them? Two sentences and the link.",
    50,
  ),
  msg(
    "m_web_2",
    "bot_web",
    "bot_web",
    "In **1843** Ada Lovelace published her translation of Menabrea's paper on the Analytical Engine, with notes three times longer than the original. Note G describes an algorithm to compute Bernoulli numbers, often called the first computer program.\n\nSource: https://en.wikipedia.org/wiki/Ada_Lovelace",
    48,
  ),
  msg(
    "m_rel_1",
    "bot_release",
    "user",
    "Merge the release PR once CI is green, then post the notes.",
    3,
  ),
  msg(
    "m_rel_2",
    "bot_release",
    "bot_release",
    "CI is green on **#142 · Release 0.9.0** (412 tests, 3 platforms). I'm ready to merge it into `main` with:\n\n```sh\ngh pr merge 142 --squash --delete-branch\n```\n\nThen I'll post the notes in #releases.",
    2,
  ),
  msg(
    "m_research_1",
    "bot_research",
    "bot_research",
    "Timeline drafted: four milestones from 1843 to 1991, each with a primary source. Handing it to the Chief of Staff.",
    8,
    { proactive: true, kind: "result" },
  ),
  msg(
    "m_research_2",
    "bot_research",
    "bot_research",
    "Still reading the FORTRAN history paper… (progress)",
    30,
    { proactive: true, delivery: "held" },
  ),
  msg(
    "m_inbox_1",
    "bot_inbox",
    "bot_inbox",
    "Morning sweep done: 23 emails sorted, 2 need you (a contract to sign and a customer escalation). Everything else is labelled and archived.",
    300,
    { proactive: true, kind: "result" },
  ),
];

const APPROVALS = [
  {
    id: "apr_merge",
    kind: "tool",
    botId: "bot_release",
    chainId: "chn_bot_release",
    summary: "Bash requested by bot_release",
    detail: `{"command":"gh pr merge 142 --squash --delete-branch"}\n\nJev risk gate: band=confirm, external_side_effect=0.62`,
    risk: 0.62,
    status: "pending",
    resolution: undefined,
    expiresAt: at(-28),
    createdAt: at(2),
  },
];

let seq = 0;
const ev = (minutesAgo, type, botId, payload, turnId) => ({
  id: `evt_${++seq}`,
  seq,
  ts: at(minutesAgo),
  type,
  botId,
  threadId: `thr_${botId}`,
  ...(turnId ? { turnId } : {}),
  payload,
});
const tool = (minutesAgo, botId, turnId, id, toolName, input) => [
  ev(minutesAgo, "tool.started", botId, { toolName, toolUseId: id, input }, turnId),
  ev(
    minutesAgo - 0.1,
    "tool.completed",
    botId,
    { toolUseId: id, output: "ok", isError: false },
    turnId,
  ),
];
const computerStep = (minutesAgo, n, extra) => ({
  ...ev(minutesAgo, "computer.step", "bot_web", {
    taskId: "ctask_wiki",
    step: { step: n, at: at(minutesAgo), ...extra },
  }),
  threadId: undefined,
});

const EVENTS = [
  // Chief of Staff: delegates to two bots, then answers.
  ev(51.9, "turn.started", "bot_cos", { engine: "claude", model: "claude-opus-5-5" }, "t_cos"),
  ...tool(51.8, "bot_cos", "t_cos", "tu_1", "mcp__openbot__list_bots", {}),
  ...tool(51.6, "bot_cos", "t_cos", "tu_2", "mcp__openbot__send_message", {
    bot: "Research Analyst",
    text: "Draft a four-milestone timeline",
  }),
  ...tool(51.4, "bot_cos", "t_cos", "tu_3", "mcp__openbot__send_message", {
    bot: "Web Operator",
    text: "Check the Ada Lovelace facts",
  }),
  ev(51.2, "message.created", "bot_cos", { messageId: "m_cos_2" }, "t_cos"),
  ev(51.2, "turn.completed", "bot_cos", {}, "t_cos"),
  // Web Operator: a computer task driven by Jev.
  ev(49.8, "turn.started", "bot_web", { engine: "codex", model: "gpt-5-codex" }, "t_web"),
  ev(
    49.7,
    "tool.started",
    "bot_web",
    {
      toolName: "mcp__openbot__computer_task",
      toolUseId: "tu_c",
      input: { goal: 'On wikipedia.org, search for "Ada Lovelace" and open her article' },
    },
    "t_web",
  ),
  computerStep(49.65, 1, { op: "type", target: "Search Wikipedia", outcome: "executed" }),
  computerStep(49.6, 2, { outcome: "done", reason: "Done: the article is open" }),
  ev(
    49.55,
    "tool.completed",
    "bot_web",
    { toolUseId: "tu_c", output: "ok", isError: false },
    "t_web",
  ),
  ...tool(49.4, "bot_web", "t_web", "tu_s", "mcp__openbot__computer_screenshot", {}),
  ev(48.2, "message.created", "bot_web", { messageId: "m_web_2" }, "t_web"),
  ev(48.2, "turn.completed", "bot_web", {}, "t_web"),
  // Chief of Staff delivers the result.
  ev(6.5, "turn.started", "bot_cos", { engine: "claude", model: "claude-opus-5-5" }, "t_cos2"),
  ...tool(6.4, "bot_cos", "t_cos2", "tu_w", "Write", {
    file_path: "workspace/history-of-programming.md",
  }),
  ...tool(6.2, "bot_cos", "t_cos2", "tu_m", "mcp__openbot__message_user", { kind: "result" }),
  ev(6, "message.created", "bot_cos", { messageId: "m_cos_3" }, "t_cos2"),
  ev(6, "turn.completed", "bot_cos", {}, "t_cos2"),
  // Release Manager: waiting on an approval.
  ev(2.2, "turn.started", "bot_release", { engine: "codex", model: "gpt-5-codex" }, "t_rel"),
  ...tool(2.15, "bot_release", "t_rel", "tu_ci", "Bash", { command: "gh pr checks 142" }),
  ev(2.1, "message.created", "bot_release", { messageId: "m_rel_2" }, "t_rel"),
  ev(
    2,
    "tool.started",
    "bot_release",
    {
      toolName: "Bash",
      toolUseId: "tu_merge",
      input: { command: "gh pr merge 142 --squash --delete-branch" },
    },
    "t_rel",
  ),
  ev(2, "approval.requested", "bot_release", {
    approvalId: "apr_merge",
    kind: "tool",
    summary: "Bash requested by bot_release",
  }),
];

const COMPUTER_TASKS = [
  {
    id: "ctask_wiki",
    botId: "bot_web",
    goal: 'On wikipedia.org, search for "Ada Lovelace" and open her article',
    status: "completed",
    steps: 2,
    createdAt: at(49.7),
    summary: "Done: the article is open.",
    page: { url: "https://en.wikipedia.org/wiki/Ada_Lovelace", title: "Ada Lovelace - Wikipedia" },
    timeline: [
      { step: 1, op: "type", target: "Search Wikipedia", outcome: "executed", at: at(49.65) },
      { step: 2, op: "done", outcome: "done", reason: "The article is open", at: at(49.6) },
    ],
  },
];

const routine = (id, botId, name, prompt, cron, liveApproved) => ({
  id,
  botId,
  name,
  prompt,
  createdBy: "user",
  enabled: true,
  liveApproved,
  trigger: { type: "schedule", cron, timezone: "Europe/Madrid", catchUp: "none" },
  limits: {
    perRun: { usd: 0.5, tokens: 200_000, turns: 10, computerSteps: 50, wallMin: 15 },
    dailyUsd: 2,
    maxRunsPerDay: 1,
    cooldownSec: 3600,
  },
  consecutiveFailures: 0,
  createdAt: at(20_000),
});

const ROUTINES = [
  routine(
    "rtn_inbox",
    "bot_inbox",
    "Morning inbox sweep",
    "Sort new email, label and archive what doesn't need me, and tell me about anything urgent.",
    "0 8 * * 1-5",
    true,
  ),
  routine(
    "rtn_notes",
    "bot_release",
    "Weekly release notes",
    "Collect the merged PRs of the week and draft release notes in the workspace.",
    "0 17 * * 5",
    false,
  ),
];

const ROUTINE_RUNS = [
  {
    id: "rrun_1",
    routineId: "rtn_inbox",
    dryRun: false,
    status: "done",
    cause: "schedule",
    startedAt: at(300),
    endedAt: at(298),
    usage: { usd: 0.06, inputTokens: 12_000, outputTokens: 2_000 },
    resultSummary: "23 emails sorted, 2 flagged for you",
  },
  {
    id: "rrun_2",
    routineId: "rtn_notes",
    dryRun: true,
    status: "done",
    cause: "test",
    startedAt: at(1500),
    endedAt: at(1499),
    usage: { usd: 0.03, inputTokens: 6_000, outputTokens: 1_500 },
    resultSummary: "Dry run: would write workspace/release-notes.md and post it in #releases",
    plannedActions: ["Would write workspace/release-notes.md", "Would post the notes in #releases"],
  },
];

const replace = (target, items) => target.splice(0, target.length, ...items);
replace(seed.SEED_BOTS, BOTS);
replace(seed.SEED_THREADS, THREADS);
replace(seed.SEED_COMPUTER_TASKS, COMPUTER_TASKS);
Object.assign(seed.SEED_ROUTES, {
  bot_cos: {
    engine: "claude",
    model: "claude-opus-5-5",
    effort: "high",
    confidence: 0.93,
    decisionId: "dec_r1",
  },
  bot_research: {
    engine: "claude",
    model: "claude-sonnet-5",
    confidence: 0.9,
    decisionId: "dec_r2",
  },
  bot_web: { engine: "codex", model: "gpt-5-codex", confidence: 0.9, decisionId: "dec_r3" },
  bot_release: { engine: "codex", model: "gpt-5-codex", confidence: 0.9, decisionId: "dec_r4" },
});
for (const key of Object.keys(seed.SEED_ROUTES)) {
  if (!BOTS.some((b) => b.id === key)) delete seed.SEED_ROUTES[key];
}

const mock = new MockClientApiServer();
Object.assign(mock, {
  events: EVENTS,
  nextSeq: seq,
  messages: MESSAGES,
  approvals: APPROVALS,
  routines: ROUTINES,
  routineRuns: ROUTINE_RUNS,
});
const { url } = await mock.listen();

// ---------- Browser ----------

const TYPES = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const liveViewImage = (await readFile(LIVE_VIEW)).toString("base64");
const browser = await chromium.launch();

async function open(name, { width = 1440, height = 900, scheme = "dark", go } = {}) {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  await page.route(`${url}/app/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/app\/?/, "") || "index.html";
    try {
      await route.fulfill({
        body: await readFile(join(STATIC, path)),
        contentType: TYPES[extname(path)] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({
        body: await readFile(join(STATIC, "index.html")),
        contentType: "text/html",
      });
    }
  });
  await page.route(`${url}/mock/novnc/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<body style="margin:0;background:#000"><img src="data:image/png;base64,${liveViewImage}" style="width:100%;height:100%;object-fit:cover;display:block"></body>`,
    }),
  );
  page.on("pageerror", (e) => console.error(`${name}: ${e.message}`));
  await page.goto(`${url}/app/`);
  await page.waitForTimeout(1200);
  if (go) await go(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.close();
  console.log(`docs/screenshots/${name}.png`);
}

const bot_ = (name) => (p) =>
  p.getByTestId("bot-list").getByText(name, { exact: true }).first().click();
const nav = (label) => (p) => p.getByRole("button", { name: label, exact: true }).first().click();
const tab = (label) => (p) => p.getByRole("button", { name: label, exact: true }).first().click();
const then =
  (...steps) =>
  async (p) => {
    for (const step of steps) {
      await step(p);
      await p.waitForTimeout(500);
    }
  };
const expandTurns = async (p) => {
  const summaries = p.getByTestId("turn-steps").locator("summary");
  for (let i = 0; i < (await summaries.count()); i += 1) await summaries.nth(i).click();
};

await open("chat-dark", { go: bot_("Chief of Staff") });
await open("chat-light", { scheme: "light", go: bot_("Chief of Staff") });
await open("computer-chat", { go: then(bot_("Web Operator"), expandTurns) });
await open("computer-tab", { height: 1000, go: then(bot_("Web Operator"), tab("Computer")) });
await open("approval", { go: bot_("Release Manager") });
await open("activity-dark", { go: nav("Activity") });
await open("routines", {
  go: then(nav("Routines"), (p) => p.getByText("Weekly release notes").first().click()),
});
await open("connectors", { go: nav("Connectors") });
if (process.env.EXTRA) {
  await open("settings-spending", {
    go: then(nav("Settings"), (p) =>
      p.getByRole("button", { name: "Spending", exact: true }).first().click(),
    ),
  });
  await open("connect-dialog", {
    go: then(nav("Connectors"), (p) =>
      p.getByRole("button", { name: "Connect", exact: true }).first().click(),
    ),
  });
}
await open("settings-jev", {
  go: then(nav("Settings"), (p) =>
    p.getByRole("button", { name: "Jev", exact: true }).first().click(),
  ),
});
await open("phone-chat", { width: 390, height: 844, go: bot_("Chief of Staff") });

await browser.close();
await mock.close?.();
