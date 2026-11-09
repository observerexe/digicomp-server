// One-off: converts the official e-Ukraine OTF files to WOFF2 into
// public/fonts. Usage: npm run fonts -- /path/to/folder/with/otf
// Source: https://thedigital.gov.ua/fonts (CC BY 4.0, © Мінцифри України).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';

const src = process.argv[2];
if (!src) throw new Error('Pass the folder with e-Ukraine *.otf files');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
const files = [
  'e-Ukraine-Regular.otf',
  'e-Ukraine-Medium.otf',
  'e-Ukraine-Bold.otf',
  'e-UkraineHead-Medium.otf',
  'e-UkraineHead-Bold.otf',
];
for (const f of files) {
  const woff2 = await wawoff2.compress(readFileSync(join(src, f)));
  const name = basename(f, '.otf') + '.woff2';
  writeFileSync(join(out, name), woff2);
  console.log(name, woff2.length);
}
