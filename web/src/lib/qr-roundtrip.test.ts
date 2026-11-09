import jsQR from 'jsqr';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { parseScan, placeUrl } from './scan';

/** Renders the same matrix QrCode draws into pixels and reads it back. */
function decode(text: string): string | null {
  const { data } = encode(text, { ecc: 'M', border: 2 });
  const px = 4;
  const n = data.length * px;
  const img = new Uint8ClampedArray(n * n * 4).fill(255);
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (!on) return;
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const i = ((y * px + dy) * n + x * px + dx) * 4;
          img[i] = img[i + 1] = img[i + 2] = 0;
        }
    }),
  );
  return jsQR(img, n, n)?.data ?? null;
}

describe('QR наліпки читається сканером', () => {
  it('адреса обладнання проходить шлях наліпка → сканер → сторінка', () => {
    const origin = 'https://digicomp.example.ts.net';
    const text = decode(placeUrl(origin, 'CNC-1'));
    expect(text).toBe('https://digicomp.example.ts.net/lab/CNC-1');
    expect(parseScan(text!, origin)).toEqual({ kind: 'place', code: 'CNC-1' });
  });

  it('otpauth-посилання для 2FA теж читається', () => {
    const uri = 'otpauth://totp/DigiComp%20HUB:marta%40demo.local?secret=JBSWY3DPEHPK3PXP&issuer=DigiComp%20HUB';
    expect(decode(uri)).toBe(uri);
  });
});
