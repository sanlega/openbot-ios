/**
 * `@openbot/remote` (plan §5 WS11): pairing, device crypto, E2E framing,
 * Tailscale/Cloudflare managers.
 */
export {
  computeSharedSecret,
  deriveFramingKey,
  generateX25519KeyPair,
  importX25519PublicKey,
  ensureSodium,
  sealSecret,
  openSecret,
  E2E_CONTENT_TYPE,
  E2E_HEADER,
  type X25519KeyPair,
} from "./crypto.js";
export {
  PairingService,
  PairingError,
  type PairingSession,
  type QrPairPayload,
} from "./pairing.js";
export { E2EFraming, DeviceE2ESession, ClientE2ESession } from "./framing.js";
export { TailscaleManager, type TailscaleStatus, type ExecFn } from "./tailscale-manager.js";
export {
  CLOUDFLARE_TOKEN_VAULT_KEY,
  hasCloudflareToken,
  removeCloudflareTunnel,
  resumeCloudflareTunnel,
  startCloudflareTunnel,
  type CloudflareTunnelContext,
} from "./cloudflare-tunnel.js";
export { CloudflareManager, type CloudflareStatus, type SpawnFn } from "./cloudflare-manager.js";
export {
  createRemoteServices,
  collectPairingUrls,
  primaryPairingHost,
  type RemoteServices,
  type RemoteServicesOptions,
} from "./wire.js";
export {
  attachRemoteServices,
  registerRemoteIntegration,
  shouldUseE2E,
  remoteE2EScope,
  type RemoteCoreContext,
} from "./integration.js";
export {
  isPrivateIPv4,
  lanAddresses,
  normalizeHostname,
  readNetworkPrefs,
  writeNetworkPrefs,
  type NetworkPrefs,
} from "./network-prefs.js";
export { PushService, type PushStatus, type PushConfigInput } from "./push/service.js";
export { ApnsSender, parseApnsKey, type ApnsTransport } from "./push/apns.js";
export { pushContentFor, type PushContent } from "./push/content.js";
export { PushStore, type PushConfig } from "./push/store.js";
