import type { Clock, DeviceRole } from "@openbot/contracts";
import {
  computeSharedSecret,
  deriveFramingKey,
  generateX25519KeyPair,
  randomPairSecret,
  type X25519KeyPair,
} from "./crypto.js";

export interface PairingSession {
  pairSecret: string;
  hostPub: string;
  urls: string[];
  expiresAt: string;
  role: DeviceRole;
}

export interface QrPairPayload {
  hostPub: string;
  pairSecret: string;
  urls: string[];
}

export interface CompletePairingInput {
  pairSecret: string;
  devicePub: string;
  name: string;
  role?: DeviceRole;
  via: "lan" | "tailscale" | "cloudflare";
}

export interface CompletePairingResult {
  sharedSecret: Buffer;
  framingKey: Buffer;
  hostPub: string;
  role: DeviceRole;
}

const PAIRING_TTL_MS = 10 * 60 * 1000;

/**
 * In-memory pairing sessions (plan §4.8: `pairSecret` is single-use and expires
 * after 10 min). The QR fragment never hits any server log because it lives in
 * the URL hash only; the phone sends `pairSecret` once over the handshake POST.
 */
export class PairingService {
  private readonly sessions = new Map<string, PairingSession & { used: boolean }>();
  private hostKeys: X25519KeyPair;

  constructor(
    private readonly clock: Clock,
    hostKeys?: X25519KeyPair,
  ) {
    this.hostKeys = hostKeys ?? generateX25519KeyPair();
  }

  get hostPublicKey(): string {
    return this.hostKeys.publicKeyBase64;
  }

  getHostKeyPair(): X25519KeyPair {
    return this.hostKeys;
  }

  /** Creates a single-use pairing session and the QR URL fragment payload. */
  createSession(urls: string[], role: DeviceRole = "approver"): PairingSession {
    this.pruneExpired();
    const pairSecret = randomPairSecret();
    const expiresAt = new Date(this.clock.now().getTime() + PAIRING_TTL_MS).toISOString();
    const session: PairingSession & { used: boolean } = {
      pairSecret,
      hostPub: this.hostKeys.publicKeyBase64,
      urls,
      expiresAt,
      role,
      used: false,
    };
    this.sessions.set(pairSecret, session);
    return session;
  }

  buildQrUrl(primaryHost: string, session: PairingSession): string {
    const payload: QrPairPayload = {
      hostPub: session.hostPub,
      pairSecret: session.pairSecret,
      urls: session.urls,
    };
    const fragment = encodeURIComponent(JSON.stringify(payload));
    return `https://${primaryHost}/app#pair=${fragment}`;
  }

  /** Validates `pairSecret`, performs X25519, marks the secret used. Throws on failure. */
  complete(input: CompletePairingInput): CompletePairingResult {
    this.pruneExpired();
    const session = this.sessions.get(input.pairSecret);
    if (!session)
      throw new PairingError("invalid_pair_secret", "pairing secret not found or expired");
    if (session.used) throw new PairingError("pair_secret_reused", "pairing secret already used");
    if (new Date(session.expiresAt) <= this.clock.now()) {
      this.sessions.delete(input.pairSecret);
      throw new PairingError("pair_secret_expired", "pairing secret expired");
    }

    session.used = true;
    const sharedSecret = computeSharedSecret(this.hostKeys.privateKey, input.devicePub);
    const framingKey = deriveFramingKey(sharedSecret);
    const role = input.role ?? session.role;
    return {
      sharedSecret,
      framingKey,
      hostPub: session.hostPub,
      role,
    };
  }

  private pruneExpired(): void {
    const now = this.clock.now();
    for (const [secret, session] of this.sessions) {
      if (new Date(session.expiresAt) <= now) {
        this.sessions.delete(secret);
      }
    }
  }
}

export class PairingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PairingError";
  }
}
