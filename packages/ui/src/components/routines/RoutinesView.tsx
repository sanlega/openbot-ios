import { useEffect, useState } from "react";
import type { Routine } from "@openbot/contracts";
import type { RoutineRunView } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";

export function RoutinesView() {
  const { transport } = useOpenBot();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRunView[]>([]);
  const [editorPrompt, setEditorPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await transport.get<{ routines: Routine[] }>("/api/routines");
    setRoutines(res.routines);
    if (!selectedId && res.routines[0]) setSelectedId(res.routines[0].id);
  };

  useEffect(() => {
    void load();
  }, [transport]);

  useEffect(() => {
    if (!selectedId) return;
    const routine = routines.find((r) => r.id === selectedId);
    setEditorPrompt(routine?.prompt ?? "");
    void transport
      .get<{ runs: RoutineRunView[] }>(`/api/routines/${selectedId}/runs`)
      .then((res) => {
        setRuns(res.runs);
      });
  }, [selectedId, routines, transport]);

  const selected = routines.find((r) => r.id === selectedId);
  const latestDry = runs.find((r) => r.dryRun);

  const runRoutine = async (dryRun: boolean) => {
    if (!selectedId) return;
    setBusy(true);
    await transport.post(`/api/routines/${selectedId}/run`, { dryRun });
    const res = await transport.get<{ runs: RoutineRunView[] }>(`/api/routines/${selectedId}/runs`);
    setRuns(res.runs);
    await load();
    setBusy(false);
  };

  const enableLive = async () => {
    if (!selectedId) return;
    setBusy(true);
    await transport.post(`/api/routines/${selectedId}/enable-live`);
    await load();
    setBusy(false);
  };

  return (
    <div className="scroll-panel" data-testid="routines-view">
      <div className="split-list">
        <div className="split-list-items">
          {routines.map((r) => (
            <button
              key={r.id}
              type="button"
              className="bot-item"
              data-active={r.id === selectedId}
              onClick={() => setSelectedId(r.id)}
            >
              <span className="bot-meta">
                <span className="bot-name">{r.name}</span>
                <span className="bot-preview">
                  {r.liveApproved ? "Live approved" : "Dry run only"}
                  {r.trigger.type === "schedule" ? ` · ${r.trigger.cron}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="split-detail">
            <h2 className="panel-title">{selected.name}</h2>
            <div className="setup-step">
              <label htmlFor="routine-prompt">Prompt</label>
              <textarea
                id="routine-prompt"
                className="textarea"
                value={editorPrompt}
                onChange={(e) => setEditorPrompt(e.target.value)}
                rows={4}
              />
            </div>
            <div className="card-actions">
              <button type="button" disabled={busy} onClick={() => void runRoutine(true)}>
                Dry run
              </button>
              <button type="button" disabled={busy} onClick={() => void runRoutine(false)}>
                Test run
              </button>
              {!selected.liveApproved && latestDry?.plannedActions?.length ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void enableLive()}
                >
                  Enable live
                </button>
              ) : null}
            </div>

            <h3 className="card-title" style={{ marginTop: 20 }}>
              Run history
            </h3>
            {runs.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No runs yet</p>
            ) : (
              runs.map((run) => (
                <article key={run.id} className="activity-item">
                  <time>{new Date(run.startedAt ?? run.endedAt ?? "").toLocaleString()}</time>
                  <div>
                    <span className="badge">{run.dryRun ? "dry run" : "live"}</span>{" "}
                    <span className="badge">{run.status}</span>
                  </div>
                  <div>{run.resultSummary}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    ${run.usage.usd.toFixed(2)} · {run.usage.tokens.toLocaleString()} tokens
                  </div>
                  {run.plannedActions?.length ? (
                    <ul className="planned-actions">
                      {run.plannedActions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
