/**
 * What a scanned QR points to. Stickers hold the full app URL
 * (https://<host>/lab/CNC-1) so a plain phone camera opens the app too;
 * a bare code ("CNC-1") is accepted as well. Links to other sites are ignored.
 */
export type ScanTarget = { kind: 'place' | 'item'; code: string };

/** App path of a scanned target. */
export function targetPath(t: ScanTarget): string {
  return `${t.kind === 'place' ? '/lab' : '/inventory'}/${encodeURIComponent(t.code)}`;
}

const CODE = /^[A-Za-z0-9_-]{3,60}$/; // same rule as the API (CreatePlaceDto)
const ITEM_CODE = /^[A-Za-z0-9_-]{2,60}$/; // CreateItemDto

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
    const m = /^\/(lab|inventory)\/([^/]+)\/?$/.exec(url.pathname);
    if (!m) return null;
    const code = decodeURIComponent(m[2]!);
    const kind = m[1] === 'lab' ? 'place' : 'item';
    return (kind === 'place' ? CODE : ITEM_CODE).test(code) ? { kind, code: code.toUpperCase() } : null;
  }
  return CODE.test(raw) ? { kind: 'place', code: raw.toUpperCase() } : null;
}

/** URL printed on a sticker. */
export function placeUrl(origin: string, code: string): string {
  return `${origin}/lab/${encodeURIComponent(code)}`;
}

export function itemUrl(origin: string, code: string): string {
  return `${origin}/inventory/${encodeURIComponent(code)}`;
}
