import { useEffect, useState } from "react";
import type { Settings, SetupState } from "@openbot/contracts";
import type { EnginesResponse, SettingsPatch } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";

const CAP_LABELS: Record<string, string> = {
  S1: "CoS-created bots (max roster)",
  S2: "New bots per 24h",
  S4: "Proactive msgs per bot / hour",
  S5: "Proactive msgs all bots / hour",
};

const BUDGET_LABELS: Record<string, string> = {
  gates: "Jev gates (req/min)",
  interactive: "Interactive (req/min)",
  computer: "Computer (req/min)",
  background: "Background (req/min)",
};

export function SettingsView() {
  const { transport } = useOpenBot();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [engines, setEngines] = useState<EnginesResponse["engines"]>([]);
  const [jevKey, setJevKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([
      transport.get<{ settings: Settings }>("/api/settings"),
      transport.get<{ setup: SetupState }>("/api/setup"),
      transport.get<EnginesResponse>("/api/engines"),
    ]).then(([s, setupRes, eng]) => {
      setSettings(s.settings);
      setSetup(setupRes.setup);
      setEngines(eng.engines);
    });
  }, [transport]);

  if (!settings || !setup) return <div className="empty-state">Loading settings…</div>;

  const updateCap = (key: string, value: number) => {
    setSettings({ ...settings, caps: { ...settings.caps, [key]: value } });
  };

  const updateBudget = (key: string, value: number) => {
    setSettings({ ...settings, budgets: { ...settings.budgets, [key]: value } });
  };

  const save = async () => {
    const patch: SettingsPatch = {
      caps: settings.caps,
      budgets: settings.budgets,
      quietHours: settings.quietHours,
    };
    const res = await transport.patch<{ settings: Settings }>("/api/settings", patch);
    setSettings(res.settings);
    if (jevKey.length >= 8) {
      await transport.post("/api/setup/validate", { kind: "typesafe", value: jevKey });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="scroll-panel settings-view" data-testid="settings-view">
      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Engine logins</h3>
        {engines.map((e) => (
          <div key={e.id} className="settings-row">
            <strong>{e.id}</strong>
            <span>{e.installed ? `v${e.version}` : "Not installed"}</span>
            <span className={e.login.ok ? "text-success" : "text-danger"}>
              {e.login.ok ? e.login.account ?? "Logged in" : "Not authenticated"}
            </span>
          </div>
        ))}
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 8 }}>
          Claude: {setup.claude?.mode ?? "—"} · Codex: {setup.codex?.mode ?? "—"}
        </p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Jev / TypeSafe key</h3>
        <input
          type="password"
          placeholder="Typesafe API key"
          value={jevKey}
          onChange={(e) => setJevKey(e.target.value)}
          className="settings-input"
        />
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
          Current: {setup.typesafe?.ok ? "Configured" : "Missing"}
        </p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Autonomy caps (S1–S10)</h3>
        {Object.entries(settings.caps).map(([key, val]) => (
          <label key={key} className="settings-field">
            <span>{CAP_LABELS[key] ?? key}</span>
            <input
              type="number"
              value={val}
              onChange={(e) => updateCap(key, Number(e.target.value))}
            />
          </label>
        ))}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Jev budgets (O4)</h3>
        {Object.entries(settings.budgets).map(([key, val]) => (
          <label key={key} className="settings-field">
            <span>{BUDGET_LABELS[key] ?? key}</span>
            <input
              type="number"
              value={val}
              onChange={(e) => updateBudget(key, Number(e.target.value))}
            />
          </label>
        ))}
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Quiet hours</h3>
        <label className="settings-field">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={settings.quietHours?.enabled ?? false}
            onChange={(e) =>
              setSettings({
                ...settings,
                quietHours: {
                  enabled: e.target.checked,
                  start: settings.quietHours?.start ?? "22:00",
                  end: settings.quietHours?.end ?? "08:00",
                },
              })
            }
          />
        </label>
      </section>

      <button type="button" className="card-actions primary" style={{ width: "100%", padding: 12 }} onClick={() => void save()}>
        {saved ? "Saved" : "Save settings"}
      </button>
    </div>
  );
}
