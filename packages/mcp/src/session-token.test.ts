import { describe, expect, it } from "vitest";
import { SessionTokenService, generateSessionSecret } from "./session-token.js";

describe("SessionTokenService", () => {
  const secret = generateSessionSecret();
  const tokens = new SessionTokenService(secret);

  it("round-trips valid claims", () => {
    const token = tokens.issue(
      { botId: "bot_01", turnId: "turn_01", chainId: "chn_01", mode: "live" },
      1_000,
    );
    const claims = tokens.verify(token, 1_000);
    expect(claims).toEqual({
      botId: "bot_01",
      turnId: "turn_01",
      chainId: "chn_01",
      mode: "live",
      exp: 1_000 + 60 * 60 * 1000,
    });
  });

  it("rejects expired tokens", () => {
    const token = tokens.issue(
      { botId: "bot_01", turnId: "turn_01", chainId: "chn_01", mode: "live", exp: 500 },
      1_000,
    );
    expect(tokens.verify(token, 1_000)).toBeUndefined();
  });

  it("rejects tampered signatures", () => {
    const token = tokens.issue(
      { botId: "bot_01", turnId: "turn_01", chainId: "chn_01", mode: "live" },
      1_000,
    );
    const tampered = `${token}x`;
    expect(tokens.verify(tampered, 1_000)).toBeUndefined();
  });

  it("rejects tokens signed with a different secret", () => {
    const other = new SessionTokenService(generateSessionSecret());
    const token = other.issue(
      { botId: "bot_01", turnId: "turn_01", chainId: "chn_01", mode: "live" },
      1_000,
    );
    expect(tokens.verify(token, 1_000)).toBeUndefined();
  });
});
