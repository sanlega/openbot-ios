import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { SettingRow, SettingsGroup } from "./SettingsPrimitives.js";

interface SavedLogin {
  site: string;
  username?: string;
  hasPassword: boolean;
  updatedAt: string;
}

function reasonOf(err: unknown, fallback: string): string {
  const body = (err as { body?: { reason?: string } } | undefined)?.body;
  return body?.reason ?? fallback;
}

/**
 * Settings > Computer > Saved logins. A Bot's Computer tasks sign in to these sites by themselves:
 * the password stays in the vault and is typed into the virtual machine, never shown to the Bot.
 */
export function SavedLogins() {
  const { transport } = useOpenBot();
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    transport
      .get<{ logins: SavedLogin[] }>("/api/logins")
      .then((r) => setLogins(r.logins))
      .catch(() => setLogins(null));

  useEffect(() => {
    void load();
  }, [transport]);

  if (!logins) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await transport.put(`/api/logins/${encodeURIComponent(site.trim())}`, {
        username: username.trim() || undefined,
        password: password || undefined,
      });
      setSite("");
      setUsername("");
      setPassword("");
      await load();
    } catch (err) {
      setError(reasonOf(err, "Couldn't save this login."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      await transport.delete(`/api/logins/${encodeURIComponent(target)}`);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(reasonOf(err, "Couldn't remove this login."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup title="Saved logins">
      {logins.length === 0 ? (
        <div className="set-row-note">
          No saved logins. When a Bot needs to sign in somewhere it asks you once and saves it here,
          or add one yourself below. Passwords stay on this computer and are typed for the Bot; it
          never sees them.
        </div>
      ) : (
        logins.map((login) => (
          <SettingRow
            key={login.site}
            leading={
              <span className="device-icon" aria-hidden>
                <KeyRound size={16} />
              </span>
            }
            label={<span className="device-name">{login.site}</span>}
            help={`${login.username ?? "No username"}${login.hasPassword ? " · password saved" : ""}`}
          >
            {confirming === login.site ? (
              <div className="set-inline-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => void remove(login.site)}
                >
                  {busy ? "Removing…" : "Remove login"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove the login for ${login.site}`}
                onClick={() => setConfirming(login.site)}
              >
                Remove
              </button>
            )}
          </SettingRow>
        ))
      )}
      <form
        className="set-row push-key-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && site.trim()) void save();
        }}
      >
        <label className="field">
          <span className="field-label">Website</span>
          <input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="example.com"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="field-label">Username or email</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <div className="set-actions">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy || !site.trim() || (!username.trim() && !password)}
          >
            {busy ? "Saving…" : "Save login"}
          </button>
        </div>
      </form>
      {error ? <div className="set-row-error">{error}</div> : null}
    </SettingsGroup>
  );
}
