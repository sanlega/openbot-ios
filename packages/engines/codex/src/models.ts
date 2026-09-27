import type { ModelInfo } from "@openbot/contracts";

export const CODEX_MODELS: ModelInfo[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra", contextWindow: 256_000 },
];

export { CODEX_MIN_VERSION } from "./generated/protocol.js";
