/**
 * What a scanned QR points to. Stickers hold the full app URL
 * (https://<host>/lab/CNC-1) so a plain phone camera opens the app too;
 * a bare code ("CNC-1") is accepted as well. Links to other sites are ignored.
 */
export type ScanTarget = { kind: 'place'; code: string };

const CODE = /^[A-Za-z0-9_-]{3,60}$/; // same rule as the API (CreatePlaceDto)

export function parseScan(text: string, origin: string): ScanTarget | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null;
    const m = /^\/lab\/([^/]+)\/?$/.exec(url.pathname);
    if (!m) return null;
    const code = decodeURIComponent(m[1]!);
    return CODE.test(code) ? { kind: 'place', code: code.toUpperCase() } : null;
  }
  return CODE.test(raw) ? { kind: 'place', code: raw.toUpperCase() } : null;
}

/** URL printed on a sticker. */
export function placeUrl(origin: string, code: string): string {
  return `${origin}/lab/${encodeURIComponent(code)}`;
}
