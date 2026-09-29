import { useEffect, useState } from "react";
import { BellRing, KeyRound, Send } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import {
  SettingRow,
  SettingsGroup,
  SettingsSection,
  StatusPill,
  Toggle,
} from "../settings/SettingsPrimitives.js";

interface PushStatus {
  configured: boolean;
  keyId?: string;
  teamId?: string;
  bundleId: string;
  previews: boolean;
  devices: number;
}

function reasonOf(err: unknown, fallback: string): string {
  const body = (err as { body?: { reason?: string } } | undefined)?.body;
  return body?.reason ?? fallback;
}

/**
 * "Phone notifications": this computer sends notifications to paired iPhones
 * straight to Apple (APNs) with the owner's own key. There is no OpenBot relay.
 */
export function PhoneNotifications() {
  const { transport } = useOpenBot();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyP8, setKeyP8] = useState("");
  const [keyId, setKeyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    transport
      .get<PushStatus>("/api/remote/push")
      .then((s) => {
        setStatus(s);
        setKeyId(s.keyId ?? "");
        setTeamId(s.teamId ?? "");
      })
      .catch(() => setStatus(null));
  }, [transport]);

  if (!status) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await transport.put<PushStatus>("/api/remote/push", {
        keyP8: keyP8.trim() || undefined,
        keyId: keyId.trim().toUpperCase(),
        teamId: teamId.trim().toUpperCase(),
      });
      setStatus(next);
      setKeyP8("");
      setEditing(false);
    } catch (err) {
      setError(reasonOf(err, "Couldn't save the key."));
    } finally {
      setBusy(false);
    }
  };

  const setPreviews = async (previews: boolean) => {
    if (!status.keyId || !status.teamId) return;
    setBusy(true);
    try {
      setStatus(
        await transport.put<PushStatus>("/api/remote/push", {
          keyId: status.keyId,
          teamId: status.teamId,
          bundleId: status.bundleId,
          previews,
        }),
      );
    } catch (err) {
      setError(reasonOf(err, "Couldn't change this setting."));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await transport.post<{ sent: number; failed: number; reasons: string[] }>(
        "/api/remote/push/test",
      );
      if (result.sent) setNote(`Sent to ${result.sent} ${result.sent === 1 ? "phone" : "phones"}.`);
      else if (result.failed) setError(`Apple refused it: ${result.reasons.join(", ")}.`);
      else
        setError("No phone has turned on notifications yet. Do it in the iPhone app's Settings.");
    } catch (err) {
      setError(reasonOf(err, "Couldn't send a test notification."));
    } finally {
      setBusy(false);
    }
  };

  const form = !status.configured || editing;

  return (
    <SettingsSection
      id="phone-notifications"
      title="Phone notifications"
      description="Your iPhone hears about approvals, questions, and replies even when the app is closed. This computer sends them straight to Apple with your own key; nothing goes through OpenBot servers."
    >
      <SettingsGroup>
        <SettingRow
          leading={
            <span className="device-icon" aria-hidden>
              <BellRing size={16} />
            </span>
          }
          label={
            <span className="device-name">
              Apple Push Notifications
              {status.configured ? (
                <StatusPill tone="success">Ready</StatusPill>
              ) : (
                <StatusPill tone="muted">Not set up</StatusPill>
              )}
            </span>
          }
          help={
            status.configured
              ? `Key ${status.keyId} · team ${status.teamId} · ${status.devices} ${status.devices === 1 ? "phone" : "phones"} signed up`
              : "Needs an Apple Developer account. Create an APNs key under Certificates, Identifiers & Profiles → Keys, then add it here."
          }
        >
          {status.configured && !editing ? (
            <div className="set-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !status.devices}
                onClick={() => void sendTest()}
              >
                <Send size={13} /> Send a test
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Change key
              </button>
            </div>
          ) : null}
        </SettingRow>

        {form ? (
          <form
            className="set-row push-key-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void save();
            }}
          >
            <label className="field">
              <span className="field-label">Key ID</span>
              <input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                placeholder="ABC123DEFG"
                autoComplete="off"
                spellCheck={false}
                maxLength={10}
              />
            </label>
            <label className="field">
              <span className="field-label">Team ID</span>
              <input
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="A1B2C3D4E5"
                autoComplete="off"
                spellCheck={false}
                maxLength={10}
              />
            </label>
            <label className="field push-key-field">
              <span className="field-label">
                <KeyRound size={12} /> Key (.p8)
              </span>
              <textarea
                value={keyP8}
                onChange={(e) => setKeyP8(e.target.value)}
                placeholder={
                  status.configured
                    ? "Leave empty to keep the saved key"
                    : "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
                }
                rows={4}
                spellCheck={false}
                autoComplete="off"
              />
              <input
                type="file"
                accept=".p8"
                aria-label="Choose a .p8 file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void file.text().then(setKeyP8);
                }}
              />
            </label>
            <div className="set-actions">
              {editing ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setKeyP8("");
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={
                  busy || !keyId.trim() || !teamId.trim() || (!status.configured && !keyP8.trim())
                }
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : null}

        {status.configured ? (
          <SettingRow
            label="Show message text"
            help="Off: notifications only say which Bot needs you. The text passes through Apple when on."
          >
            <Toggle
              label="Show message text in notifications"
              checked={status.previews}
              disabled={busy}
              onChange={() => void setPreviews(!status.previews)}
            />
          </SettingRow>
        ) : null}
        {note ? <div className="set-row-note">{note}</div> : null}
        {error ? <div className="set-row-error">{error}</div> : null}
      </SettingsGroup>
    </SettingsSection>
  );
}
