import { useEffect, useState } from "react";
import { BotList } from "../roster/BotList.js";
import { ThreadViewPanel } from "../thread/ThreadView.js";
import { ActivityView, AuditView } from "../activity/ActivityViews.js";
import { CommandPalette } from "./CommandPalette.js";

type SidebarView = "bots" | "activity" | "audit";

interface AppShellProps {
  showSetup?: boolean;
}

export function AppShell({ showSetup = false }: AppShellProps) {
  const [sidebarView, setSidebarView] = useState<SidebarView>("bots");
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
        <p style={{ color: "var(--text-muted)" }}>Complete setup in Settings — wizard UI loads when setup is incomplete.</p>
      </div>
    );
  }

  return (
    <>
      <div className="app-shell" data-view={mobileView} data-testid="app-shell">
        <aside className="sidebar-panel">
          <header className="panel-header">
            <h1 className="panel-title">OpenBot</h1>
            <button type="button" className="icon-button" onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)">
              ⌘K
            </button>
          </header>
          <div className="nav-tabs">
            <button
              type="button"
              className="nav-tab"
              data-active={sidebarView === "bots"}
              onClick={() => setSidebarView("bots")}
            >
              Bots
            </button>
            <button
              type="button"
              className="nav-tab"
              data-active={sidebarView === "activity"}
              onClick={() => setSidebarView("activity")}
            >
              Activity
            </button>
            <button
              type="button"
              className="nav-tab"
              data-active={sidebarView === "audit"}
              onClick={() => setSidebarView("audit")}
            >
              Audit
            </button>
          </div>
          {sidebarView === "bots" ? (
            <BotList onSelectActivity={() => setSidebarView("activity")} />
          ) : sidebarView === "activity" ? (
            <ActivityView />
          ) : (
            <AuditView />
          )}
        </aside>
        <main className="thread-panel">
          <ThreadViewPanel
            onBack={() => setMobileView("list")}
          />
        </main>
      </div>
      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(view) => {
            setSidebarView(view);
            setPaletteOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
