import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  CircleCheck,
  Eye,
  EyeOff,
  Filter,
  LoaderCircle,
  RefreshCw,
  Route,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import type { Transport } from "../../transport/index.js";
import { useOpenBot } from "../../state/context.js";
import { EngineCard, type EngineReadiness } from "./EngineCard.js";
import { engineName } from "../settings/settings-meta.js";
import {
  fetchEngines,
  fetchSetup,
  friendlyError,
  validateSetup,
  type EngineId,
  type EngineInfo,
} from "./setup-api.js";

const STEPS = ["welcome", "engines", "jev", "extras", "done"] as const;
type Step = (typeof STEPS)[number];

/** The numbered part of the flow ("Step 2 of 3"); welcome and done are bookends. */
const NUMBERED: Partial<Record<Step, { n: number; label: string }>> = {
  engines: { n: 1, label: "Engines" },
  jev: { n: 2, label: "Decision layer" },
  extras: { n: 3, label: "Extras" },
};
const NUMBERED_TOTAL = 3;

const ENGINE_IDS: EngineId[] = ["claude", "codex"];

interface SetupWizardProps {
  transport: Transport;
  onComplete: () => void;
}

type EngineState = Record<EngineId, EngineReadiness>;

export function SetupWizard({ transport, onComplete }: SetupWizardProps) {
  const { refresh } = useOpenBot();
  const [step, setStep] = useState<Step>("welcome");
  const index = STEPS.indexOf(step);

  // Engines
  const [engineInfo, setEngineInfo] = useState<Partial<Record<EngineId, EngineInfo>>>({});
  const [engines, setEngines] = useState<EngineState>({
    claude: { state: "checking" },
    codex: { state: "checking" },
  });
  const [checking, setChecking] = useState(false);
  // Other agents (Cursor, OpenCode...) that are installed and signed in: any one is enough.
  const [otherReady, setOtherReady] = useState<string[]>([]);
  const checkedOnce = useRef(false);

  // Jev
  const [jevKey, setJevKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [jevOk, setJevOk] = useState(false);
  const [jevError, setJevError] = useState<string | null>(null);

  // Extras
  const [tailscale, setTailscale] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [tailscaleError, setTailscaleError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const jevInputRef = useRef<HTMLInputElement>(null);

  // Keys already saved (e.g. a reinstall) count as done.
  useEffect(() => {
    void fetchSetup(transport).then((setup) => {
      if (setup?.typesafe?.ok) setJevOk(true);
      if (setup?.tailscale?.ok) setTailscale("ok");
    });
  }, [transport]);

  const checkEngines = useCallback(async () => {
    setChecking(true);
    setEngines((prev) => {
      const next = { ...prev };
      for (const id of ENGINE_IDS) if (next[id].state !== "ready") next[id] = { state: "checking" };
      return next;
    });
    const list = await fetchEngines(transport);
    const byId: Partial<Record<EngineId, EngineInfo>> = {};
    for (const e of list) if (e.id === "claude" || e.id === "codex") byId[e.id] = e;
    setEngineInfo(byId);
    setOtherReady(
      list
        .filter((e) => e.id !== "claude" && e.id !== "codex" && e.id !== "fake" && e.available)
        .map((e) => e.descriptor?.label ?? engineName(e.id)),
    );

    const results = await Promise.all(
      ENGINE_IDS.map((id) =>
        validateSetup(transport, id === "claude" ? "claude_login" : "codex_login"),
      ),
    );
    setEngines((prev) => {
      const next = { ...prev };
      ENGINE_IDS.forEach((id, i) => {
        const current = prev[id];
        if (current.state === "ready" && current.via === "api_key") return;
        const info = byId[id];
        if (results[i]!.ok) {
          const viaKey = !info?.login?.ok && Boolean(info?.apiKey?.ok);
          next[id] = {
            state: "ready",
            via: viaKey ? "api_key" : "login",
            account: info?.login?.account,
          };
        } else {
          next[id] = { state: info?.installed ? "signed_out" : "not_installed" };
        }
      });
      return next;
    });
    setChecking(false);
  }, [transport]);

  useEffect(() => {
    if (step === "engines" && !checkedOnce.current) {
      checkedOnce.current = true;
      void checkEngines();
    }
  }, [step, checkEngines]);

  // Focus: the key field on the Jev step, otherwise the step heading.
  useEffect(() => {
    if (step === "jev" && !jevOk) jevInputRef.current?.focus();
    else headingRef.current?.focus({ preventScroll: true });
  }, [step, jevOk]);

  const verifyEngineKey = async (id: EngineId, key: string): Promise<string | null> => {
    const kind = id === "claude" ? "anthropic" : "openai";
    const res = await validateSetup(transport, kind, key);
    if (!res.ok) return friendlyError(kind, res.reason);
    setEngines((prev) => ({ ...prev, [id]: { state: "ready", via: "api_key" } }));
    return null;
  };

  const anyEngine = ENGINE_IDS.some((id) => engines[id].state === "ready") || otherReady.length > 0;
  const allEngines = ENGINE_IDS.every((id) => engines[id].state === "ready");

  const go = (to: Step) => {
    setStep(to);
    setJevError(null);
    setFinishError(null);
  };

  const submitJev = async () => {
    if (jevOk && !jevKey.trim()) return go("extras");
    if (!jevKey.trim()) {
      setJevError("Paste your TypeSafe API key to continue.");
      jevInputRef.current?.focus();
      return;
    }
    setBusy(true);
    setJevError(null);
    const res = await validateSetup(transport, "typesafe", jevKey);
    setBusy(false);
    if (!res.ok) {
      setJevError(friendlyError("typesafe", res.reason));
      jevInputRef.current?.focus();
      return;
    }
    setJevOk(true);
    setJevKey("");
    go("extras");
  };

  const checkTailscale = async () => {
    setTailscale("checking");
    setTailscaleError(null);
    const res = await validateSetup(transport, "tailscale");
    if (res.ok) setTailscale("ok");
    else {
      setTailscale("failed");
      setTailscaleError(friendlyError("tailscale", res.reason));
    }
  };

  const finish = async () => {
    setBusy(true);
    setFinishError(null);
    try {
      await transport.post("/api/setup/complete");
      await refresh();
      onComplete();
    } catch {
      setFinishError("Couldn't finish setup. Make sure OpenBot is still running and try again.");
      setBusy(false);
    }
  };

  const primary = (): { label: string; action: () => void; disabled?: boolean } => {
    switch (step) {
      case "welcome":
        return { label: "Get started", action: () => go("engines") };
      case "engines":
        return { label: "Continue", action: () => go("jev"), disabled: !anyEngine };
      case "jev":
        return {
          label: jevKey.trim() || !jevOk ? "Verify and continue" : "Continue",
          action: () => void submitJev(),
        };
      case "extras":
        return {
          label: tailscale === "ok" ? "Continue" : "Skip for now",
          action: () => go("done"),
        };
      case "done":
        return { label: "Meet your Chief of Staff", action: () => void finish() };
    }
  };
  const main = primary();

  // Enter continues from anywhere on the page (buttons, links and the per-engine
  // key fields handle Enter themselves).
  const enterRef = useRef<() => void>(() => {});
  enterRef.current = () => {
    if (!main.disabled && !busy) main.action();
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.metaKey || e.ctrlKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("button, a, textarea, select, [data-enter='local']")) return;
      e.preventDefault();
      enterRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const numbered = NUMBERED[step];
  const back = index > 0 ? () => go(STEPS[index - 1]!) : null;

  return (
    <div className="setup-wizard" data-testid="setup-wizard">
      <div className="setup-backdrop" aria-hidden />
      <main className="setup-card" aria-labelledby="setup-heading" data-step={step}>
        {step !== "welcome" ? (
          <div className="setup-topbar">
            {back && step !== "done" ? (
              <button type="button" className="btn btn-ghost btn-sm setup-back" onClick={back}>
                <ChevronLeft size={14} aria-hidden />
                Back
              </button>
            ) : (
              <span />
            )}
            <Progress index={index} />
          </div>
        ) : null}

        <div className="setup-step" key={step}>
          {step === "welcome" ? (
            <div className="setup-hero">
              {iconFailed ? (
                <span className="setup-app-icon setup-app-icon-fallback" aria-hidden>
                  <Bot size={44} strokeWidth={1.75} />
                </span>
              ) : (
                <img
                  className="setup-app-icon"
                  src="/app/icon-512.png"
                  alt=""
                  width={88}
                  height={88}
                  onError={() => setIconFailed(true)}
                />
              )}
              <h1 id="setup-heading" ref={headingRef} tabIndex={-1}>
                Welcome to OpenBot
              </h1>
              <p className="setup-lede">
                A team of AI bots that works for you. Your keys, your computer.
              </p>
            </div>
          ) : (
            <header className="setup-header">
              {step === "done" ? (
                <span className="setup-done-badge" aria-hidden>
                  <Check size={22} strokeWidth={3} />
                </span>
              ) : null}
              {numbered ? (
                <p className="setup-eyebrow">
                  Step {numbered.n} of {NUMBERED_TOTAL} · {numbered.label}
                </p>
              ) : null}
              <h1 id="setup-heading" ref={headingRef} tabIndex={-1}>
                {HEADINGS[step].title}
              </h1>
              <p className="setup-lede">{HEADINGS[step].lede}</p>
            </header>
          )}

          {step === "engines" ? (
            <div className="setup-stack">
              {ENGINE_IDS.map((id) => (
                <EngineCard
                  key={id}
                  id={id}
                  info={engineInfo[id]}
                  readiness={engines[id]}
                  onVerifyKey={(key) => verifyEngineKey(id, key)}
                />
              ))}
              <div className="setup-inline-row">
                <span className="setup-muted">
                  {otherReady.length > 0
                    ? `Also ready: ${otherReady.join(", ")}.`
                    : allEngines
                      ? "Both engines are ready. bots can use either one."
                      : anyEngine
                        ? "You can add the other engine later in Settings."
                        : "Connect at least one engine to continue. Cursor, OpenCode (with local models), Gemini and Grok work too: install one and check again."}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void checkEngines()}
                  disabled={checking}
                >
                  <RefreshCw
                    size={13}
                    aria-hidden
                    className={checking ? "setup-spin" : undefined}
                  />
                  Check again
                </button>
              </div>
            </div>
          ) : null}

          {step === "jev" ? (
            <div className="setup-stack">
              <ul className="setup-features">
                <Feature icon={<Route size={16} />} title="Routing">
                  Picks the right bot and engine for every task.
                </Feature>
                <Feature icon={<ShieldCheck size={16} />} title="Approvals">
                  Flags risky actions so you decide before they happen.
                </Feature>
                <Feature icon={<Filter size={16} />} title="Noise filter">
                  Only pings you when something actually needs you.
                </Feature>
              </ul>
              {jevOk && !jevKey ? (
                <div className="setup-connected" role="status">
                  <CircleCheck size={16} aria-hidden />
                  TypeSafe is connected.
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm setup-connected-action"
                    onClick={() => {
                      setJevOk(false);
                      window.setTimeout(() => jevInputRef.current?.focus(), 0);
                    }}
                  >
                    Use a different key
                  </button>
                </div>
              ) : (
                <div className="field">
                  <label className="field-label" htmlFor="setup-jev-key">
                    TypeSafe API key
                  </label>
                  <div className="setup-secret">
                    <input
                      id="setup-jev-key"
                      className="setup-secret-input"
                      ref={jevInputRef}
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste your key"
                      value={jevKey}
                      aria-invalid={jevError ? true : undefined}
                      aria-describedby={jevError ? "setup-jev-error" : "setup-jev-help"}
                      onChange={(e) => {
                        setJevKey(e.target.value);
                        setJevError(null);
                      }}
                    />
                    <button
                      type="button"
                      className="setup-icon-btn setup-secret-toggle"
                      aria-label={showKey ? "Hide key" : "Show key"}
                      aria-pressed={showKey}
                      onClick={() => setShowKey((s) => !s)}
                    >
                      {showKey ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                    </button>
                  </div>
                  {jevError ? (
                    <p className="setup-error" id="setup-jev-error" role="alert">
                      {jevError}
                    </p>
                  ) : (
                    <p className="field-help" id="setup-jev-help">
                      No key yet?{" "}
                      <a href="https://console.typesafe.ai/" target="_blank" rel="noreferrer">
                        Get one in the TypeSafe console
                      </a>
                      . It's stored encrypted on this computer and only ever sent to TypeSafe.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {step === "extras" ? (
            <div className="setup-stack">
              <section className="setup-option" data-state={tailscale} aria-label="Remote access">
                <span className="setup-option-icon">
                  <Smartphone size={18} aria-hidden />
                </span>
                <div className="setup-option-main">
                  <div className="setup-option-title">
                    Remote access from your phone
                    <span className="pill pill-muted setup-pill">Optional</span>
                  </div>
                  <p className="setup-option-desc">
                    Chat with your bots from anywhere over Tailscale, a private network that only
                    your devices can join.
                  </p>
                  {tailscale === "ok" ? (
                    <p className="setup-option-status">
                      <Check size={14} strokeWidth={3} aria-hidden />
                      Tailscale is running. Pair your phone from Devices.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void checkTailscale()}
                      disabled={tailscale === "checking"}
                    >
                      {tailscale === "checking" ? (
                        <LoaderCircle size={13} className="setup-spin" aria-hidden />
                      ) : null}
                      {tailscale === "failed" ? "Check again" : "Set up Tailscale"}
                    </button>
                  )}
                  {tailscaleError ? (
                    <p className="setup-hint" role="status">
                      {tailscaleError}
                    </p>
                  ) : null}
                </div>
              </section>
              <p className="setup-muted setup-center">You can turn this on later from Devices.</p>
            </div>
          ) : null}

          {step === "done" ? (
            <div className="setup-stack">
              <ul className="setup-summary">
                {ENGINE_IDS.map((id) => (
                  <SummaryRow
                    key={id}
                    ok={engines[id].state === "ready"}
                    label={id === "claude" ? "Claude Code" : "Codex"}
                    value={engines[id].state === "ready" ? "Connected" : "Not connected"}
                  />
                ))}
                {otherReady.length > 0 ? (
                  <SummaryRow ok label="More agents" value={otherReady.join(", ")} />
                ) : null}
                <SummaryRow
                  ok={jevOk}
                  label="Jev decision layer"
                  value={jevOk ? "Connected" : "Not connected"}
                />
                <SummaryRow
                  ok={tailscale === "ok"}
                  label="Remote access"
                  value={tailscale === "ok" ? "On" : "Off"}
                />
              </ul>
              {finishError ? (
                <p className="setup-error" role="alert">
                  {finishError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="setup-footer" data-step={step}>
          <button
            type="button"
            className="btn btn-primary setup-cta"
            onClick={main.action}
            disabled={main.disabled || busy}
          >
            {busy ? <LoaderCircle size={15} className="setup-spin" aria-hidden /> : null}
            {main.label}
            {!busy && step !== "extras" ? <ArrowRight size={15} aria-hidden /> : null}
          </button>
          {step === "welcome" ? (
            <p className="setup-footnote">Takes about two minutes. Bring your own accounts.</p>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

const HEADINGS: Record<Exclude<Step, "welcome">, { title: string; lede: string }> = {
  engines: {
    title: "Connect an engine",
    lede: "Your bots think with Claude Code, Codex or another agent like Cursor or OpenCode, using your own account. One is enough.",
  },
  jev: {
    title: "Add the decision layer",
    lede: "Jev by TypeSafe makes the quick calls behind the scenes, in milliseconds.",
  },
  extras: {
    title: "A few extras",
    lede: "Optional. Skip anything you don't need right now.",
  },
  done: {
    title: "You're all set",
    lede: "Your Chief of Staff is ready. Tell it what you need and it will bring in the right bots.",
  },
};

function Progress({ index }: { index: number }) {
  // One dot per numbered step (engines, decision layer, extras).
  const dots = STEPS.slice(1, -1);
  return (
    <ol className="setup-progress" aria-label={`Step ${index} of ${dots.length}`}>
      {dots.map((s, i) => (
        <li
          key={s}
          className="setup-dot"
          data-state={i + 1 < index ? "done" : i + 1 === index ? "current" : "todo"}
        />
      ))}
    </ol>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="setup-feature">
      <span className="setup-feature-icon" aria-hidden>
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <span className="setup-muted">{children}</span>
      </span>
    </li>
  );
}

function SummaryRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className="setup-summary-row" data-ok={ok}>
      <span className="setup-summary-mark" aria-hidden>
        {ok ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="setup-summary-label">{label}</span>
      <span className="setup-summary-value">{value}</span>
    </li>
  );
}
