/** Letters and digits without look-alikes (0/O, 1/l/I): easy to dictate or retype. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A strong one-time password for a new member or a reset (≈ 80 bits at 14 chars). */
export function generatePassword(length = 14): string {
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length); // rejection sampling: no bias
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length]!);
    }
  }
  return out.join('');
}
