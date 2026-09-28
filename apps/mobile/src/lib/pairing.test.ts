import { describe, expect, it } from "vitest";
import { parsePairingQr } from "./pairing.js";

describe("parsePairingQr", () => {
  it("reads the QR fragment payload and address list", () => {
    const data = encodeURIComponent(
      JSON.stringify({
        hostPub: "host-key",
        pairSecret: "one-time-secret",
        urls: ["https://desk.example"],
      }),
    );
    expect(parsePairingQr(`https://desk.example/app#pair=${data}`)).toEqual({
      hostPub: "host-key",
      pairSecret: "one-time-secret",
      urls: ["https://desk.example"],
    });
  });

  it("rejects malformed and non-OpenBot QR data", () => {
    expect(() => parsePairingQr("https://desk.example/app#other=value")).toThrow(
      "does not contain",
    );
    expect(() => parsePairingQr("https://desk.example/app#pair=%7Bbad")).toThrow("malformed");
  });
});
