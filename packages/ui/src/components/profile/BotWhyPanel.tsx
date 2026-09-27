import { useEffect, useState } from "react";
import type { BotWhyResponse } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";

interface BotWhyPanelProps {
  botId: string;
}

export function BotWhyPanel({ botId }: BotWhyPanelProps) {
  const { transport, bots } = useOpenBot();
  const [why, setWhy] = useState<BotWhyResponse | null>(null);
  const bot = bots.find((b) => b.id === botId);

  useEffect(() => {
    void transport.get<BotWhyResponse>(`/api/bots/${botId}/why`).then(setWhy);
  }, [transport, botId]);

  if (!bot) return null;

  if (!why?.justification && bot.createdBy === "user") {
    return (
      <div className="card bot-why" data-testid="bot-why-panel">
        <h3 className="card-title">Why does this bot exist?</h3>
        <p style={{ color: "var(--text-muted)" }}>User-created bot — no CoS spawn justification.</p>
      </div>
    );
  }

  const j = why?.justification ?? bot.justification;
  if (!j) {
    return (
      <div className="card bot-why" data-testid="bot-why-panel">
        <h3 className="card-title">Why does this bot exist?</h3>
        <p style={{ color: "var(--text-muted)" }}>No justification on file.</p>
      </div>
    );
  }

  return (
    <div className="card bot-why" data-testid="bot-why-panel">
      <h3 className="card-title">Why does this bot exist?</h3>
      <dl className="why-list">
        <dt>Responsibility</dt>
        <dd>{j.responsibility}</dd>
        <dt>Why not an existing bot?</dt>
        <dd>{j.whyNotExisting}</dd>
        <dt>Lifetime</dt>
        <dd>{j.lifetime}</dd>
        <dt>Boundary</dt>
        <dd>{j.boundary.join(", ")}</dd>
        <dt>User requested</dt>
        <dd>{j.userRequested ? "Yes" : "No"}</dd>
      </dl>
      {why?.spawnDecision ? (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Spawn decision: {why.spawnDecision.outcome} · band {why.spawnDecision.band}
        </p>
      ) : null}
    </div>
  );
}
