import { useEffect, useState } from "react";
import type { ComputerStatusResponse, ComputerTasksResponse, LiveViewResponse } from "../../api/types.js";
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [st, lv, tk] = await Promise.all([
        transport.get<ComputerStatusResponse>("/api/computer/status"),
        transport.get<LiveViewResponse>(`/api/computer/screens/${botId}/live`),
        transport.get<ComputerTasksResponse>(`/api/computer/tasks?botId=${botId}`),
      ]);
      if (cancelled) return;
      setStatus(st);
      setLive(lv);
      setTasks(tk.tasks);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [transport, botId]);

  const toggleTakeover = async () => {
    const next = !takeover;
    await transport.post(`/api/computer/screens/${botId}/takeover`, { on: next });
    setTakeover(next);
  };

  if (loading) return <div className="empty-state">Loading computer…</div>;

  const liveSrc = live?.url.startsWith("http") ? live.url : `${transport.baseUrl}${live?.url ?? ""}`;

  return (
    <div className="computer-panel" data-testid="computer-panel">
      <div className="banner banner-warning">
        {status?.sharedWorkspaceNotice}
      </div>

      <div className="computer-grid">
        <section className="card">
          <h3 className="card-title">Live view</h3>
          <div className="novnc-frame-wrap">
            <iframe
              title="Bot screen live view"
              src={liveSrc}
              className="novnc-frame"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
          <div className="card-actions">
            <button type="button" className={takeover ? "danger" : "primary"} onClick={() => void toggleTakeover()}>
              {takeover ? "End takeover" : "Take over screen"}
            </button>
          </div>
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
                  {task.timeline.map((step, i) => (
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
