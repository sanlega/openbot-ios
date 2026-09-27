import { useState, type ReactNode } from "react";
import type { Approval, Bot, InputRequest } from "@openbot/contracts";
import { Moon, Plus, Sun } from "lucide-react";
import { ApprovalCard } from "../components/cards/ApprovalCard.js";
import { BotAvatar } from "../components/common/BotAvatar.js";
import { InputRequestCard } from "../components/thread/InputRequestCard.js";
import { MessageText } from "../components/thread/MessageText.js";
import { TurnSteps } from "../components/thread/TurnSteps.js";
import { setTheme } from "../state/theme.js";

/**
 * Living reference of the design system (docs/design-system.md), at /app/?design.
 * A development aid: sample data only, not linked from the product UI.
 */
export function DesignGallery() {
  const [dark, setDark] = useState(
    () =>
      document.documentElement.dataset.theme !== "light" &&
      !window.matchMedia?.("(prefers-color-scheme: light)").matches,
  );
  const toggleTheme = () => {
    setTheme(dark ? "light" : "dark");
    setDark(!dark);
  };

  return (
    <div className="design-gallery">
      <header className="design-header">
        <div>
          <h1>OpenBot design system</h1>
          <p>Tokens and primitives from docs/design-system.md, rendered live.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={toggleTheme}>
          {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light" : "Dark"} theme
        </button>
      </header>

      <Section title="Color">
        <div className="design-swatches">
          {[
            "bg",
            "bg-sidebar",
            "surface-1",
            "surface-2",
            "surface-3",
            "border",
            "text",
            "text-2",
            "text-3",
            "accent",
            "user-bubble",
            "success",
            "warning",
            "danger",
            "cos",
          ].map((token) => (
            <div key={token} className="design-swatch">
              <span style={{ background: `var(--${token})` }} />
              <code>--{token}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        {(["2xl", "xl", "lg", "md", "base", "sm", "xs"] as const).map((size) => (
          <p key={size} style={{ fontSize: `var(--text-${size})`, margin: "4px 0" }}>
            <code className="design-token">--text-{size}</code> The Chief of Staff delegates first.
          </p>
        ))}
      </Section>

      <Section title="Buttons">
        <div className="design-row">
          <button type="button" className="btn btn-primary">
            <Plus size={14} /> Primary
          </button>
          <button type="button" className="btn btn-secondary">
            Secondary
          </button>
          <button type="button" className="btn btn-ghost">
            Ghost
          </button>
          <button type="button" className="btn btn-danger">
            Danger
          </button>
          <button type="button" className="btn btn-primary btn-sm">
            Small
          </button>
          <button type="button" className="btn btn-primary" disabled>
            Disabled
          </button>
        </div>
      </Section>

      <Section title="Status">
        <div className="design-row">
          <span className="pill pill-success">Done</span>
          <span className="pill pill-warning">Needs you</span>
          <span className="pill pill-danger">Failed</span>
          <span className="pill pill-accent">Live</span>
          <span className="pill pill-muted">Paused</span>
          <button type="button" className="chip">
            Quick reply
          </button>
          <button
            type="button"
            className="toggle"
            role="switch"
            aria-checked="true"
            aria-label="On"
          />
          <button
            type="button"
            className="toggle"
            role="switch"
            aria-checked="false"
            aria-label="Off"
          />
        </div>
        <div className="banner banner-warning" style={{ marginTop: 12, borderRadius: 8 }}>
          Reconnecting to OpenBot…
        </div>
      </Section>

      <Section title="Fields">
        <div className="design-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <span className="field-help">How the bot introduces itself.</span>
            <input defaultValue="Researcher" />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <select defaultValue="claude">
              <option value="auto">Auto: Jev picks per turn</option>
              <option value="claude">Claude Sonnet 5</option>
            </select>
          </label>
          <div className="field">
            <span className="field-label">Theme</span>
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {["System", "Light", "Dark"].map((o, i) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={i === 0}
                  className="segmented-option"
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Avatars">
        <div className="design-row">
          <BotAvatar bot={SAMPLE_COS} size={40} />
          <BotAvatar bot={SAMPLE_BOT} size={40} status="working" />
          <BotAvatar
            bot={{ ...SAMPLE_BOT, id: "bot_b", name: "Writer" }}
            size={40}
            status="needs-you"
          />
          <BotAvatar bot={{ ...SAMPLE_BOT, id: "bot_c", name: "Inbox Triage" }} size={32} />
          <BotAvatar bot={{ ...SAMPLE_BOT, id: "bot_d", name: "Finance" }} size={28} />
        </div>
      </Section>

      <Section title="Rows and cards">
        <div className="row-list">
          <div className="row">
            <BotAvatar bot={SAMPLE_BOT} size={28} />
            <div className="row-main">
              <span className="row-title">Researcher</span>
              <span className="row-sub">Finds and summarizes sources with citations</span>
            </div>
            <span className="pill pill-success">Idle</span>
          </div>
          <div className="row">
            <BotAvatar bot={SAMPLE_COS} size={28} />
            <div className="row-main">
              <span className="row-title">Chief of Staff</span>
              <span className="row-sub">Working on 2 tasks</span>
            </div>
            <span className="row-meta">14:02</span>
          </div>
        </div>
      </Section>

      <Section title="Conversation">
        <div className="design-thread">
          <div className="msg msg-user">
            <div className="msg-bubble">Find three note apps for developers</div>
            <span className="msg-time">14:02</span>
          </div>
          <TurnSteps turn={SAMPLE_TURN} />
          <div className="msg msg-bot">
            <div className="msg-gutter">
              <BotAvatar bot={SAMPLE_BOT} size={28} />
            </div>
            <div className="msg-content">
              <div className="msg-header">
                <span className="msg-author">Researcher</span>
                <span className="msg-time">14:03</span>
              </div>
              <div className="msg-body">
                <MessageText markdown text={SAMPLE_REPLY} />
              </div>
            </div>
          </div>
          <ApprovalCard approval={SAMPLE_APPROVAL} onResolve={() => undefined} />
          <InputRequestCard request={SAMPLE_FORM} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="design-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const SAMPLE_BOT: Bot = {
  id: "bot_sample_research",
  slug: "researcher",
  name: "Researcher",
  description: "Finds and summarizes sources with citations.",
  pinned: false,
  hidden: false,
  isChiefOfStaff: false,
  createdBy: "user",
  routing: { mode: "auto" },
  permissionPreset: "workspace_write",
  computer: "none",
  connectors: [],
  limits: {},
};

const SAMPLE_COS: Bot = {
  ...SAMPLE_BOT,
  id: "bot_sample_cos",
  name: "Chief of Staff",
  isChiefOfStaff: true,
};

const SAMPLE_TURN = {
  id: "turn_sample",
  botId: SAMPLE_BOT.id,
  startedAt: "2026-01-01T14:02:10.000Z",
  endedAt: "2026-01-01T14:02:52.000Z",
  status: "done" as const,
  steps: [
    {
      id: "s1",
      tool: "WebSearch",
      input: { query: "note apps for developers" },
      status: "done" as const,
    },
    { id: "s2", tool: "Read", input: { file_path: "notes/apps.md" }, status: "done" as const },
    { id: "s3", tool: "Write", input: { file_path: "notes/summary.md" }, status: "done" as const },
  ],
  text: "",
};

const SAMPLE_REPLY = `Here are three good options:

1. **Obsidian**: local Markdown files, great plugins.
2. **Logseq**: outliner, open source.
3. **Notion**: best for sharing with a team.

I saved the comparison to \`notes/summary.md\`.`;

const SAMPLE_APPROVAL: Approval = {
  id: "apr_sample",
  kind: "tool",
  botId: SAMPLE_BOT.id,
  summary: "Permission prompt: Bash",
  detail: '{"command":"npm publish --access public"}\n\nJev risk gate: band=human',
  status: "pending",
  expiresAt: "2026-01-01T14:32:00.000Z",
  createdAt: "2026-01-01T14:02:00.000Z",
};

const SAMPLE_FORM: InputRequest = {
  id: "inp_sample",
  botId: SAMPLE_BOT.id,
  threadId: "thr_sample",
  title: "About you",
  intro: "A few quick questions so I can help better.",
  status: "pending",
  createdAt: "2026-01-01T14:04:00.000Z",
  fields: [
    {
      id: "name",
      type: "text",
      label: "What should I call you?",
      required: true,
      multiline: false,
    },
    {
      id: "tone",
      type: "choice",
      label: "How should I reply?",
      required: false,
      options: ["Short and direct", "Detailed"],
      multiple: false,
      allowOther: true,
    },
    { id: "daily", type: "confirm", label: "Send me a daily summary?", required: false },
    { id: "token", type: "secret", label: "Notion token", required: false },
  ],
};
