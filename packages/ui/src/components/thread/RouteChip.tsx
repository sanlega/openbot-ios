import { Cpu } from "lucide-react";
import type { RoutePreview } from "../../api/types.js";

interface RouteChipProps {
  route: RoutePreview;
  onOverride?: () => void;
}

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5": "Haiku 4.5",
};

/** "claude-opus-5-5" → "Opus 5.5"; ids without a friendly name stay as they are. */
export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

/** Which engine and model the Bot runs on; "Auto" when Jev picks per turn. */
export function RouteChip({ route, onOverride }: RouteChipProps) {
  const auto = route.engine === "auto";
  const pct = Math.round(route.confidence * 100);
  const showConfidence = !auto && pct > 0 && pct < 100;
  const model = modelLabel(route.model);
  return (
    <button
      type="button"
      className="route-chip"
      onClick={onOverride}
      disabled={!onOverride}
      title={
        auto
          ? "Jev picks the engine and model for each message"
          : `Runs on ${route.engine} · ${route.model}${showConfidence ? ` (Jev confidence ${pct}%)` : ""}`
      }
    >
      <Cpu size={13} aria-hidden />
      {auto ? (
        <span>Auto</span>
      ) : (
        <>
          <strong>{route.engine}</strong>
          {model && model !== "auto" ? <span className="route-model">{model}</span> : null}
        </>
      )}
      {showConfidence ? <span className="route-confidence">{pct}%</span> : null}
    </button>
  );
}
