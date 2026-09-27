import { useEffect, useState } from "react";
import type { DevicesResponse, PairQrResponse, RemoteStatusResponse } from "../../api/types.js";
import { remoteStatusView, type HarnessRemoteStatus } from "../../api/adapters.js";
import { useOpenBot } from "../../state/context.js";

export function DevicesRemoteView() {
  const { transport } = useOpenBot();
  const [devices, setDevices] = useState<DevicesResponse["devices"]>([]);
  const [remote, setRemote] = useState<RemoteStatusResponse | null>(null);
  const [pair, setPair] = useState<PairQrResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [dev, rem] = await Promise.all([
      transport.get<DevicesResponse>("/api/devices"),
      transport.get<HarnessRemoteStatus>("/api/remote/status"),
    ]);
    setDevices(dev.devices);
    setRemote(remoteStatusView(rem));
  };

  useEffect(() => {
    void refresh();
  }, [transport]);

  const showPairQr = async () => {
    const res = await transport.post<PairQrResponse>("/api/devices/pair/qr");
    setPair(res);
  };

  const toggleTailscale = async () => {
    setBusy(true);
    const action = remote?.enabled ? "disable" : "enable";
    await transport.post(`/api/remote/tailscale/${action}`).catch(() => undefined);
    await refresh();
    setBusy(false);
  };

  return (
    <div className="scroll-panel" data-testid="devices-view">
      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Remote access</h3>
        <div className="settings-row">
          <span>Status</span>
          <span className={remote?.enabled ? "text-success" : "text-danger"}>
            {remote?.enabled ? `Enabled via ${remote.via}` : "Disabled"}
          </span>
        </div>
        {remote?.urls?.length ? (
          <ul className="planned-actions">
            {remote.urls.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void toggleTailscale()}
          >
            {remote?.enabled ? "Disable Tailscale serve" : "Enable Tailscale serve"}
          </button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
          Cloudflare tunnel: configure in Settings → paste tunnel token (WS11).
        </p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Pair a device</h3>
        <button type="button" onClick={() => void showPairQr()}>
          Show QR payload
        </button>
        {pair ? (
          <div className="pair-qr" data-testid="pair-qr">
            <div className="qr-placeholder" aria-label="QR code placeholder">
              ▦ QR
            </div>
            <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{pair.qrUrl}</code>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Expires {new Date(pair.expiresAt).toLocaleTimeString()}
            </p>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h3 className="card-title">Paired devices</h3>
        {devices.map((d) => (
          <div key={d.id} className="settings-row">
            <strong>{d.name}</strong>
            <span className="badge">{d.role}</span>
            <span className="badge">{d.via}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "—"}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
