import { useState } from 'react';
import { initials } from '../lib/format';
import s from './Avatar.module.css';

/** Photo or initials; falls back to initials if the picture cannot load. */
export function Avatar({ name, url, size = 40 }: { name: string | null; url: string | null | undefined; size?: 32 | 40 | 56 | 96 }) {
  const [broken, setBroken] = useState<string | null>(null);
  const cls = `${s.avatar} ${s[`s${size}`]}`;
  if (url && broken !== url) {
    return <img className={cls} src={url} alt="" width={size} height={size} onError={() => setBroken(url)} />;
  }
  return (
    <span className={cls} aria-hidden="true">
      {initials(name ?? '?')}
    </span>
  );
}
