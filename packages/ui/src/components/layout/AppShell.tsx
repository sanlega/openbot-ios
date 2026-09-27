import { useEffect, useState } from "react";
import { BotList } from "../roster/BotList.js";
import { ThreadViewPanel } from "../thread/ThreadView.js";
import { ActivityView, AuditView } from "../activity/ActivityViews.js";
import { RoutinesView } from "../routines/RoutinesView.js";
import { SettingsView } from "../settings/SettingsView.js";
import { DevicesRemoteView } from "../devices/DevicesRemoteView.js";
import { CommandPalette } from "./CommandPalette.js";
import type { AppScreen } from "../../api/types.js";

interface AppShellProps {
  showSetup?: boolean;
}

const NAV: Array<{ id: AppScreen; label: string }> = [
  { id: "bots", label: "Bots" },
  { id: "activity", label: "Activity" },
  { id: "audit", label: "Audit" },
  { id: "routines", label: "Routines" },
  { id: "settings", label: "Settings" },
  { id: "devices", label: "Devices" },
];

export function AppShell({ showSetup = false }: AppShellProps) {
  const [screen, setScreen] = useState<AppScreen>("bots");
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (showSetup) {
    return (
      <div className="setup-wizard">
        <h1>OpenBot setup</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Complete setup in Settings — wizard UI loads when setup is incomplete.
        </p>
      </div>
    );
  }

  const isChatLayout = screen === "bots";
  const isSidebarList = screen === "bots" || screen === "activity" || screen === "audit";

  const sidebarContent = () => {
    switch (screen) {
      case "bots":
        return <BotList onSelectActivity={() => setScreen("activity")} />;
      case "activity":
        return <ActivityView />;
      case "audit":
        return <AuditView />;
      default:
        return null;
    }
  };

  const mainContent = () => {
    if (isChatLayout) return <ThreadViewPanel onBack={() => setMobileView("list")} />;
    if (screen === "routines") return <RoutinesView />;
    if (screen === "settings") return <SettingsView />;
    if (screen === "devices") return <DevicesRemoteView />;
    return <div className="empty-state">Select a bot from the Bots tab</div>;
  };

  return (
    <>
      <div
        className={`app-shell ${isChatLayout ? "" : "app-shell-single"}`}
        data-view={mobileView}
        data-testid="app-shell"
      >
        <aside className="sidebar-panel">
          <header className="panel-header">
            <h1 className="panel-title">OpenBot</h1>
            <button
              type="button"
              className="icon-button"
              onClick={() => setPaletteOpen(true)}
              title="Command palette (⌘K)"
            >
              ⌘K
            </button>
          </header>
          <div className="nav-tabs nav-tabs-scroll">
            {NAV.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="nav-tab"
                data-active={screen === id}
                onClick={() => setScreen(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {isSidebarList ? sidebarContent() : null}
        </aside>
        <main className="thread-panel">{mainContent()}</main>
      </div>
      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(view) => {
            setScreen(view);
            setPaletteOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
