import { describe, expect, it } from 'vitest';
import { generatePassword } from './password';

describe('generatePassword', () => {
  it('довжина, лише дозволені символи, щоразу інший', () => {
    const a = generatePassword();
    expect(a).toHaveLength(14);
    expect(a).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
    expect(generatePassword(20)).toHaveLength(20);
    expect(generatePassword()).not.toBe(a);
  });
});
