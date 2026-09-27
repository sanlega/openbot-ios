import { useState, type FormEvent } from "react";
import type { InputAnswer, InputField, InputRequest } from "@openbot/contracts";
import { Check, ClipboardList, Lock } from "lucide-react";
import { useOpenBot } from "../../state/context.js";

/**
 * A form a Bot sent with `ask_user`. The user answers in place; the answers go
 * back to the Bot as their next message. Once resolved it folds into a summary.
 */
export function InputRequestCard({ request }: { request: InputRequest }) {
  if (request.status !== "pending") return <InputSummary request={request} />;
  return <InputForm request={request} />;
}

type Draft = Record<string, InputAnswer | undefined>;
const OTHER = "__other__";

function InputForm({ request }: { request: InputRequest }) {
  const { transport } = useOpenBot();
  const [draft, setDraft] = useState<Draft>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (id: string, value: InputAnswer | undefined) =>
    setDraft((d) => ({ ...d, [id]: value }));

  const answers = (): Record<string, InputAnswer> => {
    const out: Record<string, InputAnswer> = {};
    for (const field of request.fields) {
      let value = draft[field.id];
      if (field.type === "choice") {
        const otherText = other[field.id]?.trim();
        if (Array.isArray(value)) {
          value = value.map((v) => (v === OTHER ? (otherText ?? "") : v)).filter(Boolean);
        } else if (value === OTHER) {
          value = otherText ?? null;
        }
      }
      out[field.id] = value ?? null;
    }
    return out;
  };

  const missing = request.fields.find((f) => {
    if (!f.required) return false;
    const v = answers()[f.id];
    return v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing) {
      setError(`"${missing.label}" is required`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await transport.post(`/api/inputs/${request.id}/answer`, { answers: answers() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your answers");
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await transport.post(`/api/inputs/${request.id}/dismiss`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <form
      className="input-card"
      data-testid={`input-${request.id}`}
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={request.title}
    >
      <header className="input-card-header">
        <ClipboardList size={16} aria-hidden />
        <span>{request.title}</span>
      </header>
      {request.intro ? <p className="input-card-intro">{request.intro}</p> : null}
      <div className="input-card-fields">
        {request.fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={draft[field.id]}
            otherText={other[field.id] ?? ""}
            onChange={(v) => set(field.id, v)}
            onOther={(t) => setOther((o) => ({ ...o, [field.id]: t }))}
          />
        ))}
      </div>
      {error ? (
        <p className="input-card-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="input-card-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Send answers
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          Skip
        </button>
      </div>
    </form>
  );
}

interface FieldInputProps {
  field: InputField;
  value: InputAnswer | undefined;
  otherText: string;
  onChange: (value: InputAnswer | undefined) => void;
  onOther: (text: string) => void;
}

function FieldInput({ field, value, otherText, onChange, onOther }: FieldInputProps) {
  const id = `field-${field.id}`;
  const label = (
    <span className="field-label">
      {field.label}
      {field.required ? (
        <span className="field-required" aria-hidden>
          {" "}
          *
        </span>
      ) : (
        <span className="field-optional"> optional</span>
      )}
    </span>
  );
  const help = field.help ? <span className="field-help">{field.help}</span> : null;

  switch (field.type) {
    case "text":
      return (
        <label className="field" htmlFor={id}>
          {label}
          {help}
          {field.multiline ? (
            <textarea
              id={id}
              rows={3}
              placeholder={field.placeholder}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value)}
              required={field.required}
            />
          ) : (
            <input
              id={id}
              placeholder={field.placeholder}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value)}
              required={field.required}
            />
          )}
        </label>
      );
    case "number":
      return (
        <label className="field" htmlFor={id}>
          {label}
          {help}
          <input
            id={id}
            type="number"
            min={field.min}
            max={field.max}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            required={field.required}
          />
        </label>
      );
    case "date":
      return (
        <label className="field" htmlFor={id}>
          {label}
          {help}
          <input
            id={id}
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        </label>
      );
    case "secret":
      return (
        <label className="field" htmlFor={id}>
          {label}
          {help}
          <input
            id={id}
            type="password"
            autoComplete="off"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
          <span className="field-secure">
            <Lock size={12} aria-hidden /> Stored securely. The bot never sees the value.
          </span>
        </label>
      );
    case "confirm":
      return (
        <fieldset className="field">
          <legend>{label}</legend>
          {help}
          <div className="segmented" role="radiogroup" aria-label={field.label}>
            {[
              ["Yes", true],
              ["No", false],
            ].map(([text, v]) => (
              <button
                key={String(text)}
                type="button"
                role="radio"
                aria-checked={value === v}
                className="segmented-option"
                onClick={() => onChange(v as boolean)}
              >
                {text as string}
              </button>
            ))}
          </div>
        </fieldset>
      );
    case "choice": {
      const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      const options = field.allowOther ? [...field.options, OTHER] : field.options;
      const toggle = (option: string) => {
        if (field.multiple) {
          const next = selected.includes(option)
            ? selected.filter((o) => o !== option)
            : [...selected, option];
          onChange(next);
        } else {
          onChange(option);
        }
      };
      return (
        <fieldset className="field">
          <legend>{label}</legend>
          {help}
          <div className="choice-list" role={field.multiple ? "group" : "radiogroup"}>
            {options.map((option) => {
              const checked = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  role={field.multiple ? "checkbox" : "radio"}
                  aria-checked={checked}
                  className="choice-option"
                  onClick={() => toggle(option)}
                >
                  <span className={field.multiple ? "choice-box" : "choice-dot"} aria-hidden>
                    {checked ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  <span>{option === OTHER ? "Other…" : option}</span>
                </button>
              );
            })}
          </div>
          {selected.includes(OTHER) ? (
            <input
              aria-label={`${field.label}: other`}
              className="choice-other"
              placeholder="Type your answer"
              value={otherText}
              onChange={(e) => onOther(e.target.value)}
              autoFocus
            />
          ) : null}
        </fieldset>
      );
    }
  }
}

function InputSummary({ request }: { request: InputRequest }) {
  const status =
    request.status === "answered"
      ? "Answered"
      : request.status === "dismissed"
        ? "Skipped"
        : "Withdrawn by the bot";
  return (
    <details className="input-card input-card-resolved" data-testid={`input-${request.id}`}>
      <summary>
        <Check size={14} aria-hidden />
        <span className="input-card-title">{request.title}</span>
        <span className="input-card-status">{status}</span>
      </summary>
      {request.status === "answered" && request.answers ? (
        <dl className="input-answers">
          {request.fields.map((field) => (
            <div key={field.id}>
              <dt>{field.label}</dt>
              <dd>{formatAnswer(field, request.answers?.[field.id])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </details>
  );
}

function formatAnswer(field: InputField, value: InputAnswer | undefined): string {
  if (value === null || value === undefined || value === "") return "Not answered";
  if (field.type === "secret") return "•••••••• saved securely";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
