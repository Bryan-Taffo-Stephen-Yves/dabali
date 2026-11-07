"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import clsx from "clsx";

/** QR toujours noir sur blanc avec zone de silence (lisibilité scanner, §9) */
export function Qr({ value, className, size = 280 }: { value: string | null; className?: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!value) { setSvg(null); return; }
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: size, color: { dark: "#000000", light: "#FFFFFF" } })
      .then(setSvg).catch(() => setSvg(null));
  }, [value, size]);
  return (
    <div className={clsx("aspect-square bg-white", className)}>
      {svg ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        : <div className="size-full animate-pulse rounded-xl bg-canvas" />}
    </div>
  );
}
