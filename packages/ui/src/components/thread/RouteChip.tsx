import type { RoutePreview } from "../../api/types.js";

interface RouteChipProps {
  route: RoutePreview;
  onOverride?: () => void;
}

export function RouteChip({ route, onOverride }: RouteChipProps) {
  const pct = Math.round(route.confidence * 100);
  return (
    <button
      type="button"
      className="route-chip"
      onClick={onOverride}
      title="Engine route — click to override"
    >
      <strong>{route.engine}</strong>
      <span>{route.model}</span>
      <span className="confidence-bar" aria-label={`${pct}% confidence`}>
        <span className="confidence-fill" style={{ width: `${pct}%` }} />
      </span>
      <span>{pct}%</span>
    </button>
  );
}
