import { randomBytes } from 'crypto';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  normalizeRecoveryCode,
  otpauthUri,
  stepAt,
  totpAt,
  verifyTotp,
} from './totp';

// Тестові вектори RFC 6238, додаток B (SHA-1, секрет "12345678901234567890").
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP', () => {
  it.each(RFC)('RFC 6238: T=%i → %s', (t, code) => {
    expect(totpAt(RFC_SECRET, stepAt(t * 1000), 8)).toBe(code);
  });

  it('base32 туди й назад', () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('приймає код у межах ±30 с, але не далі', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    const code = (dSteps: number) => totpAt(RFC_SECRET, stepAt(now) + dSteps);
    expect(verifyTotp(secret, code(0), now, null)).toBe(stepAt(now));
    expect(verifyTotp(secret, code(-1), now, null)).toBe(stepAt(now) - 1);
    expect(verifyTotp(secret, code(1), now, null)).toBe(stepAt(now) + 1);
    expect(verifyTotp(secret, code(2), now, null)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });

  it('той самий код вдруге не приймається', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    const c = totpAt(RFC_SECRET, stepAt(now));
    const step = verifyTotp(secret, c, now, null)!;
    expect(verifyTotp(secret, c, now, step)).toBeNull();
  });

  it('otpauth-посилання для застосунку', () => {
    const uri = otpauthUri('ABC', 'admin@test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/DigiComp%20HUB%3Aadmin%40test\?/);
    expect(uri).toContain('secret=ABC');
    expect(uri).toContain('issuer=DigiComp+HUB');
  });

  it('коди відновлення: 8 штук, різні, нормалізація вводу', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes)
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeRecoveryCode(' 7kq2m9xd ')).toBe('7KQ2-M9XD');
    expect(normalizeRecoveryCode('7kq2-m9x')).toBeNull();
  });

  it('шифрування секрету: туди й назад, підробку видно', () => {
    const key = randomBytes(32);
    const blob = encryptSecret('SECRET', key);
    expect(blob).not.toContain('SECRET');
    expect(decryptSecret(blob, key)).toBe('SECRET');
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
    const parts = blob.split('.');
    parts[3] = Buffer.from('x').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
});
