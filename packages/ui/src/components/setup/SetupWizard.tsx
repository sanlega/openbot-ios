import { useState } from "react";
import type { Transport } from "../../transport/index.js";
import type { SetupValidateRequest } from "../../api/types.js";

const STEPS: Array<{ key: SetupValidateRequest["kind"]; label: string; required: boolean }> = [
  { key: "typesafe", label: "TypeSafe API key", required: true },
  { key: "claude_login", label: "Claude login", required: true },
  { key: "codex_login", label: "Codex login", required: true },
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

  const validate = async () => {
    setError(null);
    const res = await transport.post<{ ok: boolean; reason?: string }>("/api/setup/validate", {
      kind: current.key,
      value,
    } satisfies SetupValidateRequest);
    if (!res.ok) {
      setError(res.reason ?? "Validation failed");
      return;
    }
    setValue("");
    if (step + 1 >= STEPS.length) onComplete();
    else setStep(step + 1);
  };

  return (
    <div className="setup-wizard" data-testid="setup-wizard">
      <h1>Welcome to OpenBot</h1>
      <p style={{ color: "var(--text-muted)" }}>
        Step {step + 1} of {STEPS.length}: {current.label}
        {!current.required ? " (optional — skip with any 8+ char value)" : ""}
      </p>
      <div className="setup-step">
        <label htmlFor="setup-value">{current.label}</label>
        <input
          id="setup-value"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter value…"
        />
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button type="button" className="card-actions primary" style={{ width: "100%", padding: 12 }} onClick={() => void validate()}>
        Continue
      </button>
    </div>
  );
}
