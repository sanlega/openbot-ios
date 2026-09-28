import { useEffect, useState } from "react";
import { RotateCw, Wifi } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { SettingRow, StatusPill, Toggle } from "../settings/SettingsPrimitives.js";

interface LanState {
  enabled: boolean;
  active: boolean;
  restartRequired: boolean;
  canRestart: boolean;
  addresses: string[];
}

/**
 * "Allow phones on this Wi-Fi": listen on the local network so a phone can pair
 * without Tailscale or Cloudflare. Paired devices still need their key; the QR
 * code's secret is what lets a new phone in.
 */
export function LanAccessRow() {
  const { transport } = useOpenBot();
  const [state, setState] = useState<LanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    transport
      .get<LanState>("/api/remote/lan")
      .then(setState)
      .catch(() => setState(null));
  }, [transport]);

  if (!state) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await transport.put<LanState>("/api/remote/lan", { enabled: !state.enabled }));
    } catch {
      setError("Couldn't change this setting.");
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    try {
      await transport.post("/api/harness/restart");
      // The app reconnects on its own once OpenBot is back.
      setTimeout(() => {
        transport
          .get<LanState>("/api/remote/lan")
          .then((s) => {
            setState(s);
            setBusy(false);
          })
          .catch(() => setBusy(false));
      }, 4000);
    } catch {
      setError("Couldn't restart OpenBot. Quit and open it again.");
      setBusy(false);
    }
  };

  return (
    <>
      <SettingRow
        leading={
          <span className="device-icon" aria-hidden>
            <Wifi size={16} />
          </span>
        }
        label={
          <span className="device-name">
            Phones on this Wi-Fi
            {state.active ? (
              <StatusPill tone="success">On</StatusPill>
            ) : (
              <StatusPill tone="muted">Off</StatusPill>
            )}
          </span>
        }
        help="Pair a phone on the same network without Tailscale. Only devices you pair with the QR code can connect."
      >
        <Toggle
          label="Allow phones on this Wi-Fi"
          checked={state.enabled}
          disabled={busy}
          onChange={() => void toggle()}
        />
      </SettingRow>
      {state.restartRequired ? (
        <div className="lan-restart">
          <span>
            {state.enabled
              ? "Restart OpenBot to start listening on your Wi-Fi."
              : "Restart OpenBot to stop listening on your Wi-Fi."}
          </span>
          {state.canRestart ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void restart()}
            >
              <RotateCw size={13} /> Restart now
            </button>
          ) : null}
        </div>
      ) : state.active && state.addresses.length ? (
        <div className="remote-urls">
          {state.addresses.map((u) => (
            <span key={u} className="pair-url set-mono">
              {u.replace(/^https?:\/\//, "")}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </>
  );
}
