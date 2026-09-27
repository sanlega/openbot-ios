import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bot, Routine, RoutineLimits, RoutineTrigger } from "@openbot/contracts";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Pause,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import type { RoutineRunView } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { BotAvatar } from "../common/BotAvatar.js";
import { ScreenHeader } from "../common/ScreenHeader.js";
import { MessageText } from "../thread/MessageText.js";
import { botNamer, fullTime, relativeTime } from "../activity/format.js";
import { DAYS, buildCron, describeCron, describeTrigger, type SchedulePreset } from "./schedule.js";

type RunView = RoutineRunView & { cause?: string };

/** Same as the harness defaults for routines a bot creates (packages/routines defaults). */
const DEFAULT_LIMITS: RoutineLimits = {
  perRun: { usd: 0.5, tokens: 200_000, turns: 10, computerSteps: 50, wallMin: 15 },
  dailyUsd: 2,
  maxRunsPerDay: 24,
  cooldownSec: 60,
};

function routineStatus(r: Routine): { label: string; tone: string; hint: string } {
  if (!r.enabled) {
    return { label: "Paused", tone: "pill-muted", hint: r.pausedReason ?? "Paused" };
  }
  if (r.liveApproved)
    return { label: "Live", tone: "pill-success", hint: "Runs for real on schedule" };
  return {
    label: "Dry run only",
    tone: "pill-accent",
    hint: "Scheduled runs only rehearse until you turn on live runs",
  };
}

const RUN_STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "pill-muted" },
  running: { label: "Running", tone: "pill-accent" },
  done: { label: "Done", tone: "pill-success" },
  failed: { label: "Failed", tone: "pill-danger" },
  skipped: { label: "Skipped", tone: "pill-muted" },
  capped: { label: "Stopped at limit", tone: "pill-warning" },
};

const CAUSES: Record<string, string> = {
  schedule: "On schedule",
  manual: "Started by you",
  event: "Triggered by an event",
  catch_up: "Catch-up run",
};

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const reason = /"reason":"([^"]+)"/.exec(err.message)?.[1];
    return reason ?? fallback;
  }
  return fallback;
}

export function RoutinesView() {
  const { transport, bots } = useOpenBot();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pane, setPane] = useState<"list" | "detail">("list");
  const names = useMemo(() => botNamer(bots), [bots]);

  const load = useCallback(async () => {
    try {
      const res = await transport.get<{ routines: Routine[] }>("/api/routines");
      setRoutines(res.routines);
      setSelectedId((current) =>
        current && res.routines.some((r) => r.id === current)
          ? current
          : (res.routines[0]?.id ?? null),
      );
    } catch {
      setRoutines((r) => r ?? []);
    }
  }, [transport]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = routines?.find((r) => r.id === selectedId);
  const startCreate = () => {
    setCreating(true);
    setPane("detail");
  };

  return (
    <div className="screen" data-testid="routines-view">
      <ScreenHeader
        title="Routines"
        subtitle="Work your bots do on a schedule or when something happens"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate}>
            <Plus size={14} aria-hidden /> New routine
          </button>
        }
      />
      {routines === null ? (
        <div className="screen-body" />
      ) : routines.length === 0 && !creating ? (
        <div className="screen-body">
          <div className="empty-block empty-block-page">
            <CalendarClock size={26} aria-hidden />
            <p className="empty-title">No routines yet</p>
            <p className="empty-text">
              Ask a bot to set one up — “every weekday at 9, summarize my inbox” — or create one
              yourself. New routines start as dry runs, so nothing happens for real until you say
              so.
            </p>
            <button type="button" className="btn btn-primary" onClick={startCreate}>
              <Plus size={14} aria-hidden /> Create a routine
            </button>
          </div>
        </div>
      ) : (
        <div className="split" data-pane={pane}>
          <nav className="split-nav" aria-label="Routine list">
            {routines.map((r) => {
              const status = routineStatus(r);
              const bot = names.get(r.botId);
              return (
                <button
                  key={r.id}
                  type="button"
                  className="split-item"
                  aria-current={!creating && r.id === selectedId ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(r.id);
                    setCreating(false);
                    setPane("detail");
                  }}
                >
                  {bot ? <BotAvatar bot={bot} size={28} /> : null}
                  <span className="split-item-main">
                    <span className="split-item-title">{r.name}</span>
                    <span className="split-item-sub">{describeTrigger(r.trigger)}</span>
                  </span>
                  <span className={`pill ${status.tone}`}>{status.label}</span>
                  <ChevronRight size={14} className="split-item-chevron" aria-hidden />
                </button>
              );
            })}
          </nav>
          <div className="split-detail-pane">
            <button type="button" className="split-back" onClick={() => setPane("list")}>
              <ChevronLeft size={16} aria-hidden /> All routines
            </button>
            {creating ? (
              <NewRoutineForm
                bots={bots}
                onCancel={() => {
                  setCreating(false);
                  setPane("list");
                }}
                onCreated={async (routine) => {
                  setCreating(false);
                  await load();
                  setSelectedId(routine.id);
                }}
              />
            ) : selected ? (
              <RoutineDetail
                key={selected.id}
                routine={selected}
                bot={names.get(selected.botId)}
                botName={names.name(selected.botId)}
                onChanged={load}
                onDeleted={async () => {
                  setSelectedId(null);
                  setPane("list");
                  await load();
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RoutineDetail({
  routine,
  bot,
  botName,
  onChanged,
  onDeleted,
}: {
  routine: Routine;
  bot?: Bot;
  botName: string;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { transport } = useOpenBot();
  const [runs, setRuns] = useState<RunView[] | null>(null);
  const [prompt, setPrompt] = useState(routine.prompt);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = routineStatus(routine);
  const dirty = prompt !== routine.prompt;

  const loadRuns = useCallback(async () => {
    try {
      const res = await transport.get<{ runs: RunView[] }>(`/api/routines/${routine.id}/runs`);
      setRuns(
        [...res.runs].sort((a, b) =>
          (b.startedAt ?? b.endedAt ?? "").localeCompare(a.startedAt ?? a.endedAt ?? ""),
        ),
      );
    } catch {
      setRuns((r) => r ?? []);
    }
  }, [transport, routine.id]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Poll while a run is in flight.
  const inFlight = runs?.some((r) => r.status === "queued" || r.status === "running") ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      void loadRuns();
      void onChanged();
    }, 1500);
    return () => clearInterval(timer);
  }, [inFlight, loadRuns, onChanged]);

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice({ tone: "ok", text: ok });
      await Promise.all([onChanged(), loadRuns()]);
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err, "That didn't work. Try again.") });
    } finally {
      setBusy(null);
    }
  };

  const run = (dryRun: boolean) =>
    act(
      dryRun ? "dry" : "run",
      () => transport.post(`/api/routines/${routine.id}/run`, { dryRun }),
      dryRun ? "Dry run started — the plan will appear below." : "Run started.",
    );

  const hasGoodDryRun = runs?.some((r) => r.dryRun && r.status === "done") ?? false;
  const lastRun = runs?.[0];

  return (
    <div className="routine-detail">
      <header className="routine-head">
        <div className="routine-head-main">
          <h2 className="routine-title">{routine.name}</h2>
          <div className="routine-meta">
            <span className={`pill ${status.tone}`}>{status.label}</span>
            <span className="routine-meta-item">
              {bot ? <BotAvatar bot={bot} size={18} /> : null}
              {botName}
            </span>
            <span className="routine-meta-item">
              <CalendarClock size={14} aria-hidden />
              {describeTrigger(routine.trigger)}
            </span>
          </div>
        </div>
        <div className="routine-head-actions">
          {routine.enabled ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() =>
                void act("pause", () => transport.post(`/api/routines/${routine.id}/pause`, {}))
              }
            >
              <Pause size={13} aria-hidden /> Pause
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() =>
                void act("resume", () => transport.post(`/api/routines/${routine.id}/resume`, {}))
              }
            >
              <Play size={13} aria-hidden /> Resume
            </button>
          )}
        </div>
      </header>

      {!routine.enabled ? (
        <div className="callout callout-muted">
          <Pause size={15} aria-hidden />
          <div>
            <strong>Paused.</strong> It won't run on its own until you resume it
            {routine.pausedReason && routine.pausedReason !== "paused by user"
              ? ` (${routine.pausedReason})`
              : ""}
            .
          </div>
        </div>
      ) : !routine.liveApproved ? (
        <div className="callout callout-accent">
          <FlaskConical size={15} aria-hidden />
          <div className="callout-body">
            <div>
              <strong>Dry run only.</strong> Scheduled runs rehearse: {botName} plans the work, but
              nothing is sent or changed. Turn on live runs once a dry run looks right.
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null || !hasGoodDryRun}
              title={hasGoodDryRun ? undefined : "Do a dry run first"}
              onClick={() =>
                void act(
                  "live",
                  () => transport.post(`/api/routines/${routine.id}/enable-live`, {}),
                  "Live runs are on.",
                )
              }
            >
              <Zap size={13} aria-hidden /> Turn on live runs
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={notice.tone === "ok" ? "form-ok" : "form-error"} role="status">
          {notice.text}
        </p>
      ) : null}

      <section className="settings-card">
        <div className="settings-card-header">
          <h3>Try it</h3>
          <p>
            <strong>Dry run</strong> rehearses without side effects and lists what it would do.{" "}
            <strong>Run now</strong> does it for real, once; anything risky still asks you first.
          </p>
        </div>
        <div className="settings-card-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null || inFlight}
            onClick={() => void run(true)}
          >
            <FlaskConical size={14} aria-hidden /> Dry run
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null || inFlight}
            onClick={() => void run(false)}
          >
            <Play size={14} aria-hidden /> Run now
          </button>
          {inFlight ? <span className="routine-running">Running…</span> : null}
          {!inFlight && lastRun?.endedAt ? (
            <span className="routine-last">Last run {relativeTime(lastRun.endedAt)}</span>
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <h3>Instructions</h3>
          <p>What {botName} does each time this routine runs.</p>
        </div>
        <div className="field">
          <label className="screens-sr-only" htmlFor={`prompt-${routine.id}`}>
            Instructions
          </label>
          <textarea
            id={`prompt-${routine.id}`}
            value={prompt}
            rows={5}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="settings-card-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || !prompt.trim() || busy !== null}
            onClick={() =>
              void act(
                "save",
                () => transport.patch(`/api/routines/${routine.id}`, { prompt: prompt.trim() }),
                "Instructions saved.",
              )
            }
          >
            Save
          </button>
          {dirty ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setPrompt(routine.prompt)}
            >
              Discard changes
            </button>
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header routine-card-header-row">
          <div>
            <h3>Schedule</h3>
            <p>
              {describeTrigger(routine.trigger)}
              {routine.trigger.type === "schedule" ? ` · ${routine.trigger.timezone}` : ""}
            </p>
          </div>
          {routine.trigger.type === "schedule" && !editingSchedule ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditingSchedule(true)}
            >
              Change
            </button>
          ) : null}
        </div>
        {editingSchedule && routine.trigger.type === "schedule" ? (
          <ScheduleEditor
            initialCron={routine.trigger.cron}
            submitLabel="Save schedule"
            busy={busy !== null}
            onCancel={() => setEditingSchedule(false)}
            onSubmit={(cron) =>
              void act(
                "schedule",
                async () => {
                  const trigger: RoutineTrigger = {
                    ...(routine.trigger as Extract<RoutineTrigger, { type: "schedule" }>),
                    cron,
                    at: undefined,
                  };
                  await transport.patch(`/api/routines/${routine.id}`, { trigger });
                  setEditingSchedule(false);
                },
                "Schedule saved.",
              )
            }
          />
        ) : null}
        <p className="field-help">
          Limits: up to ${routine.limits.perRun.usd.toFixed(2)} and {routine.limits.perRun.turns}{" "}
          turns per run · at most {routine.limits.maxRunsPerDay} runs and $
          {routine.limits.dailyUsd.toFixed(2)} a day.
        </p>
      </section>

      <section className="routine-runs">
        <h3 className="section-title">Run history</h3>
        {runs === null ? null : runs.length === 0 ? (
          <div className="empty-block">
            <p className="empty-title">No runs yet</p>
            <p className="empty-text">Start with a dry run to see what it would do.</p>
          </div>
        ) : (
          <ol className="row-list run-list">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ol>
        )}
      </section>

      <div className="danger-zone">
        {confirmDelete ? (
          <>
            <span>Delete “{routine.name}”? Its run history goes too.</span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy !== null}
              onClick={() =>
                void (async () => {
                  setBusy("delete");
                  try {
                    await transport.delete(`/api/routines/${routine.id}`);
                    await onDeleted();
                  } catch (err) {
                    setNotice({ tone: "error", text: errorText(err, "Could not delete it.") });
                    setBusy(null);
                  }
                })()
              }
            >
              Delete
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm danger-text"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={13} aria-hidden /> Delete routine
          </button>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false);
  const status = RUN_STATUS[run.status] ?? { label: run.status, tone: "pill-muted" };
  const ts = run.startedAt ?? run.endedAt;
  const durationSec =
    run.startedAt && run.endedAt
      ? Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000))
      : undefined;
  const tokens = run.usage.inputTokens + run.usage.outputTokens;
  const hasMore = Boolean(run.resultSummary || run.plannedActions?.length || run.skipReason);
  return (
    <li className="run-row">
      <button
        type="button"
        className="run-row-head"
        aria-expanded={hasMore ? open : undefined}
        onClick={() => hasMore && setOpen((v) => !v)}
      >
        <span className={`pill ${status.tone}`}>{status.label}</span>
        <span className={`pill ${run.dryRun ? "pill-muted" : "pill-success"}`}>
          {run.dryRun ? "Dry run" : "Live"}
        </span>
        <span className="run-row-main">
          {run.cause ? (CAUSES[run.cause] ?? run.cause) : run.dryRun ? "Rehearsal" : "Run"}
          {run.plannedActions?.length
            ? ` · ${run.plannedActions.length} planned ${run.plannedActions.length === 1 ? "action" : "actions"}`
            : ""}
        </span>
        <span className="run-row-meta">
          {durationSec !== undefined ? `${formatDuration(durationSec)} · ` : ""}
          {tokens > 0 ? `$${run.usage.usd.toFixed(2)} · ` : ""}
          {ts ? (
            <time dateTime={ts} title={fullTime(ts)}>
              {relativeTime(ts)}
            </time>
          ) : (
            "Not started"
          )}
        </span>
        {hasMore ? <ChevronRight size={14} className="audit-chevron" aria-hidden /> : null}
      </button>
      {open ? (
        <div className="run-row-body">
          {run.skipReason ? <p className="field-help">Skipped: {run.skipReason}</p> : null}
          {run.plannedActions?.length ? (
            <div>
              <div className="run-row-label">Would have done</div>
              <ul className="planned-list">
                {run.plannedActions.map((a, i) => (
                  <li key={`${i}-${a}`}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {run.resultSummary ? (
            <div>
              <div className="run-row-label">Result</div>
              <div className="run-result">
                <MessageText text={run.resultSummary} markdown />
              </div>
            </div>
          ) : null}
          {tokens > 0 ? <p className="field-help">{tokens.toLocaleString()} tokens used</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ------------------------------------------------------------------ */

const PRESETS: Array<{ id: SchedulePreset; label: string }> = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "interval", label: "Repeating" },
  { id: "custom", label: "Custom" },
];

const INTERVALS = [15, 30, 60, 120, 240, 360, 720];

function presetFromCron(cron?: string): {
  preset: SchedulePreset;
  time: string;
  weekday: number;
  everyMin: number;
} {
  const base = { preset: "daily" as SchedulePreset, time: "09:00", weekday: 1, everyMin: 60 };
  if (!cron) return base;
  const [min, hour, dom, month, dow] = cron.trim().split(/\s+/);
  const everyMin = /^\*\/(\d+)$/.exec(min ?? "");
  if (everyMin && hour === "*")
    return { ...base, preset: "interval", everyMin: Number(everyMin[1]) };
  const everyHour = /^\*\/(\d+)$/.exec(hour ?? "");
  if (min === "0" && everyHour) {
    return { ...base, preset: "interval", everyMin: Number(everyHour[1]) * 60 };
  }
  if (min === "0" && hour === "*") return { ...base, preset: "interval", everyMin: 60 };
  if (/^\d+$/.test(min ?? "") && /^\d+$/.test(hour ?? "") && dom === "*" && month === "*") {
    const time = `${hour!.padStart(2, "0")}:${min!.padStart(2, "0")}`;
    if (dow === "*") return { ...base, preset: "daily", time };
    if (dow === "1-5") return { ...base, preset: "weekdays", time };
    if (/^\d$/.test(dow ?? ""))
      return { ...base, preset: "weekly", time, weekday: Number(dow) % 7 };
  }
  return { ...base, preset: "custom" };
}

/** Rough client-side check of the harness's 15-minute minimum. */
function tooFrequent(cron: string): boolean {
  const [min, hour] = cron.split(/\s+/);
  if (min === "*") return true;
  const step = /^\*\/(\d+)$/.exec(min ?? "");
  if (step && hour === "*" && Number(step[1]) < 15) return true;
  return false;
}

function ScheduleEditor({
  initialCron,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  onChange,
}: {
  initialCron?: string;
  submitLabel?: string;
  busy?: boolean;
  onSubmit?: (cron: string) => void;
  onCancel?: () => void;
  onChange?: (cron: string, valid: boolean) => void;
}) {
  const initial = useMemo(() => presetFromCron(initialCron), [initialCron]);
  const [preset, setPreset] = useState<SchedulePreset>(initial.preset);
  const [time, setTime] = useState(initial.time);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [everyMin, setEveryMin] = useState(initial.everyMin);
  const [custom, setCustom] = useState(initialCron ?? "0 9 * * *");
  const cron = buildCron(preset, { time, weekday, everyMin, custom });
  const words = describeCron(cron);
  const error =
    cron.split(/\s+/).length !== 5
      ? "A cron expression has five parts: minute hour day month weekday."
      : tooFrequent(cron)
        ? "Routines can run at most every 15 minutes."
        : null;

  useEffect(() => {
    onChange?.(cron, !error);
  }, [cron, error, onChange]);

  return (
    <div className="schedule-editor">
      <div className="filter-tabs" role="group" aria-label="How often">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="filter-tab"
            aria-pressed={preset === p.id}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="schedule-fields">
        {preset === "weekly" ? (
          <label className="field">
            <span className="field-label">Day</span>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {preset === "daily" || preset === "weekdays" || preset === "weekly" ? (
          <label className="field">
            <span className="field-label">At</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value || "09:00")} />
          </label>
        ) : null}
        {preset === "interval" ? (
          <label className="field">
            <span className="field-label">Every</span>
            <select value={everyMin} onChange={(e) => setEveryMin(Number(e.target.value))}>
              {INTERVALS.map((n) => (
                <option key={n} value={n}>
                  {n < 60 ? `${n} minutes` : n === 60 ? "hour" : `${n / 60} hours`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {preset === "custom" ? (
          <label className="field schedule-cron">
            <span className="field-label">Cron expression</span>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              spellCheck={false}
              placeholder="0 9 * * 1-5"
            />
          </label>
        ) : null}
      </div>
      <p className={error ? "form-error" : "field-help"}>
        {error ?? (words ? `${words}.` : `Runs on cron “${cron}”.`)}
      </p>
      {onSubmit ? (
        <div className="settings-card-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || Boolean(error)}
            onClick={() => onSubmit(cron)}
          >
            {submitLabel ?? "Save"}
          </button>
          {onCancel ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NewRoutineForm({
  bots,
  onCancel,
  onCreated,
}: {
  bots: Bot[];
  onCancel: () => void;
  onCreated: (routine: Routine) => Promise<void>;
}) {
  const { transport } = useOpenBot();
  const active = bots.filter((b) => !b.archivedAt);
  const [botId, setBotId] = useState(
    active.find((b) => !b.isChiefOfStaff)?.id ?? active[0]?.id ?? "",
  );
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [cronValid, setCronValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onScheduleChange = useCallback((next: string, valid: boolean) => {
    setCron(next);
    setCronValid(valid);
  }, []);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const canSubmit = Boolean(botId && name.trim() && prompt.trim() && cronValid) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await transport.post<{ routine: Routine }>("/api/routines", {
        botId,
        name: name.trim(),
        prompt: prompt.trim(),
        trigger: { type: "schedule", cron, timezone, catchUp: "none" },
        limits: DEFAULT_LIMITS,
      });
      await onCreated(res.routine);
    } catch (err) {
      setError(errorText(err, "Could not create the routine."));
      setBusy(false);
    }
  };

  return (
    <form
      className="routine-detail"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <header className="routine-head">
        <div className="routine-head-main">
          <h2 className="routine-title">New routine</h2>
          <p className="routine-lede">
            It starts as a dry run: the bot rehearses and shows you what it would do. Turn on live
            runs when you're happy with it.
          </p>
        </div>
      </header>
      <section className="settings-card">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning briefing"
            maxLength={80}
          />
        </label>
        <label className="field">
          <span className="field-label">Bot</span>
          <select value={botId} onChange={(e) => setBotId(e.target.value)}>
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">What should it do?</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Check my calendar and inbox, then send me a short plan for the day."
          />
          <span className="field-help">Write it like a message to the bot.</span>
        </label>
      </section>
      <section className="settings-card">
        <div className="settings-card-header">
          <h3>When</h3>
          <p>Times are in {timezone}.</p>
        </div>
        <ScheduleEditor initialCron="0 9 * * *" onChange={onScheduleChange} />
      </section>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="settings-card-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Create routine
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
