export { AcpDriver, type AcpDriverOptions } from "./acp-driver.js";
export {
  descriptorOf,
  type AcpDetection,
  type AcpEnvironment,
  type AcpLaunch,
  type AcpProfile,
} from "./profile.js";
export { resolveSpawnTarget, runCli, type SpawnTarget } from "./spawn.js";
export {
  toolInputOf,
  toolNameOf,
  toolOutputOf,
  track,
  type TrackedToolCall,
} from "./tool-calls.js";
export {
  DEFAULT_CONTEXT_LENGTH,
  discoverLmStudio,
  discoverLocalModels,
  discoverOllama,
  ensureOllamaContext,
  localServers,
  parseLocalModelId,
  type LocalModel,
  type LocalProvider,
  type LocalServers,
} from "./local-models.js";
export { openCodeProfile, type OpenCodeProfileOptions } from "./profiles/opencode.js";
export {
  cursorProfile,
  cursorReplyFailure,
  customProfile,
  geminiProfile,
  grokProfile,
  type CustomAcpEngine,
} from "./profiles/others.js";
export {
  builtinAcpProfiles,
  readEnginePrefs,
  writeEnginePrefs,
  CUSTOM_SLUG_RE,
  customProfiles,
  type EnginePrefs,
} from "./registry.js";
