import { describe, expect, it } from "vitest";
import { FakeClock } from "@openbot/testkit";
import { generateX25519KeyPair } from "./crypto.js";
import { PairingError, PairingService } from "./pairing.js";

describe("PairingService", () => {
  it("expires pair secrets after 10 minutes", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const hostKeys = generateX25519KeyPair();
    const deviceKeys = generateX25519KeyPair();
    const pairing = new PairingService(clock, hostKeys);
    const session = pairing.createSession(["http://127.0.0.1:4577"]);

    clock.advance(10 * 60 * 1000 + 1);
    expect(() =>
      pairing.complete({
        pairSecret: session.pairSecret,
        devicePub: deviceKeys.publicKeyBase64,
        name: "phone",
        via: "lan",
      }),
    ).toThrow(PairingError);
  });

  it("allows a pair secret only once", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const hostKeys = generateX25519KeyPair();
    const deviceKeys = generateX25519KeyPair();
    const pairing = new PairingService(clock, hostKeys);
    const session = pairing.createSession(["http://127.0.0.1:4577"]);
    pairing.complete({
      pairSecret: session.pairSecret,
      devicePub: deviceKeys.publicKeyBase64,
      name: "phone",
      via: "lan",
    });
    expect(() =>
      pairing.complete({
        pairSecret: session.pairSecret,
        devicePub: deviceKeys.publicKeyBase64,
        name: "phone-2",
        via: "lan",
      }),
    ).toThrow(/already used/);
  });

  it("builds a QR URL with pairing data in the fragment", () => {
    const pairing = new PairingService(new FakeClock(new Date()), generateX25519KeyPair());
    const session = pairing.createSession(["http://127.0.0.1:4577", "https://desk.tailnet.ts.net"]);
    const qrUrl = pairing.buildQrUrl("desk.tailnet.ts.net", session);
    expect(qrUrl).toMatch(/^https:\/\/desk\.tailnet\.ts\.net\/app#pair=/);
    const payload = JSON.parse(decodeURIComponent(qrUrl.split("#pair=")[1]!));
    expect(payload.hostPub).toBe(session.hostPub);
    expect(payload.pairSecret).toBe(session.pairSecret);
    expect(payload.urls).toEqual(session.urls);
  });
});
