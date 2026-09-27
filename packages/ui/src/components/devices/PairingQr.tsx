import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders `value` as a scannable QR code (inline SVG, always dark-on-white for cameras). */
export function PairingQr({ value, size = 184 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#111113", light: "#ffffff" },
    })
      .then((out) => !cancelled && setSvg(out))
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      className="pair-qr-code"
      role="img"
      aria-label="Pairing QR code"
      style={{ width: size, height: size }}
      // The SVG is generated locally by the qrcode library from our own URL.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
