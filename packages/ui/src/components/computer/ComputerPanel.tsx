import { useEffect, useState } from "react";
import type {
  ComputerStatusResponse,
  ComputerTasksResponse,
  LiveViewResponse,
} from "../../api/types.js";
import { computerStatusView } from "../../api/adapters.js";
import { useOpenBot } from "../../state/context.js";

interface ComputerPanelProps {
  botId: string;
}

export function ComputerPanel({ botId }: ComputerPanelProps) {
  const { transport } = useOpenBot();
  const [status, setStatus] = useState<ComputerStatusResponse | null>(null);
  const [live, setLive] = useState<LiveViewResponse | null>(null);
  const [tasks, setTasks] = useState<ComputerTasksResponse["tasks"]>([]);
  const [takeover, setTakeover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [started, setStarted] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [st, tk] = await Promise.all([
          transport.get<{ ready: boolean; detail?: string; provider?: string }>(
            "/api/computer/status",
          ),
          transport.get<ComputerTasksResponse>(`/api/computer/tasks?botId=${botId}`),
        ]);
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
        setTasks(tk.tasks);
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

  return (
    <div className="computer-panel" data-testid="computer-panel">
      <div className="banner banner-warning">{status?.sharedWorkspaceNotice}</div>
      {error && (
        <div className="banner banner-warning" role="alert">
          {error}
        </div>
      )}

      <div className="computer-grid">
        <section className="card">
          <h3 className="card-title">Live view</h3>
          {status?.provider === "local" && status.running ? (
            <p>Your Mac desktop is the live view for local computer tasks.</p>
          ) : live ? (
            <>
              <div className="novnc-frame-wrap">
                <iframe
                  title="Bot screen live view"
                  src={liveSrc}
                  className="novnc-frame"
                  allow="fullscreen"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  className={takeover ? "danger" : "primary"}
                  onClick={() => void toggleTakeover()}
                >
                  {takeover ? "End takeover" : "Take over screen"}
                </button>
              </div>
            </>
          ) : (
            <div className="card-actions">
              <p style={{ color: "var(--text-muted)" }}>
                {status?.running ? "The screen is unavailable." : "The computer is not running."}
              </p>
              <button type="button" className="primary" onClick={() => void startComputer()}>
                {status?.running ? "Retry Live View" : "Start computer"}
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="card-title">Step timeline</h3>
          {tasks.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No active tasks</p>
          ) : (
            tasks.map((task) => (
              <div key={task.id} style={{ marginBottom: 12 }}>
                <strong>{task.goal}</strong>
                <span className="badge" style={{ marginLeft: 8 }}>
                  {task.status}
                </span>
                <ol className="timeline">
                  {(task.timeline ?? []).map((step, i) => (
                    <li key={i}>
                      <time>{new Date(step.ts).toLocaleTimeString()}</time>
                      <span>
                        {step.op}: {step.detail}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
