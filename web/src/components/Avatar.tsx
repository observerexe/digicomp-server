import { useState } from 'react';
import type { PaletteColor } from '../api/types';
import { initials } from '../lib/format';
import s from './Avatar.module.css';

/**
 * Photo or initials; falls back to initials if the picture cannot load. `color` — the account's colour: initials
 * in its shade, a photo in a ring of it.
 */
export function Avatar({ name, url, color, size = 40 }: { name: string | null; url: string | null | undefined; color?: PaletteColor | null; size?: 32 | 40 | 56 | 96 }) {
  const [broken, setBroken] = useState<string | null>(null);
  const cls = [s.avatar, s[`s${size}`], color ? `${s.colored} pal-${color}` : ''].filter(Boolean).join(' ');
  if (url && broken !== url) {
    return <img className={cls} src={url} alt="" width={size} height={size} onError={() => setBroken(url)} />;
  }
  return (
    <span className={cls} aria-hidden="true">
      {initials(name ?? '?')}
    </span>
  );
}
