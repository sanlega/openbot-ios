import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Lock, X } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { ConnectorMark } from "./ConnectorMark.js";
import type { ConnectorCatalogEntry } from "./types.js";

interface ConnectSheetProps {
  entry: ConnectorCatalogEntry;
  onClose: () => void;
  onConnected: () => void;
}

/** The connect dialog: what the connector can do, the fields it needs, and where secrets go. */
export function ConnectSheet({ entry, onClose, onConnected }: ConnectSheetProps) {
  const { transport } = useOpenBot();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fields = entry.setup?.fields ?? [];
  const writes = entry.tools?.filter((t) => t.write) ?? [];
  const reads = entry.tools?.filter((t) => !t.write) ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = fields.find((f) => !f.optional && !values[f.key]?.trim());
    if (missing) {
      setError(`${missing.label} is required`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await transport.post("/api/connectors/connect", { catalogId: entry.id, values });
      onConnected();
    } catch (err) {
      setError(
        err instanceof Error && /409/.test(err.message)
          ? "This app needs OAuth sign-in, which is coming in the next release."
          : err instanceof Error
            ? err.message
            : "Could not connect",
      );
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        ref={dialogRef}
      >
        <header className="dialog-header">
          <ConnectorMark name={entry.name} size={36} />
          <div className="dialog-title">
            <h2 id="connect-title">Connect {entry.name}</h2>
            {entry.publisher ? <p>by {entry.publisher}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <form className="dialog-body" onSubmit={(e) => void submit(e)} noValidate>
          {entry.description ? <p className="dialog-text">{entry.description}</p> : null}
          {entry.setup?.steps?.length ? (
            <ol className="conn-steps">
              {entry.setup.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          ) : null}
          {fields.map((field) => (
            <label key={field.key} className="field">
              <span className="field-label">
                {field.label}
                {field.optional ? <span className="field-optional"> optional</span> : null}
              </span>
              {field.help ? <span className="field-help">{field.help}</span> : null}
              <input
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={field.placeholder}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            </label>
          ))}
          {fields.some((f) => f.secret) ? (
            <span className="field-secure">
              <Lock size={12} aria-hidden /> Stored encrypted on this computer. Bots never see it.
            </span>
          ) : null}
          {writes.length > 0 || reads.length > 0 ? (
            <div className="conn-permissions">
              {reads.length > 0 ? (
                <p>
                  <strong>Reads without asking:</strong> {reads.map((t) => t.name).join(", ")}
                </p>
              ) : null}
              {writes.length > 0 ? (
                <p>
                  <strong>Asks you first:</strong> {writes.map((t) => t.name).join(", ")}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="dialog-note">
              Actions that change something in {entry.name} always ask you first.
            </p>
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer className="dialog-footer">
            {entry.setup?.docsUrl ? (
              <a
                className="btn btn-ghost"
                href={entry.setup.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Setup guide <ExternalLink size={13} />
              </a>
            ) : (
              <span />
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Connecting…" : "Connect"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
