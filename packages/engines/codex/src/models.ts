import type { ModelInfo } from "@openbot/contracts";

export const CODEX_MODELS: ModelInfo[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra", contextWindow: 256_000 },
  { id: "o4-mini", label: "o4-mini", contextWindow: 128_000 },
];

export { CODEX_MIN_VERSION } from "./generated/protocol.js";
