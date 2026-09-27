import { useId, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, LoaderCircle, Sparkle, SquareTerminal } from "lucide-react";
import type { EngineId, EngineInfo } from "./setup-api.js";

export type EngineReadiness =
  | { state: "checking" }
  | { state: "ready"; via: "login" | "api_key"; account?: string }
  | { state: "not_installed" }
  | { state: "signed_out" };

const META: Record<
  EngineId,
  { name: string; maker: string; install: string; login: string; keyLabel: string; icon: ReactNode }
> = {
  claude: {
    name: "Claude Code",
    maker: "Anthropic",
    install: "npm i -g @anthropic-ai/claude-code",
    login: "claude login",
    keyLabel: "Anthropic API key",
    icon: <Sparkle size={18} aria-hidden />,
  },
  codex: {
    name: "Codex",
    maker: "OpenAI",
    install: "npm i -g @openai/codex",
    login: "codex login",
    keyLabel: "OpenAI API key",
    icon: <SquareTerminal size={18} aria-hidden />,
  },
};

interface EngineCardProps {
  id: EngineId;
  info?: EngineInfo;
  readiness: EngineReadiness;
  onVerifyKey: (key: string) => Promise<string | null>;
}

export function EngineCard({ id, info, readiness, onVerifyKey }: EngineCardProps) {
  const meta = META[id];
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyId = useId();
  const panelId = useId();

  const verify = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await onVerifyKey(key);
    setBusy(false);
    if (err) setError(err);
    else {
      setKey("");
      setKeyOpen(false);
    }
  };

  const ready = readiness.state === "ready";

  return (
    <section
      className="setup-engine"
      data-state={readiness.state}
      data-testid={`setup-engine-${id}`}
      aria-label={meta.name}
    >
      <div className="setup-engine-head">
        <span className="setup-engine-icon" data-engine={id}>
          {meta.icon}
        </span>
        <div className="setup-engine-title">
          <span className="setup-engine-name">{meta.name}</span>
          <span className="setup-engine-sub">
            {meta.maker}
            {info?.installed && info.version ? ` · ${shortVersion(info.version)}` : ""}
          </span>
        </div>
        <StatusPill readiness={readiness} />
      </div>

      <div className="setup-engine-body">
        {readiness.state === "ready" ? (
          <p className="setup-engine-note">
            {readiness.via === "api_key"
              ? "Connected with an API key."
              : readiness.account
                ? `Signed in as ${readiness.account}.`
                : "Signed in and ready."}
          </p>
        ) : readiness.state === "not_installed" ? (
          <>
            <p className="setup-engine-note">Install it from a terminal, then check again.</p>
            <CommandHint command={meta.install} />
          </>
        ) : readiness.state === "signed_out" ? (
          <>
            <p className="setup-engine-note">
              Installed, but not signed in. Run this in a terminal:
            </p>
            <CommandHint command={meta.login} />
          </>
        ) : (
          <p className="setup-engine-note">Looking for {meta.name} on this computer…</p>
        )}

        {!ready ? (
          <div className="setup-disclosure">
            <button
              type="button"
              className="setup-disclosure-toggle"
              aria-expanded={keyOpen}
              aria-controls={panelId}
              onClick={() => setKeyOpen((o) => !o)}
            >
              <ChevronRight size={14} aria-hidden className="setup-disclosure-chevron" />
              Use an API key instead
            </button>
            {keyOpen ? (
              <div className="setup-key-row" id={panelId}>
                <div className="field">
                  <label className="setup-sr-only" htmlFor={keyId}>
                    {meta.keyLabel}
                  </label>
                  <input
                    id={keyId}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={meta.keyLabel}
                    value={key}
                    data-enter="local"
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void verify();
                      }
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!key.trim() || busy}
                  onClick={() => void verify()}
                >
                  {busy ? <LoaderCircle size={14} className="setup-spin" aria-hidden /> : null}
                  Verify
                </button>
              </div>
            ) : null}
            {error ? (
              <p className="setup-error setup-error-inline" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatusPill({ readiness }: { readiness: EngineReadiness }) {
  switch (readiness.state) {
    case "checking":
      return (
        <span className="pill pill-muted setup-pill">
          <LoaderCircle size={11} className="setup-spin" aria-hidden />
          Checking
        </span>
      );
    case "ready":
      return (
        <span className="pill pill-success setup-pill">
          <Check size={11} strokeWidth={3} aria-hidden />
          Ready
        </span>
      );
    case "signed_out":
      return <span className="pill pill-warning setup-pill">Not signed in</span>;
    case "not_installed":
      return <span className="pill pill-muted setup-pill">Not installed</span>;
  }
}

function CommandHint({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the command stays selectable */
    }
  };
  return (
    <div className="setup-command">
      <code>
        <span className="setup-command-prompt" aria-hidden>
          $
        </span>
        {command}
      </code>
      <button
        type="button"
        className="setup-icon-btn"
        aria-label={copied ? "Copied" : `Copy "${command}"`}
        title={copied ? "Copied" : "Copy"}
        onClick={() => void copy()}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

/** "2.1.283 (Claude Code)" or "codex-cli 0.157.1" → "v2.1.283". */
function shortVersion(raw: string): string {
  const semver = /\d+\.\d+(?:\.\d+)?/.exec(raw)?.[0];
  return semver ? `v${semver}` : raw;
}
