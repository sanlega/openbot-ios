import { useEffect, useState } from "react";
import { AlertTriangle, Info, Monitor, MousePointer2 } from "lucide-react";
import type { ComputerStatusResponse, LiveViewResponse } from "../../api/types.js";
import { computerStatusView } from "../../api/adapters.js";
import { useOpenBot } from "../../state/context.js";
import { ComputerTasks } from "./ComputerTasks.js";

interface ComputerPanelProps {
  botId: string;
}

export function ComputerPanel({ botId }: ComputerPanelProps) {
  const { transport } = useOpenBot();
  const [status, setStatus] = useState<ComputerStatusResponse | null>(null);
  const [live, setLive] = useState<LiveViewResponse | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [started, setStarted] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const st = await transport.get<{ ready: boolean; detail?: string; provider?: string }>(
          "/api/computer/status",
        );
        // The live view only exists once the computer is running.
        let lv: LiveViewResponse | null = null;
        let liveError: string | null = null;
        if (st.ready && st.provider !== "local") {
          try {
            lv = await transport.get<LiveViewResponse>(`/api/computer/screens/${botId}/live`);
          } catch (cause) {
            liveError = `Live View could not be loaded: ${String(cause)}`;
          }
        }
        if (cancelled) return;
        setStatus(computerStatusView(st));
        setLive(lv);
        setError(liveError);
      } catch (cause) {
        if (!cancelled) setError(`Computer status could not be loaded: ${String(cause)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transport, botId, started]);

  const startComputer = async () => {
    setLoading(true);
    setError(null);
    try {
      await transport.post("/api/computer/start");
      setStarted((n) => n + 1);
    } catch (cause) {
      setError(
        `Computer could not be started. Check Docker Desktop and the desktop image. ${String(cause)}`,
      );
      setLoading(false);
    }
  };

  const toggleTakeover = async () => {
    const next = !takeover;
    try {
      await transport.post(`/api/computer/screens/${botId}/takeover`, { on: next });
      setTakeover(next);
      setError(null);
    } catch (cause) {
      setError(`Screen takeover failed: ${String(cause)}`);
    }
  };

  if (loading) return <div className="empty-state">Loading computer…</div>;

  const liveSrc = live?.url.startsWith("http")
    ? live.url
    : `${transport.baseUrl}${live?.url ?? ""}`;
  const local = status?.provider === "local" && status.running;

  return (
    <div className="computer-panel" data-testid="computer-panel">
      {error ? (
        <div className="callout callout-danger" role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="settings-card">
        <div className="routine-card-header-row">
          <div className="settings-card-header">
            <h3>Screen</h3>
            <p>
              {local
                ? "Your own desktop is the screen for local computer tasks."
                : live
                  ? "What this bot sees, live. Take over to use it yourself."
                  : status?.running
                    ? "The screen isn't available right now."
                    : "The virtual computer is off. It starts on its own when a bot needs it."}
            </p>
          </div>
          {live && !local ? (
            <button
              type="button"
              className={`btn btn-sm ${takeover ? "btn-danger" : "btn-secondary"}`}
              onClick={() => void toggleTakeover()}
            >
              <MousePointer2 size={14} aria-hidden />
              {takeover ? "End takeover" : "Take over"}
            </button>
          ) : null}
        </div>
        {live && !local ? (
          <div className="novnc-frame-wrap" data-takeover={takeover}>
            <iframe
              title="Bot screen live view"
              src={liveSrc}
              className="novnc-frame"
              allow="fullscreen"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        ) : !local ? (
          <div className="computer-off">
            <Monitor size={28} aria-hidden />
            <button type="button" className="btn btn-primary" onClick={() => void startComputer()}>
              {status?.running ? "Retry live view" : "Start computer"}
            </button>
          </div>
        ) : null}
        <p className="computer-note">
          <Info size={13} aria-hidden /> {status?.sharedWorkspaceNotice}
        </p>
      </section>

      <ComputerTasks botId={botId} />
    </div>
  );
}
