import { describe, expect, it } from "vitest";
import { PairingService } from "./pairing.js";
import { FakeClock } from "@openbot/testkit";
import { generateX25519KeyPair } from "./crypto.js";

describe("@openbot/remote", () => {
  it("exports pairing primitives", () => {
    const pairing = new PairingService(new FakeClock(new Date()), generateX25519KeyPair());
    const session = pairing.createSession(["http://127.0.0.1:4577"]);
    expect(session.pairSecret.length).toBeGreaterThan(10);
  });
});
