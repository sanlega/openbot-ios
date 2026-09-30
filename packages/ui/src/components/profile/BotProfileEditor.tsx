import { useEffect, useState, type FormEvent } from "react";
import type { Bot, EngineId, ModelInfo } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { engineName } from "../settings/settings-meta.js";

interface EngineModels {
  engine: EngineId;
  models: ModelInfo[];
}

const AUTO = "auto";

/** The Bot's editable settings: identity, model (Jev's pick, or auto per turn), permissions. */
export function BotProfileEditor({ bot }: { bot: Bot }) {
  const { transport, refresh, threads, selectThread } = useOpenBot();
  const [engines, setEngines] = useState<EngineModels[]>([]);
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [model, setModel] = useState(modelKey(bot.routing));
  const [effort, setEffort] = useState(bot.routing.effort ?? "");
  const [permissionPreset, setPermissionPreset] = useState(bot.permissionPreset);
  const [computer, setComputer] = useState(bot.computer);
  const [unrestrictedRoutineBudget, setUnrestrictedRoutineBudget] = useState(
    bot.limits.unrestrictedRoutineBudget ?? false,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    setModelsLoading(true);
    void transport
      .get<{ engines: EngineModels[] }>("/api/models")
      .then((res) => setEngines(res.engines))
      .catch(() => setEngines([]))
      .finally(() => setModelsLoading(false));
  }, [transport]);

  useEffect(() => {
    setName(bot.name);
    setDescription(bot.description);
    setModel(modelKey(bot.routing));
    setEffort(bot.routing.effort ?? "");
    setPermissionPreset(bot.permissionPreset);
    setComputer(bot.computer);
    setUnrestrictedRoutineBudget(bot.limits.unrestrictedRoutineBudget ?? false);
  }, [bot]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const [engine, ...rest] = model.split(":");
    const routing: Bot["routing"] =
      model === AUTO
        ? { mode: "auto" }
        : {
            mode: "pinned",
            engine: engine as EngineId,
            model: rest.join(":"),
            effort: (effort || undefined) as Bot["routing"]["effort"],
          };
    try {
      await transport.patch(`/api/bots/${bot.id}`, {
        name: name.trim() || bot.name,
        description,
        routing,
        permissionPreset,
        computer,
        limits: { ...bot.limits, unrestrictedRoutineBudget },
      });
      await refresh();
      setStatus("Saved");
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save");
    }
  };

  const archive = async () => {
    try {
      await transport.delete(`/api/bots/${bot.id}`);
      await refresh();
      selectThread(threads.find((t) => t.botId !== bot.id)?.id ?? null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not archive");
    }
  };

  const dirty =
    name !== bot.name ||
    description !== bot.description ||
    model !== modelKey(bot.routing) ||
    effort !== (bot.routing.effort ?? "") ||
    permissionPreset !== bot.permissionPreset ||
    computer !== bot.computer ||
    unrestrictedRoutineBudget !== (bot.limits.unrestrictedRoutineBudget ?? false);

  const current = modelKey(bot.routing);
  const known = engines.some((e) => e.models.some((m) => `${e.engine}:${m.id}` === current));

  return (
    <form className="settings-card" data-testid="bot-profile" onSubmit={(e) => void save(e)}>
      <div className="settings-card-header">
        <h3>Profile</h3>
        <p>How this bot introduces itself and the standing instructions it always follows.</p>
      </div>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!name.trim() || undefined}
          aria-describedby={!name.trim() ? "profile-name-error" : undefined}
        />
        {!name.trim() ? (
          <span className="form-error" id="profile-name-error">
            A bot needs a name.
          </span>
        ) : null}
      </label>
      <label className="field">
        <span className="field-label">Instructions</span>
        <span className="field-help">What it's for and the rules it always follows.</span>
        <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Model</span>
        <span className="field-help">
          {model === AUTO
            ? "Jev picks the engine and model for each message."
            : "Every message runs on this model."}
        </span>
        <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value={AUTO}>Auto (the best model for each message)</option>
          {modelsLoading ? (
            <option value="" disabled>
              Loading the engines' models…
            </option>
          ) : null}
          {!known && current !== AUTO ? (
            <option value={current}>
              {current.endsWith(":") ? `${current.slice(0, -1)} (default model)` : current}
            </option>
          ) : null}
          {engines.map((e) => (
            <optgroup key={e.engine} label={engineName(e.engine)}>
              {e.models.map((m) => (
                <option key={m.id} value={`${e.engine}:${m.id}`}>
                  {m.label ?? m.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {model !== AUTO ? (
        <label className="field">
          <span className="field-label">Effort</span>
          <select aria-label="Effort" value={effort} onChange={(e) => setEffort(e.target.value)}>
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      ) : null}
      <label className="field">
        <span className="field-label">Permissions</span>
        <span className="field-help">
          {permissionPreset === "full"
            ? "Runs commands and edits without asking. Logins, payments, connected apps and anything Jev is sure can't be undone still ask you."
            : permissionPreset === "read_only"
              ? "Can read, but asks you before changing anything."
              : "Reads and edits inside its workspace never need you; anything else asks first."}
        </span>
        <select
          aria-label="Permissions"
          value={permissionPreset}
          onChange={(e) => setPermissionPreset(e.target.value as Bot["permissionPreset"])}
        >
          <option value="read_only">Read only</option>
          <option value="workspace_write">Write in workspace</option>
          <option value="full">Full</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Computer</span>
        <select
          aria-label="Computer"
          value={computer}
          onChange={(e) => setComputer(e.target.value as Bot["computer"])}
        >
          <option value="none">None</option>
          <option value="docker">Docker</option>
          <option value="docker+local">Docker + this computer</option>
        </select>
      </label>
      <label className="field field-checkbox">
        <input
          type="checkbox"
          checked={unrestrictedRoutineBudget}
          onChange={(e) => setUnrestrictedRoutineBudget(e.target.checked)}
        />
        <span>
          <span className="field-label">Let its routines run past their cost/token cap</span>
          <span className="field-help">
            Off by default: a routine run that passes its own per-run cost or token limit is stopped
            mid-task. Turn this on for this bot if you'd rather it finish a long task than get cut
            off — you're still protected by the routine's daily limit and run count.
          </span>
        </span>
      </label>
      <div className="settings-card-actions">
        <button type="submit" className="btn btn-primary" disabled={!dirty || !name.trim()}>
          Save
        </button>
        {status ? <span className="save-status">{status}</span> : null}
      </div>
      {!bot.isChiefOfStaff ? (
        <div className="danger-zone">
          {confirmArchive ? (
            <>
              <span>Archive {bot.name}? Its history is kept.</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void archive()}
              >
                Archive
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmArchive(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm danger-text"
              onClick={() => setConfirmArchive(true)}
            >
              Archive bot
            </button>
          )}
        </div>
      ) : null}
    </form>
  );
}

function modelKey(routing: Bot["routing"]): string {
  if (routing.mode !== "pinned" || !routing.engine) return AUTO;
  return `${routing.engine}:${routing.model ?? ""}`;
}
