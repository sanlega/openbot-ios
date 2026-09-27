/**
 * `@openbot/core` (plan §5 WS1): config, the full repository set, the event
 * bus (persist -> NDJSON -> fan-out), the §4.7 Client API (HTTP + WebSocket),
 * setup-wizard validation, device tokens/roles, the vault, and the module
 * host other workstreams register routes/validators through. `apps/server`
 * (headless `openbot serve|doctor|pair`) and `apps/desktop` both consume this
 * package rather than building any of the above themselves.
 */
export {
  loadConfig,
  resolveBindHost,
  type CoreConfig,
  type BindHostFlags,
  type LoadConfigOptions,
} from "./config.js";
export {
  createCoreContext,
  computeBindHostFlags,
  type CoreContext,
  type CoreRepos,
  type CreateCoreContextOptions,
  type SetupValidator,
  type SetupValidatorKind,
  type RoutineOrchestratorLike,
  type TurnMailbox,
} from "./context.js";
export { EventBus, type PublishInput } from "./event-bus.js";
export { NdjsonWriter, NullNdjsonWriter } from "./ndjson-writer.js";
export { FileVault, InMemoryVault, type Vault } from "./vault.js";
export {
  DeviceAuth,
  generateDeviceSecret,
  requireOwner as isOwnerIdentity,
  type DeviceIdentity,
} from "./device-auth.js";
export { createModuleHost, type ModuleHost } from "./module-host.js";
export { runDoctor, type DoctorCheck, type DoctorReport } from "./doctor.js";
export { buildServer } from "./http/server.js";
export type { BuildServerOptions } from "./http/server.js";
export { requireAuth, requireOwner, isLoopback } from "./http/auth.js";
export type { ConnectorService, ConnectorConnectInput } from "./connector-service.js";
