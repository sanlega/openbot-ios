import type { ModelInfo } from "@openbot/contracts";

export const CLAUDE_MIN_VERSION = "2.1.283";

export const CLAUDE_MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 200_000 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", contextWindow: 200_000 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000 },
];
