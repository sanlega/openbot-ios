import { useEffect, useState } from "react";
import type { Bot } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { ConnectorMark } from "../connectors/ConnectorMark.js";
import type { ConnectorConnection } from "../connectors/types.js";

/** Which of the user's connected apps this bot may use (only these are injected into its turns). */
export function BotConnectorsCard({ bot }: { bot: Bot }) {
  const { transport, refresh } = useOpenBot();
  const [connections, setConnections] = useState<ConnectorConnection[] | null>(null);
  const [enabled, setEnabled] = useState<string[]>(bot.connectors);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setEnabled(bot.connectors), [bot.connectors]);
  useEffect(() => {
    transport
      .get<{ connections: ConnectorConnection[] }>("/api/connectors/connections")
      .then((res) => setConnections(res.connections ?? []))
      .catch(() => setConnections([]));
  }, [transport]);

  const toggle = async (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((c) => c !== id) : [...enabled, id];
    setEnabled(next);
    try {
      await transport.put(`/api/bots/${bot.id}/connectors`, { connectors: next });
      await refresh();
      setError(null);
    } catch (err) {
      setEnabled(enabled);
      setError(err instanceof Error ? err.message : "Could not update connectors");
    }
  };

  return (
    <section className="settings-card" data-testid="bot-connectors">
      <div className="settings-card-header">
        <h3>Connectors</h3>
        <p>Apps this bot can use. Changes in an app always ask you first.</p>
      </div>
      {connections === null ? null : connections.length === 0 ? (
        <p className="field-help">
          No apps connected yet. Open Connectors in the sidebar to add GitHub, Notion, Linear, and
          more.
        </p>
      ) : (
        <div className="row-list">
          {connections.map((conn) => {
            const on = enabled.includes(conn.id);
            return (
              <div key={conn.id} className="row">
                <ConnectorMark name={conn.name} size={28} />
                <div className="row-main">
                  <span className="row-title">{conn.name}</span>
                </div>
                <button
                  type="button"
                  className="toggle"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${conn.name} for ${bot.name}`}
                  onClick={() => void toggle(conn.id)}
                />
              </div>
            );
          })}
        </div>
      )}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
