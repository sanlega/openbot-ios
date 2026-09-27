import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarClock,
  MonitorSmartphone,
  PenSquare,
  Plug,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { AppScreen } from "../../api/types.js";
import { useOptionalOpenBot } from "../../state/context.js";
import { BotAvatar } from "../common/BotAvatar.js";

interface CommandPaletteProps {
  onClose: () => void;
  onNavigate: (view: AppScreen) => void;
  /** Opens a bot's thread (selects it and shows the chat). */
  onOpenThread?: (threadId: string) => void;
  onNewBot?: () => void;
}

interface Command {
  id: string;
  group: "Bots" | "Go to" | "Actions";
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl+";

/** ⌘K: jump to any bot or screen, or run an action. */
export function CommandPalette({
  onClose,
  onNavigate,
  onOpenThread,
  onNewBot,
}: CommandPaletteProps) {
  const openbot = useOptionalOpenBot();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const bots: Command[] = (openbot?.threads ?? []).flatMap((thread) => {
      const bot = openbot?.bots.find((b) => b.id === thread.botId);
      if (!bot || bot.archivedAt) return [];
      return [
        {
          id: `bot-${bot.id}`,
          group: "Bots" as const,
          label: bot.name,
          hint: bot.isChiefOfStaff ? "Chief of Staff" : bot.label,
          icon: <BotAvatar bot={bot} size={20} />,
          keywords: bot.description,
          run: () => onOpenThread?.(thread.id),
        },
      ];
    });
    const screens: Array<[AppScreen, string, ReactNode, string?]> = [
      ["activity", "Activity", <Activity key="a" size={16} />, "inbox needs you feed"],
      ["routines", "Routines", <CalendarClock key="r" size={16} />, "schedule cron"],
      ["connectors", "Connectors", <Plug key="c" size={16} />, "apps integrations mcp"],
      ["audit", "Audit log", <ShieldCheck key="u" size={16} />, "approvals history"],
      [
        "devices",
        "Devices and remote access",
        <MonitorSmartphone key="d" size={16} />,
        "phone pair",
      ],
      ["settings", "Settings", <Settings key="s" size={16} />, "preferences theme keys"],
    ];
    const goTo: Command[] = screens.map(([view, label, icon, keywords]) => ({
      id: `go-${view}`,
      group: "Go to",
      label,
      icon,
      keywords,
      hint: view === "settings" ? `${MOD_KEY},` : undefined,
      run: () => onNavigate(view),
    }));
    const actions: Command[] = [
      {
        id: "new-bot",
        group: "Actions",
        label: "Create a bot",
        hint: `${MOD_KEY}N`,
        icon: <PenSquare size={16} />,
        keywords: "new add",
        run: () => onNewBot?.(),
      },
    ];
    return [...bots, ...goTo, ...actions];
  }, [openbot?.threads, openbot?.bots, onNavigate, onOpenThread, onNewBot]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      [c.label, c.hint, c.keywords].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[active]) {
        e.preventDefault();
        filtered[active].run();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, filtered, active]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastGroup: string | undefined;
  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="palette-search">
          <Search size={16} aria-hidden />
          <input
            autoFocus
            placeholder="Search bots, screens, and actions…"
            aria-label="Search commands"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? <p className="palette-empty">No results</p> : null}
          {filtered.map((cmd, i) => {
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id}>
                {header ? <div className="palette-group">{header}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className="palette-item"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    cmd.run();
                    onClose();
                  }}
                >
                  <span className="palette-icon">{cmd.icon}</span>
                  <span className="palette-label">{cmd.label}</span>
                  {cmd.hint ? <span className="palette-hint">{cmd.hint}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
