import { useState } from "react";
import type { Transport } from "../../transport/index.js";
import type { SetupValidateRequest } from "../../api/types.js";

const LOGIN_STEPS = new Set<SetupValidateRequest["kind"]>(["claude_login", "codex_login"]);

const STEPS: Array<{ key: SetupValidateRequest["kind"]; label: string; required: boolean }> = [
  { key: "typesafe", label: "TypeSafe API key", required: true },
  { key: "claude_login", label: "Claude login or API key", required: true },
  { key: "codex_login", label: "Codex login or API key", required: true },
  { key: "composio", label: "Composio (optional)", required: false },
  { key: "tailscale", label: "Tailscale (optional)", required: false },
];

interface SetupWizardProps {
  transport: Transport;
  onComplete: () => void;
}

export function SetupWizard({ transport, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = STEPS[step]!;
  const isLoginStep = LOGIN_STEPS.has(current.key);

  const advance = async () => {
    if (step + 1 >= STEPS.length) {
      await transport.post("/api/setup/complete");
      onComplete();
      return;
    }
    setStep(step + 1);
    setValue("");
  };

  const validate = async () => {
    setError(null);
    const res = await transport.post<{ result: { ok: boolean; reason?: string } }>(
      "/api/setup/validate",
      {
        kind: current.key,
        value: value || undefined,
      } satisfies SetupValidateRequest,
    );
    if (!res.result.ok) {
      setError(res.result.reason ?? "Validation failed");
      return;
    }
    await advance();
  };

  const skipOptional = async () => {
    if (current.required) return;
    await advance();
  };

  return (
    <div className="setup-wizard" data-testid="setup-wizard">
      <h1>Welcome to OpenBot</h1>
      <p style={{ color: "var(--text-muted)" }}>
        Step {step + 1} of {STEPS.length}: {current.label}
        {!current.required ? " (optional)" : ""}
      </p>
      <div className="setup-step">
        <label htmlFor="setup-value">{current.label}</label>
        {isLoginStep ? (
          <p style={{ color: "var(--text-muted)", margin: "8px 0" }}>
            Run <code>claude login</code> or <code>codex login</code> in a terminal, or paste an API
            key below.
          </p>
        ) : null}
        <input
          id="setup-value"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isLoginStep ? "API key (optional if CLI is logged in)…" : "Enter value…"}
        />
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button
        type="button"
        className="card-actions primary"
        style={{ width: "100%", padding: 12, marginBottom: 8 }}
        onClick={() => void validate()}
      >
        {isLoginStep && !value ? "Check login status" : "Continue"}
      </button>
      {!current.required ? (
        <button
          type="button"
          className="card-actions"
          style={{ width: "100%", padding: 12 }}
          onClick={() => void skipOptional()}
        >
          Skip
        </button>
      ) : null}
    </div>
  );
}
