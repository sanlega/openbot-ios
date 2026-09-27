import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Cloud, ExternalLink, HardDrive, Plug, Search } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { ScreenHeader } from "../common/ScreenHeader.js";
import { ConnectSheet } from "./ConnectSheet.js";
import { ConnectorMark } from "./ConnectorMark.js";
import type { ConnectorCatalogEntry, ConnectorConnection } from "./types.js";

type Tab = "gallery" | "community" | "connected";

/**
 * Connectors: the user's apps as MCP servers. Connected once per account, then
 * assigned per bot in the bot's profile. Community entries come from the public
 * MCP Registry and are not reviewed.
 */
export function ConnectorsView() {
  const { transport, bots } = useOpenBot();
  const [tab, setTab] = useState<Tab>("gallery");
  const [query, setQuery] = useState("");
  const [curated, setCurated] = useState<ConnectorCatalogEntry[] | null>(null);
  const [community, setCommunity] = useState<ConnectorCatalogEntry[] | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<ConnectorCatalogEntry | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [catalog, conns] = await Promise.all([
        transport.get<{ entries: ConnectorCatalogEntry[] }>(
          "/api/connectors/catalog?source=curated",
        ),
        transport.get<{ connections: ConnectorConnection[] }>("/api/connectors/connections"),
      ]);
      setCurated(catalog.entries ?? []);
      setConnections(conns.connections ?? []);
      setError(null);
    } catch (err) {
      setCurated([]);
      setError(err instanceof Error ? err.message : "Could not load connectors");
    }
  }, [transport]);

  useEffect(() => {
    void load();
  }, [load]);

  // Community search hits the public registry, so only when that tab is open.
  useEffect(() => {
    if (tab !== "community") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      transport
        .get<{ entries: ConnectorCatalogEntry[]; error?: string }>(
          `/api/connectors/catalog?source=community&q=${encodeURIComponent(query)}`,
        )
        .then((res) => {
          if (cancelled) return;
          setCommunity(res.entries ?? []);
          setCommunityError(res.error ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setCommunity([]);
          setCommunityError("The MCP Registry is not reachable right now.");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, query, transport]);

  const usage = (connectionId: string) =>
    bots.filter((b) => !b.archivedAt && b.connectors.includes(connectionId)).length;

  const visibleCurated = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = curated ?? [];
    if (!q) return list;
    return list.filter((e) =>
      [e.name, e.publisher, e.description, e.category].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [curated, query]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, ConnectorCatalogEntry[]>();
    for (const entry of visibleCurated) {
      const key = entry.category ?? "Other";
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [visibleCurated]);

  const disconnect = async (connectionId: string) => {
    try {
      await transport.delete(`/api/connectors/connections/${connectionId}`);
      setConfirmRemove(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    }
  };

  return (
    <div className="screen" data-testid="connectors-view">
      <ScreenHeader
        title="Connectors"
        subtitle="Give your bots access to your apps. Connect once, then choose which bots use each one."
      />
      <div className="screen-body">
        <div className="screen-content screen-content-wide">
          <div className="conn-toolbar">
            <div className="segmented" role="tablist" aria-label="Connector sources">
              {(
                [
                  ["gallery", "Gallery"],
                  ["community", "Community"],
                  ["connected", `Connected${connections.length ? ` · ${connections.length}` : ""}`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-checked={tab === id}
                  className="segmented-option"
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab !== "connected" ? (
              <label className="conn-search">
                <Search size={14} aria-hidden />
                <input
                  aria-label="Search connectors"
                  placeholder={tab === "community" ? "Search the MCP Registry" : "Search"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            ) : null}
          </div>

          {error ? <div className="banner banner-danger conn-banner">{error}</div> : null}

          {tab === "gallery" ? (
            curated === null ? (
              <ConnectorSkeleton />
            ) : byCategory.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">No connectors match “{query}”</p>
                <p className="empty-text">
                  Try the Community tab to search the public MCP Registry.
                </p>
              </div>
            ) : (
              byCategory.map(([category, entries]) => (
                <section key={category} className="conn-section">
                  <h2 className="section-title">{category}</h2>
                  <div className="conn-grid">
                    {entries.map((entry) => (
                      <ConnectorCard
                        key={entry.id}
                        entry={entry}
                        onConnect={() => setConnecting(entry)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )
          ) : null}

          {tab === "community" ? (
            <>
              <div className="callout callout-muted conn-note">
                Community connectors come from the public MCP Registry. OpenBot hasn't reviewed
                them: check the publisher before you connect one.
              </div>
              {communityError ? (
                <div className="banner banner-warning conn-banner">{communityError}</div>
              ) : null}
              {community === null ? (
                <ConnectorSkeleton />
              ) : community.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-title">Nothing found</p>
                  <p className="empty-text">Search by app or server name.</p>
                </div>
              ) : (
                <div className="conn-grid">
                  {community.map((entry) => (
                    <ConnectorCard
                      key={entry.id}
                      entry={entry}
                      onConnect={() => setConnecting(entry)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}

          {tab === "connected" ? (
            connections.length === 0 ? (
              <div className="empty-state">
                <Plug size={28} aria-hidden />
                <p className="empty-title">No connectors yet</p>
                <p className="empty-text">
                  Connect an app from the gallery, then turn it on for a bot in its profile.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setTab("gallery")}>
                  Browse the gallery
                </button>
              </div>
            ) : (
              <div className="row-list">
                {connections.map((conn) => {
                  const entry = curated?.find((e) => e.id === conn.catalogId);
                  const used = usage(conn.id);
                  return (
                    <div key={conn.id} className="row">
                      <ConnectorMark name={entry?.name ?? conn.name} size={32} />
                      <div className="row-main">
                        <span className="row-title">{conn.name}</span>
                        <span className="row-sub">
                          {used === 0
                            ? "Not used by any bot yet"
                            : `Used by ${used} ${used === 1 ? "bot" : "bots"}`}
                        </span>
                      </div>
                      <span
                        className={`pill ${conn.status === "connected" ? "pill-success" : "pill-danger"}`}
                      >
                        {conn.status === "connected" ? "Connected" : "Needs attention"}
                      </span>
                      {confirmRemove === conn.id ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => void disconnect(conn.id)}
                          >
                            Disconnect
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setConfirmRemove(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setConfirmRemove(conn.id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </div>
      </div>
      {connecting ? (
        <ConnectSheet
          entry={connecting}
          onClose={() => setConnecting(null)}
          onConnected={() => {
            setConnecting(null);
            void load();
            setTab("connected");
          }}
        />
      ) : null}
    </div>
  );
}

function ConnectorCard({
  entry,
  onConnect,
}: {
  entry: ConnectorCatalogEntry;
  onConnect: () => void;
}) {
  const writes = entry.tools?.filter((t) => t.write).length ?? 0;
  const oauthSoon = entry.auth === "oauth";
  return (
    <article className="conn-card" data-testid={`connector-${entry.id}`}>
      <div className="conn-card-head">
        <ConnectorMark name={entry.name} size={36} />
        <div className="conn-card-title">
          <span className="conn-name">
            {entry.name}
            {entry.verified ? (
              <BadgeCheck size={14} className="conn-verified" aria-label="Official" />
            ) : null}
          </span>
          {entry.publisher ? <span className="conn-publisher">{entry.publisher}</span> : null}
        </div>
      </div>
      {entry.description ? <p className="conn-desc">{entry.description}</p> : null}
      <div className="conn-meta">
        <span className="conn-kind">
          {entry.kind === "remote" ? <Cloud size={12} /> : <HardDrive size={12} />}
          {entry.kind === "remote" ? "Hosted by the app" : "Runs on this computer"}
        </span>
        {writes > 0 ? <span className="conn-kind">Can make changes</span> : null}
        {entry.setup?.docsUrl ? (
          <a className="conn-kind" href={entry.setup.docsUrl} target="_blank" rel="noreferrer">
            Docs <ExternalLink size={11} />
          </a>
        ) : null}
      </div>
      <div className="conn-card-actions">
        {entry.connected ? (
          <span className="pill pill-success">Connected</span>
        ) : oauthSoon ? (
          <span
            className="pill pill-muted"
            title="Sign-in with OAuth is coming in the next release"
          >
            Sign-in coming soon
          </span>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onConnect}>
            Connect
          </button>
        )}
      </div>
    </article>
  );
}

function ConnectorSkeleton() {
  return (
    <div className="conn-grid" aria-busy="true" aria-label="Loading connectors">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="conn-card conn-card-skeleton" />
      ))}
    </div>
  );
}
