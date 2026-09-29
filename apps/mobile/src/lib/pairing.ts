import { z } from "zod";

const PairPayload = z.object({
  hostPub: z.string().min(1),
  pairSecret: z.string().min(1),
  urls: z.array(z.string().url()).min(1),
});

export type PairPayload = z.infer<typeof PairPayload>;

/** Reads the pairing fragment from the QR URL without sending it to a web server. */
export function parsePairingQr(value: string): PairPayload {
  const url = new URL(value);
  const encoded = url.hash.slice(1);
  const params = new URLSearchParams(encoded);
  const raw = params.get("pair");
  if (!raw) throw new Error("This QR code does not contain OpenBot pairing data.");

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The pairing QR code is malformed.");
  }

  const result = PairPayload.safeParse(data);
  if (!result.success) throw new Error("The pairing QR code is missing required data.");
  return result.data;
}

/** Loopback URLs in a desktop QR point back to the phone, never to the desktop. */
export function phonePairingUrls(urls: string[]): string[] {
  return urls.filter((address) => {
    const hostname = new URL(address).hostname;
    return hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]";
  });
}
