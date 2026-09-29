import { describe, expect, it } from "vitest";
import { parsePairingQr, phonePairingUrls } from "./pairing.js";

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

describe("phonePairingUrls", () => {
  it("keeps real host addresses and skips loopback addresses that point to the phone", () => {
    expect(
      phonePairingUrls([
        "http://192.168.1.20:4577",
        "http://127.0.0.1:4577",
        "http://localhost:4577",
        "http://172.25.0.1:4577",
      ]),
    ).toEqual(["http://192.168.1.20:4577", "http://172.25.0.1:4577"]);
  });

  it("tries likely virtual adapter addresses after real LAN addresses", () => {
    expect(
      phonePairingUrls([
        "http://172.25.240.1:4577",
        "http://192.168.1.20:4577",
        "http://172.32.0.5:4577",
        "http://10.0.0.8:4577",
      ]),
    ).toEqual([
      "http://192.168.1.20:4577",
      "http://172.32.0.5:4577",
      "http://10.0.0.8:4577",
      "http://172.25.240.1:4577",
    ]);
  });
});
