import { useEffect, useState } from "react";
import { LanAccessRow } from "./LanAccessRow.js";
import { PhoneNotifications } from "./PhoneNotifications.js";
import { Check, Copy, Globe, Link2, QrCode, RefreshCw, Smartphone, Tablet } from "lucide-react";
import type { DevicesResponse, PairQrResponse } from "../../api/types.js";
import { remoteStatusView, type HarnessRemoteStatus } from "../../api/adapters.js";
import { useOpenBot } from "../../state/context.js";
import { ScreenHeader } from "../common/ScreenHeader.js";
import { relativeTime } from "../activity/format.js";
import {
  SettingRow,
  SettingsGroup,
  SettingsSection,
  StatusPill,
  Toggle,
} from "../settings/SettingsPrimitives.js";
import { PairingQr } from "./PairingQr.js";

type Device = DevicesResponse["devices"][number] & { revokedAt?: string };

/** `GET /api/remote/status` as the harness returns it (a superset of the adapter's input). */
interface RemoteDetail extends HarnessRemoteStatus {
  tailscale?: HarnessRemoteStatus["tailscale"] & { installed?: boolean };
  cloudflare?: HarnessRemoteStatus["cloudflare"] & { warning?: string };
}

const VIA_LABEL: Record<Device["via"], string> = {
  lan: "Local network",
  tailscale: "Tailscale",
  cloudflare: "Cloudflare",
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function DevicesRemoteView() {
  const { transport } = useOpenBot();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [remote, setRemote] = useState<RemoteDetail | null>(null);
  const [pair, setPair] = useState<PairQrResponse | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const refresh = async () => {
    const [dev, rem] = await Promise.all([
      transport.get<DevicesResponse>("/api/devices").catch(() => ({ devices: [] })),
      transport.get<RemoteDetail>("/api/remote/status").catch(() => ({}) as RemoteDetail),
    ]);
    setDevices((dev.devices as Device[]).filter((d) => !d.revokedAt));
    setRemote(rem);
  };

  useEffect(() => {
    void refresh();
  }, [transport]);

  const newPairCode = async () => {
    setPairing(true);
    setPairError(null);
    try {
      setPair(await transport.post<PairQrResponse>("/api/devices/pair/qr"));
    } catch (err) {
      setPairError(errorText(err, "Couldn't create a pairing code."));
    } finally {
      setPairing(false);
    }
  };

  const count = devices?.length ?? 0;

  return (
    <div className="screen" data-testid="devices-view">
      <ScreenHeader
        title="Devices"
        subtitle="Phones and tablets that can reach this OpenBot"
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={pairing}
            onClick={() => {
              void newPairCode();
              document.getElementById("pair")?.scrollIntoView?.({ behavior: "smooth" });
            }}
          >
            <QrCode size={14} />
            Pair a phone
          </button>
        }
      />
      <div className="screen-body">
        <div className="set-content set-content-single">
          <SettingsSection
            id="paired"
            title="Paired devices"
            description={
              devices === null
                ? undefined
                : count === 0
                  ? "Nothing paired yet."
                  : `${count} ${count === 1 ? "device" : "devices"} can open OpenBot and answer approvals.`
            }
          >
            {devices && devices.length > 0 ? (
              <SettingsGroup>
                {devices.map((d) => (
                  <DeviceRow key={d.id} device={d} onRevoked={() => void refresh()} />
                ))}
              </SettingsGroup>
            ) : devices ? (
              <div className="set-empty">
                <Smartphone size={20} />
                <div>
                  <strong>No devices yet</strong>
                  <span>Pair your phone to chat with your bots and approve actions on the go.</span>
                </div>
              </div>
            ) : null}
          </SettingsSection>

          <SettingsSection
            id="pair"
            title="Pair a phone"
            description="Scan the code with your phone's camera. Owners can do everything; approvers can only answer approval cards."
          >
            <SettingsGroup>
              {pair ? (
                <PairingPanel pair={pair} busy={pairing} onRenew={() => void newPairCode()} />
              ) : (
                <div className="pair-start">
                  <div className="pair-start-icon" aria-hidden>
                    <QrCode size={22} />
                  </div>
                  <div className="pair-start-text">
                    <strong>Show a pairing code</strong>
                    <span>Codes are single-use and expire after a few minutes.</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pairing}
                    onClick={() => void newPairCode()}
                  >
                    {pairing ? "Creating…" : "Show code"}
                  </button>
                </div>
              )}
              {pairError ? <div className="set-row-error">{pairError}</div> : null}
            </SettingsGroup>
          </SettingsSection>

          <RemoteAccess remote={remote} onChanged={() => void refresh()} />
          <PhoneNotifications />
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ device, onRevoked }: { device: Device; onRevoked: () => void }) {
  const { transport } = useOpenBot();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTablet = /ipad|tablet|tab\b/i.test(device.name);

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await transport.delete(`/api/devices/${encodeURIComponent(device.id)}`);
      onRevoked();
    } catch (err) {
      setError(errorText(err, "Couldn't revoke this device."));
      setBusy(false);
    }
  };

  const paired = new Date(device.pairedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  const seen = device.lastSeenAt
    ? `Active ${relativeTime(device.lastSeenAt).toLowerCase()}`
    : "Never connected";

  return (
    <>
      <SettingRow
        leading={
          <span className="device-icon" aria-hidden>
            {isTablet ? <Tablet size={16} /> : <Smartphone size={16} />}
          </span>
        }
        label={
          <span className="device-name">
            {device.name}
            <span className={`pill ${device.role === "owner" ? "pill-accent" : "pill-muted"}`}>
              {device.role === "owner" ? "Owner" : "Approver"}
            </span>
          </span>
        }
        help={`${seen} · ${VIA_LABEL[device.via] ?? device.via} · Paired ${paired}`}
      >
        {confirming ? (
          <div className="set-inline-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => void revoke()}
            >
              {busy ? "Revoking…" : "Revoke access"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Revoke ${device.name}`}
            onClick={() => setConfirming(true)}
          >
            Revoke
          </button>
        )}
      </SettingRow>
      {error ? <div className="set-row-error">{error}</div> : null}
    </>
  );
}

function useCountdown(expiresAt: string): number {
  const target = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => target - Date.now());
  useEffect(() => {
    setLeft(target - Date.now());
    const id = setInterval(() => setLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  return Number.isNaN(left) ? 0 : Math.max(0, left);
}

function formatLeft(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PairingPanel({
  pair,
  busy,
  onRenew,
}: {
  pair: PairQrResponse;
  busy: boolean;
  onRenew: () => void;
}) {
  const left = useCountdown(pair.expiresAt);
  const expired = left <= 0;
  const [copied, setCopied] = useState(false);
  const lanOnly = pair.urls.length > 0 && pair.urls.every((u) => !/ts\.net|https:/.test(u));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pair.qrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="pair-panel" data-testid="pair-qr">
      <div className="pair-qr-wrap" data-expired={expired ? "true" : undefined}>
        <PairingQr value={pair.qrUrl} />
        {expired ? (
          <div className="pair-qr-expired">
            <span>Code expired</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={onRenew}
            >
              <RefreshCw size={13} />
              New code
            </button>
          </div>
        ) : null}
      </div>
      <div className="pair-info">
        <ol className="pair-steps">
          <li>Open the camera on your phone.</li>
          <li>Point it at the code and tap the link.</li>
          <li>Name the device and you're in.</li>
        </ol>
        <div className="pair-expiry" aria-live="polite">
          {expired ? (
            "This code has expired."
          ) : (
            <>
              Expires in <span className="set-mono">{formatLeft(left)}</span>
            </>
          )}
        </div>
        <div className="set-inline-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={expired}
            onClick={() => void copy()}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRenew}>
            <RefreshCw size={13} />
            New code
          </button>
        </div>
        {pair.urls.length ? (
          <div className="pair-urls">
            <span className="pair-urls-label">Reachable at</span>
            {pair.urls.map((u) => (
              <span key={u} className="pair-url set-mono">
                {u.replace(/^https?:\/\//, "")}
              </span>
            ))}
          </div>
        ) : null}
        {lanOnly ? (
          <p className="pair-note">
            Your phone must be on the same Wi-Fi. Turn on remote access below to pair from anywhere.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function RemoteAccess({
  remote,
  onChanged,
}: {
  remote: RemoteDetail | null;
  onChanged: () => void;
}) {
  const { transport } = useOpenBot();
  const summary = remoteStatusView(remote ?? {});
  const ts = remote?.tailscale;
  const cf = remote?.cloudflare;
  const tsOn = summary.enabled && summary.via === "tailscale";
  const cfOn = Boolean(cf?.running);
  const tsMissing = ts?.installed === false;
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<{ which: "ts" | "cf"; text: string } | null>(null);

  const toggleTailscale = async () => {
    setBusy(true);
    setError(null);
    try {
      await transport.post(`/api/remote/tailscale/${tsOn ? "disable" : "enable"}`);
      onChanged();
    } catch (err) {
      setError({ which: "ts", text: errorText(err, "Couldn't change Tailscale.") });
    } finally {
      setBusy(false);
    }
  };

  const connectCloudflare = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await transport.post<{ result?: { ok: boolean; reason?: string } }>(
        "/api/remote/cloudflare",
        { token: token.trim() },
      );
      if (res.result && !res.result.ok) {
        setError({ which: "cf", text: res.result.reason ?? "The tunnel didn't start." });
      } else {
        setToken("");
        onChanged();
      }
    } catch (err) {
      setError({ which: "cf", text: errorText(err, "Couldn't start the tunnel.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      id="remote"
      title="Remote access"
      description="Reach OpenBot when your phone isn't on the same network. Traffic stays end-to-end encrypted either way."
    >
      <SettingsGroup>
        <LanAccessRow />
        <SettingRow
          leading={
            <span className="device-icon" aria-hidden>
              <Link2 size={16} />
            </span>
          }
          label={
            <span className="device-name">
              Tailscale
              {tsMissing ? (
                <StatusPill tone="muted">Not installed</StatusPill>
              ) : tsOn ? (
                <StatusPill tone="success">On</StatusPill>
              ) : (
                <StatusPill tone="muted">Off</StatusPill>
              )}
            </span>
          }
          help={
            tsMissing
              ? "Install Tailscale on this computer and your phone to use your private tailnet."
              : "Private to your tailnet. Recommended."
          }
        >
          <Toggle
            label="Tailscale remote access"
            checked={tsOn}
            disabled={busy || (tsMissing && !tsOn)}
            onChange={() => void toggleTailscale()}
          />
        </SettingRow>
        {tsOn && summary.urls?.length ? (
          <div className="remote-urls">
            {summary.urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="pair-url set-mono">
                {u.replace(/^https?:\/\//, "")}
              </a>
            ))}
          </div>
        ) : null}
        {error?.which === "ts" ? <div className="set-row-error">{error.text}</div> : null}

        <SettingRow
          leading={
            <span className="device-icon" aria-hidden>
              <Globe size={16} />
            </span>
          }
          label={
            <span className="device-name">
              Cloudflare Tunnel
              {cfOn ? (
                <StatusPill tone="success">Running</StatusPill>
              ) : (
                <StatusPill tone="muted">Off</StatusPill>
              )}
            </span>
          }
          help={
            cfOn
              ? cf?.hostname
                ? `Public at ${cf.hostname}`
                : "Tunnel is running."
              : "A public URL through your own Cloudflare account. Paste a tunnel token to start it."
          }
        />
        {cfOn && cf?.warning ? <div className="set-row-note">{cf.warning}</div> : null}
        {!cfOn ? (
          <form
            className="set-row set-key-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim() && !busy) void connectCloudflare();
            }}
          >
            <div className="set-secret">
              <input
                type="password"
                placeholder="Cloudflare tunnel token"
                aria-label="Cloudflare tunnel token"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={busy || !token.trim()}>
              Start tunnel
            </button>
          </form>
        ) : null}
        {error?.which === "cf" ? <div className="set-row-error">{error.text}</div> : null}
      </SettingsGroup>
    </SettingsSection>
  );
}
