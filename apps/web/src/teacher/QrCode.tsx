import { useMemo } from "react";
import { encodeQr, qrPath } from "./qr.ts";

/** QR code en SVG en ligne (aucune requête, imprimable, net à toute taille). */
export function QrCode({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const matrix = encodeQr(text);
    return { size: matrix.size + 8, path: qrPath(matrix) };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} data-testid="class-qr" className={className} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#14201e" />
    </svg>
  );
}
