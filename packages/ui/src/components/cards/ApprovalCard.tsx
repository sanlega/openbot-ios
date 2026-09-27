import type { Approval } from "@openbot/contracts";

interface ApprovalCardProps {
  approval: Approval;
  onResolve: (resolution: "allow" | "deny") => void;
}

const KIND_LABELS: Record<Approval["kind"], string> = {
  tool: "Tool approval",
  computer_action: "Computer action",
  connector_action: "Connector action",
  chain_limit: "Chain limit",
  bot_request: "Bot request",
  local_computer: "Local computer",
  routine_live: "Enable live routine",
};

export function ApprovalCard({ approval, onResolve }: ApprovalCardProps) {
  return (
    <article className="card" data-testid={`approval-${approval.id}`}>
      <h3 className="card-title">{KIND_LABELS[approval.kind]}</h3>
      <p>{approval.summary}</p>
      {approval.detail ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{approval.detail}</p>
      ) : null}
      {approval.risk !== undefined ? (
        <p style={{ fontSize: "0.8rem", color: "var(--warning)" }}>
          Risk score: {approval.risk.toFixed(2)}
        </p>
      ) : null}
      <div className="card-actions">
        <button type="button" className="primary" onClick={() => onResolve("allow")}>
          Allow
        </button>
        <button type="button" className="danger" onClick={() => onResolve("deny")}>
          Deny
        </button>
      </div>
    </article>
  );
}
