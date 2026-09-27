import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ChainMode } from "@openbot/contracts";
import type { SessionClaims } from "./types.js";

const TOKEN_SEPARATOR = ".";
const DEFAULT_TTL_MS = 60 * 60 * 1000; // one hour — long enough for a turn, short enough to limit replay

export interface IssueSessionTokenInput {
  botId: string;
  turnId: string;
  chainId: string;
  mode: ChainMode;
  /** Defaults to now + {@link DEFAULT_TTL_MS}. */
  exp?: number;
}

/**
 * Signs per-turn session tokens for `POST /internal/tools/*` (plan §4.7).
 * Same HMAC pattern as `DeviceAuth`, but the claim carries turn context.
 */
export class SessionTokenService {
  constructor(private readonly secret: Buffer) {}

  issue(input: IssueSessionTokenInput, now = Date.now()): string {
    const claims: SessionClaims = {
      botId: input.botId,
      turnId: input.turnId,
      chainId: input.chainId,
      mode: input.mode,
      exp: input.exp ?? now + DEFAULT_TTL_MS,
    };
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signature = this.sign(payload);
    return `${payload}${TOKEN_SEPARATOR}${signature}`;
  }

  verify(token: string, now = Date.now()): SessionClaims | undefined {
    const separatorIndex = token.indexOf(TOKEN_SEPARATOR);
    if (separatorIndex < 0) return undefined;
    const payload = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    if (!this.safeEquals(signature, this.sign(payload))) return undefined;

    try {
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as SessionClaims;
      if (
        !claims.botId ||
        !claims.turnId ||
        !claims.chainId ||
        !claims.mode ||
        typeof claims.exp !== "number"
      ) {
        return undefined;
      }
      if (claims.exp < now) return undefined;
      return claims;
    } catch {
      return undefined;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  private safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

export function generateSessionSecret(): Buffer {
  return randomBytes(32);
}
