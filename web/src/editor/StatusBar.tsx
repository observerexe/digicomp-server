import { useState } from 'react';
import { plural } from '../lib/format';
import { PAGE, type PageStats } from './usePageStats';
import s from './StatusBar.module.css';

/** Zoom steps of the sheet, %. Each has a class in StatusBar.module.css (CSP: no `style`). */
export const ZOOMS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const;
export type Zoom = (typeof ZOOMS)[number];
const ZOOM_KEY = 'editor.zoom';

function storedZoom(): Zoom {
  const v = Number(localStorage.getItem(ZOOM_KEY));
  return (ZOOMS as readonly number[]).includes(v) ? (v as Zoom) : 100;
}

/** The sheet's zoom, remembered in this browser. */
export function useZoom() {
  const [zoom, setZoom] = useState<Zoom>(storedZoom);
  const change = (z: Zoom) => {
    setZoom(z);
    localStorage.setItem(ZOOM_KEY, String(z));
  };
  return [zoom, change, s[`z${zoom}`] ?? ''] as const;
}

const FORMAT = `A4 · поля ${PAGE.left}/${PAGE.right}/${PAGE.top}/${PAGE.bottom} мм`;

/** `hints` — keys that help here («Tab — наступне поле»). */
export function StatusBar({ stats, zoom, onZoom, hints = [] }: { stats: PageStats; zoom: Zoom; onZoom: (z: Zoom) => void; hints?: string[] }) {
  const i = ZOOMS.indexOf(zoom);
  return (
    <footer className={s.bar}>
      <span className={s.wide}>
        Сторінка {stats.page} з {stats.pages}
      </span>
      <span>
        {stats.words} {plural(stats.words, ['слово', 'слова', 'слів'])}
      </span>
      <span className={s.wide}>{FORMAT}</span>
      {hints.length > 0 && <span className={`${s.wide} ${s.hints}`}>{hints.join(' · ')}</span>}
      <span className={`${s.zoom} ${s.wide}`}>
        <button type="button" className={s.step} aria-label="Зменшити" disabled={i === 0} onClick={() => onZoom(ZOOMS[i - 1]!)}>
          −
        </button>
        <input
          type="range"
          aria-label="Масштаб"
          aria-valuetext={`${zoom}%`}
          min={0}
          max={ZOOMS.length - 1}
          step={1}
          value={i}
          onChange={(e) => onZoom(ZOOMS[Number(e.target.value)]!)}
        />
        <button type="button" className={s.step} aria-label="Збільшити" disabled={i === ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[i + 1]!)}>
          +
        </button>
        <span className={s.percent}>{zoom}%</span>
      </span>
    </footer>
  );
}
