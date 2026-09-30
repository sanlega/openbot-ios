import { useEffect, useState } from "react";
import type { ModelInfo, SetupState } from "@openbot/contracts";
import { Cpu, Plus, Sparkle, SquareTerminal, Trash2 } from "lucide-react";
import type { CustomEngine, EnginesResponse } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { cleanVersion, engineName } from "./settings-meta.js";
import { SettingRow, SettingsGroup, StatusPill } from "./SettingsPrimitives.js";

type Engine = EnginesResponse["engines"][number];

/** Settings > Engines: every engine OpenBot knows, local models, and owner-added ACP agents. */
export function EnginesSettings({ engines, setup }: { engines: Engine[]; setup: SetupState }) {
  const native = engines.filter((e) => (e.descriptor?.kind ?? "native") === "native");
  const acp = engines.filter((e) => e.descriptor?.kind === "acp" && !e.id.startsWith("acp-"));
  const custom = engines.filter((e) => e.id.startsWith("acp-"));
  return (
    <>
      <SettingsGroup>
        {native.length === 0 && acp.length === 0 ? (
          <SettingRow
            label="No engines detected"
            help="Install Claude Code, Codex, Cursor or OpenCode, then restart OpenBot."
          />
        ) : (
          native.map((e) => <EngineRow key={e.id} engine={e} setup={setup} />)
        )}
      </SettingsGroup>
      {acp.length > 0 ? (
        <SettingsGroup title="More agents (Agent Client Protocol)">
          {acp.map((e) => (
            <EngineRow key={e.id} engine={e} setup={setup} />
          ))}
          <LocalModelsRow />
        </SettingsGroup>
      ) : null}
      <CustomEngines detected={custom} />
    </>
  );
}

function EngineRow({ engine, setup }: { engine: Engine; setup: SetupState }) {
  const version = cleanVersion(engine.version);
  const mode =
    engine.id === "claude"
      ? setup.claude?.mode
      : engine.id === "codex"
        ? setup.codex?.mode
        : undefined;
  const how = mode === "api_key" ? "Using an API key" : mode === "login" ? "Using CLI login" : null;
  const label = engine.descriptor?.label ?? engineName(engine.id);
  const sub = [
    engine.installed && version ? `Version ${version}` : null,
    engine.installed ? how : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const login = engine.descriptor?.loginCommand ?? `${engine.id} login`;
  const hint = !engine.installed
    ? engine.descriptor?.installUrl
      ? `Install it from ${engine.descriptor.installUrl} to let bots use it.`
      : "Install it to let bots use this engine."
    : !engine.login.ok
      ? `Run \`${login}\` in a terminal, then restart OpenBot.`
      : engine.available === false
        ? "Restart OpenBot to let bots use it."
        : null;
  return (
    <SettingRow
      leading={
        <span className="engine-mark" data-engine={engine.id} aria-hidden>
          {engine.id === "claude" ? <Sparkle size={18} /> : <SquareTerminal size={18} />}
        </span>
      }
      label={label}
      help={hint ?? (sub || engine.descriptor?.summary || undefined)}
    >
      {!engine.installed ? (
        <StatusPill tone="muted">Not installed</StatusPill>
      ) : engine.login.ok ? (
        <StatusPill tone="success">
          {engine.login.account ? (
            <>
              Logged in as <span className="set-pill-strong">{engine.login.account}</span>
            </>
          ) : engine.descriptor?.kind === "acp" ? (
            "Ready"
          ) : (
            "Logged in"
          )}
        </StatusPill>
      ) : (
        <StatusPill tone="warning">Not logged in</StatusPill>
      )}
    </SettingRow>
  );
}

/** Models running on this computer (Ollama, LM Studio), which OpenCode Bots can use. */
function LocalModelsRow() {
  const { transport } = useOpenBot();
  const [local, setLocal] = useState<ModelInfo[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void transport
      .get<{ engines: Array<{ engine: string; models: ModelInfo[] }> }>("/api/models")
      .then((res) => {
        if (cancelled) return;
        setLocal(res.engines.flatMap((e) => e.models.filter((m) => m.local)));
      })
      .catch(() => !cancelled && setLocal([]));
    return () => {
      cancelled = true;
    };
  }, [transport]);
  if (local === null) return null;
  return (
    <SettingRow
      leading={
        <span className="engine-mark" aria-hidden>
          <Cpu size={18} />
        </span>
      }
      label="Local models"
      help={
        local.length > 0
          ? `${local
              .slice(0, 4)
              .map((m) => m.label)
              .join(
                ", ",
              )}${local.length > 4 ? `, and ${local.length - 4} more` : ""}. Pick one in a bot's profile (OpenCode).`
          : "Start Ollama or LM Studio (with OpenCode installed) to run bots on this computer, free and private."
      }
    >
      {local.length > 0 ? (
        <StatusPill tone="success">{local.length} found</StatusPill>
      ) : (
        <StatusPill tone="muted">None running</StatusPill>
      )}
    </SettingRow>
  );
}

/** Split a typed command line into words, keeping "quoted parts" together. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) words.push(match[1] ?? match[2] ?? match[3] ?? "");
  return words;
}

function slugOf(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 30) || "agent"
  );
}

/** Other ACP agents (Goose, Qwen Code, Copilot CLI...) added by their command line. */
function CustomEngines({ detected }: { detected: Engine[] }) {
  const { transport } = useOpenBot();
  const [list, setList] = useState<CustomEngine[] | null>(null);
  const [label, setLabel] = useState("");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void transport
      .get<{ engines: CustomEngine[] }>("/api/engines/custom")
      .then((res) => setList(res.engines))
      .catch(() => setList(null));
  }, [transport]);

  if (list === null) return null;

  const save = async (next: CustomEngine[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await transport.put<{ engines: CustomEngine[] }>("/api/engines/custom", {
        engines: next,
      });
      setList(res.engines);
      setNotice("Saved. Restart OpenBot to use the change.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const words = splitCommandLine(line.trim());
    const name = label.trim();
    if (!name || words.length === 0) {
      setError("Give it a name and the command that starts it in ACP mode.");
      return;
    }
    let slug = slugOf(name);
    for (let i = 2; list.some((e) => e.slug === slug); i++) slug = `${slugOf(name)}-${i}`;
    const ok = await save([
      ...list,
      { slug, label: name, command: words[0]!, args: words.slice(1) },
    ]);
    if (ok) {
      setLabel("");
      setLine("");
    }
  };

  return (
    <SettingsGroup title="Your own ACP agents">
      {list.map((e) => {
        const status = detected.find((d) => d.id === `acp-${e.slug}`);
        return (
          <SettingRow key={e.slug} label={e.label} help={[e.command, ...e.args].join(" ")}>
            {status?.available ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : status && !status.installed ? (
              <StatusPill tone="warning">Command not found</StatusPill>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Remove ${e.label}`}
              disabled={busy}
              onClick={() => void save(list.filter((x) => x.slug !== e.slug))}
            >
              <Trash2 size={15} />
            </button>
          </SettingRow>
        );
      })}
      <form
        className="set-row set-key-form set-agent-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!busy) void add();
        }}
      >
        <input
          aria-label="Agent name"
          placeholder="Name (e.g. Goose)"
          value={label}
          onChange={(ev) => {
            setLabel(ev.target.value);
            setError(null);
          }}
        />
        <input
          aria-label="Command line"
          placeholder="Command in ACP mode (e.g. goose acp)"
          spellCheck={false}
          value={line}
          onChange={(ev) => {
            setLine(ev.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          <Plus size={14} /> Add
        </button>
      </form>
      {error ? <div className="set-row-error">{error}</div> : null}
      {notice && !error ? <div className="set-row-note">{notice}</div> : null}
    </SettingsGroup>
  );
}
