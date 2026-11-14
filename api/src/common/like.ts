/** Escapes `%`, `_` and `\` for an ILIKE pattern. */
export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** ILIKE pattern: contains `s`. */
export function containsLike(s: string) {
  return `%${escapeLike(s)}%`;
}
