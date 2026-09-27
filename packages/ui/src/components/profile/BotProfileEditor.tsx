import { useEffect, useState, type FormEvent } from "react";
import type { Bot, EngineId, ModelInfo } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";

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
  const [status, setStatus] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    void transport
      .get<{ engines: EngineModels[] }>("/api/models")
      .then((res) => setEngines(res.engines))
      .catch(() => setEngines([]));
  }, [transport]);

  useEffect(() => {
    setName(bot.name);
    setDescription(bot.description);
    setModel(modelKey(bot.routing));
    setEffort(bot.routing.effort ?? "");
    setPermissionPreset(bot.permissionPreset);
    setComputer(bot.computer);
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
    computer !== bot.computer;

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
        <input value={name} onChange={(e) => setName(e.target.value)} />
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
          <option value={AUTO}>Auto: Jev picks per turn</option>
          {!known && current !== AUTO ? (
            <option value={current}>
              {current.endsWith(":") ? `${current.slice(0, -1)} (default model)` : current}
            </option>
          ) : null}
          {engines.map((e) => (
            <optgroup key={e.engine} label={e.engine}>
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
          Reads and edits inside its workspace never need you; anything else asks first.
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
      <div className="settings-card-actions">
        <button type="submit" className="btn btn-primary" disabled={!dirty}>
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
