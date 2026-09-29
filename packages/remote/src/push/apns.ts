import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

export type ApnsEnvironment = "production" | "sandbox";

export interface ApnsCredentials {
  /** The `.p8` auth key's PEM text. */
  keyP8: string;
  keyId: string;
  teamId: string;
  /** The app's bundle ID, sent as `apns-topic`. */
  bundleId: string;
}

export interface ApnsNotification {
  title: string;
  body: string;
  threadId?: string;
  collapseId?: string;
  data?: Record<string, unknown>;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** Apple's reason on failure, e.g. `BadDeviceToken`, `Unregistered`. */
  reason?: string;
}

/** One HTTP/2 request to APNs; swapped out in tests. */
export type ApnsTransport = (request: {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: string }>;

const ORIGINS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

/** Apple accepts a provider token for up to an hour; refresh well before that. */
const TOKEN_TTL_MS = 50 * 60_000;

/** Throws a readable error when the key text is not an EC P-256 private key. */
export function parseApnsKey(keyP8: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(keyP8.trim());
  } catch {
    throw new Error(
      "That isn't a valid .p8 key. Paste the whole file, including the BEGIN/END lines.",
    );
  }
  if (key.asymmetricKeyType !== "ec") throw new Error("APNs keys are EC (P-256) keys.");
  return key;
}

export class ApnsSender {
  private readonly key: KeyObject;
  private token: { value: string; at: number } | undefined;

  constructor(
    private readonly credentials: ApnsCredentials,
    private readonly transport: ApnsTransport = http2Transport(),
    private readonly now: () => number = Date.now,
  ) {
    this.key = parseApnsKey(credentials.keyP8);
  }

  /** The ES256 provider token (JWT) APNs expects in `authorization: bearer`. */
  providerToken(): string {
    const at = this.now();
    if (this.token && at - this.token.at < TOKEN_TTL_MS) return this.token.value;
    const header = b64url(JSON.stringify({ alg: "ES256", kid: this.credentials.keyId }));
    const claims = b64url(
      JSON.stringify({ iss: this.credentials.teamId, iat: Math.floor(at / 1000) }),
    );
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
      key: this.key,
      dsaEncoding: "ieee-p1363",
    });
    const value = `${header}.${claims}.${signature.toString("base64url")}`;
    this.token = { value, at };
    return value;
  }

  async send(
    deviceToken: string,
    notification: ApnsNotification,
    environment: ApnsEnvironment,
  ): Promise<ApnsResult> {
    const aps: Record<string, unknown> = {
      alert: { title: notification.title, body: notification.body },
      sound: "default",
    };
    if (notification.threadId) aps["thread-id"] = notification.threadId;
    const headers: Record<string, string> = {
      authorization: `bearer ${this.providerToken()}`,
      "apns-topic": this.credentials.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    };
    if (notification.collapseId) headers["apns-collapse-id"] = notification.collapseId.slice(0, 64);
    const response = await this.transport({
      origin: ORIGINS[environment],
      path: `/3/device/${encodeURIComponent(deviceToken)}`,
      headers,
      // expo-notifications exposes a remote notification's custom data from `body`.
      body: JSON.stringify({ aps, body: notification.data ?? {} }),
    });
    if (response.status === 200) return { ok: true, status: 200 };
    let reason: string | undefined;
    try {
      reason = (JSON.parse(response.body) as { reason?: string }).reason;
    } catch {
      reason = undefined;
    }
    return { ok: false, status: response.status, reason };
  }
}

function b64url(text: string): string {
  return Buffer.from(text).toString("base64url");
}

/** Keeps one HTTP/2 connection per APNs origin, reconnecting when it closes. */
export function http2Transport(timeoutMs = 10_000): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (origin: string) => {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(origin);
    session.on("error", () => sessions.delete(origin));
    session.on("close", () => sessions.delete(origin));
    session.setTimeout(5 * 60_000, () => session.close());
    session.unref();
    sessions.set(origin, session);
    return session;
  };
  return ({ origin, path, headers, body }) =>
    new Promise((resolve, reject) => {
      const request = sessionFor(origin).request({ ":method": "POST", ":path": path, ...headers });
      let status = 0;
      let text = "";
      request.setEncoding("utf8");
      request.setTimeout(timeoutMs, () => request.close());
      request.on("response", (h) => (status = Number(h[":status"] ?? 0)));
      request.on("data", (chunk: string) => (text += chunk));
      request.on("end", () => resolve({ status, body: text }));
      // A timed-out or reset stream closes without "end"; status 0 means "not sent".
      request.on("close", () => resolve({ status, body: text }));
      request.on("error", reject);
      request.end(body);
    });
}
