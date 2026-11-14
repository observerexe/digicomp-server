// Stable keys of dictionaries and items. Records and templates store keys,
// so a title can be renamed freely. People never type keys: the server makes
// one from the title once, at creation.

const MAX = 40;

// Ukrainian national transliteration (KMU 2010); a few Russian letters too,
// so pasted text still gives a readable key.
const BASE: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  ы: 'y',
  э: 'e',
  ё: 'e',
  ъ: '',
};
// At the start of a word.
const INITIAL: Record<string, string> = {
  є: 'ye',
  ї: 'yi',
  й: 'y',
  ю: 'yu',
  я: 'ya',
};

export function slugify(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/зг/g, 'zgh')
    .split(/[^\p{L}\p{N}]+/u);
  const out = words
    .map((w) =>
      w
        .split('')
        .map((ch, i) => (i === 0 && INITIAL[ch]) || BASE[ch] || ch)
        .join('')
        .replace(/[^a-z0-9]/g, ''),
    )
    .filter(Boolean)
    .join('_')
    .slice(0, MAX)
    .replace(/_+$/, '');
  return /^[a-z]/.test(out) ? out : `k_${out}`.replace(/_+$/, '');
}

/** slugify plus a numeric suffix if the key is taken: type, type_2, type_3… */
export function uniqueKey(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(title);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const tail = `_${n}`;
    const key = base.slice(0, MAX - tail.length) + tail;
    if (!used.has(key)) return key;
  }
}
