import { useEffect, useState, type ReactNode } from "react";
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
import { BotList } from "../roster/BotList.js";
import { ThreadViewPanel } from "../thread/ThreadView.js";
import { ActivityView, AuditView } from "../activity/ActivityViews.js";
import { RoutinesView } from "../routines/RoutinesView.js";
import { ConnectorsView } from "../connectors/ConnectorsView.js";
import { SettingsView } from "../settings/SettingsView.js";
import { DevicesRemoteView } from "../devices/DevicesRemoteView.js";
import { CommandPalette, MOD_KEY } from "./CommandPalette.js";
import { useOpenBot } from "../../state/context.js";
import { ShellBackContext } from "../common/ScreenHeader.js";
import { desktopApi } from "../../state/desktop.js";
import type { AppScreen } from "../../api/types.js";

interface AppShellProps {
  showSetup?: boolean;
}

const NAV: Array<{ id: AppScreen; label: string; icon: ReactNode }> = [
  { id: "activity", label: "Activity", icon: <Activity size={16} /> },
  { id: "routines", label: "Routines", icon: <CalendarClock size={16} /> },
  { id: "connectors", label: "Connectors", icon: <Plug size={16} /> },
  { id: "audit", label: "Audit", icon: <ShieldCheck size={16} /> },
  { id: "devices", label: "Devices", icon: <MonitorSmartphone size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

export function AppShell({ showSetup = false }: AppShellProps) {
  const [screen, setScreen] = useState<AppScreen>("bots");
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { pendingApprovals, state, selectThread } = useOpenBot();
  const waitingInputs = [...state.inputs.values()].filter((i) => i.status === "pending").length;
  const needsYou = pendingApprovals.length + waitingInputs;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setScreen("bots");
        setCreating(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Notification clicks and the app menu (Electron) open a thread or Settings.
  useEffect(() => {
    return desktopApi()?.onNavigate?.((target) => {
      if (target.kind === "thread" && target.threadId) {
        selectThread(target.threadId);
        setScreen("bots");
        setMobileView("thread");
      } else if (target.kind === "settings") {
        setScreen("settings");
        setMobileView("thread");
      } else if (target.kind === "home") {
        setScreen("bots");
      }
    });
  }, [selectThread]);

  if (showSetup) return null;

  const openBots = () => {
    setScreen("bots");
    setMobileView("thread");
  };

  const mainContent = () => {
    switch (screen) {
      case "bots":
        return <ThreadViewPanel onBack={() => setMobileView("list")} />;
      case "activity":
        return <ActivityView />;
      case "audit":
        return <AuditView />;
      case "routines":
        return <RoutinesView />;
      case "connectors":
        return <ConnectorsView />;
      case "settings":
        return <SettingsView />;
      case "devices":
        return <DevicesRemoteView />;
    }
  };

  return (
    <>
      <div className="app-shell" data-view={mobileView} data-testid="app-shell">
        <aside className="sidebar" aria-label="Navigation">
          <header className="sidebar-header">
            <div className="brand">
              <span className="brand-mark" aria-hidden />
              <span className="brand-name">OpenBot</span>
            </div>
            <div className="sidebar-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPaletteOpen(true)}
                title={`Search (${MOD_KEY}K)`}
                aria-label="Search"
              >
                <Search size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setScreen("bots");
                  setCreating(true);
                }}
                title={`New bot (${MOD_KEY}N)`}
                aria-label="New bot"
              >
                <PenSquare size={16} />
              </button>
            </div>
          </header>

          <button
            type="button"
            className="sidebar-section-link"
            data-active={screen === "bots"}
            aria-current={screen === "bots" ? "page" : undefined}
            onClick={() => setScreen("bots")}
          >
            Bots
          </button>
          <div className="sidebar-scroll">
            <BotList
              creating={creating}
              onCreatingChange={setCreating}
              onSelect={openBots}
              highlightSelection={screen === "bots"}
            />
          </div>

          <nav className="sidebar-nav">
            {NAV.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                className="nav-item"
                data-active={screen === id}
                aria-current={screen === id ? "page" : undefined}
                aria-description={
                  id === "activity" && needsYou > 0 ? `${needsYou} waiting on you` : undefined
                }
                onClick={() => {
                  setScreen(id);
                  setMobileView("thread");
                }}
              >
                {icon}
                <span>{label}</span>
                {id === "activity" && needsYou > 0 ? (
                  <span className="nav-badge" aria-hidden>
                    {needsYou}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </aside>
        <main className="main-panel">
          {!state.connected && state.everConnected ? (
            <div className="banner banner-warning reconnect-toast" role="status">
              <span className="banner-dot" aria-hidden /> Reconnecting to OpenBot…
            </div>
          ) : null}
          <ShellBackContext.Provider value={() => setMobileView("list")}>
            {mainContent()}
          </ShellBackContext.Provider>
        </main>
      </div>
      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(view) => {
            setScreen(view);
            setMobileView("thread");
            setPaletteOpen(false);
          }}
          onOpenThread={(threadId) => {
            selectThread(threadId);
            setScreen("bots");
            setMobileView("thread");
          }}
          onNewBot={() => {
            setScreen("bots");
            setMobileView("list");
            setCreating(true);
          }}
        />
      ) : null}
    </>
  );
}
