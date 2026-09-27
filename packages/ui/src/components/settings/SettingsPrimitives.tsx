import type { ReactNode } from "react";

interface SectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** A titled group of setting cards; `id` is the anchor the side nav scrolls to. */
export function SettingsSection({ id, title, description, children }: SectionProps) {
  return (
    <section className="set-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="set-section-header">
        <h2 id={`${id}-title`}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** A bordered card of rows. */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="set-group">
      {title ? <div className="set-group-title">{title}</div> : null}
      {children}
    </div>
  );
}

interface RowProps {
  label: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  leading?: ReactNode;
  /** Stack the control under the label (for wide controls like text fields). */
  stacked?: boolean;
}

export function SettingRow({ label, help, htmlFor, children, leading, stacked }: RowProps) {
  const labelEl = htmlFor ? (
    <label className="set-row-label" htmlFor={htmlFor}>
      {label}
    </label>
  ) : (
    <div className="set-row-label">{label}</div>
  );
  return (
    <div className="set-row" data-stacked={stacked ? "true" : undefined}>
      {leading ? <div className="set-row-leading">{leading}</div> : null}
      <div className="set-row-text">
        {labelEl}
        {help ? <div className="set-row-help">{help}</div> : null}
      </div>
      {children ? <div className="set-row-control">{children}</div> : null}
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  value: number;
  unit?: string;
  min?: number;
  onChange: (value: number) => void;
}

export function NumberField({ id, value, unit, min = 0, onChange }: NumberFieldProps) {
  return (
    <div className="num-field">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const next = e.target.valueAsNumber;
          onChange(Number.isFinite(next) ? Math.max(min, next) : min);
        }}
      />
      {unit ? <span className="num-field-unit">{unit}</span> : null}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      className="toggle"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

type Tone = "success" | "warning" | "danger" | "muted" | "accent";

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`pill pill-${tone} set-pill`}>
      <span className="set-pill-dot" aria-hidden />
      {children}
    </span>
  );
}
