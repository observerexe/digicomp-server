import { encode } from 'uqr';

/**
 * QR code drawn as SVG on the device: the 2FA secret never leaves the page
 * and no image or inline style is needed (CSP stays strict).
 */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { data } = encode(value, { ecc: 'M', border: 2 });
  const n = data.length;
  let d = '';
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
