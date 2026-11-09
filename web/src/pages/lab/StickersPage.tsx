import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import { Icon } from '../../components/Icon';
import { QrCode } from '../../components/QrCode';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { itemUrl, placeUrl } from '../../lib/scan';
import { keys } from './queries';
import s from './lab.module.css';

/**
 * A4 sheet of QR stickers. The QR holds the full app URL, so a plain phone
 * camera opens the equipment page; the in-app scanner reads it too.
 */
export function StickersPage() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') === 'items' ? 'items' : 'places';
  const places = useQuery({ queryKey: keys.places, queryFn: () => unwrap(api.GET('/api/places')) });
  const stock = useQuery({
    queryKey: ['inventory', 'items'],
    enabled: kind === 'items',
    queryFn: () => unwrap(api.GET('/api/inventory/items', { params: { query: { limit: '100' } } })),
  });
  const source = kind === 'items' ? stock : places;
  const items =
    kind === 'items'
      ? (stock.data?.items ?? []).map((i) => ({ id: i.id, code: i.code, title: i.title, url: itemUrl(location.origin, i.code) }))
      : (places.data ?? [])
          .filter((p) => p.status !== 'archived')
          .map((p) => ({ id: p.id, code: p.code, title: p.title, url: placeUrl(location.origin, p.code) }));
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = items.filter((p) => !off.has(p.id));
  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="no-print">
        <Link to="/lab" className="btn btn-ghost">
          <Icon name="back" size={20} />
          Лабораторія
        </Link>
        <PageHeader title="Наліпки QR">
          <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={() => window.print()}>
            Друкувати ({chosen.length})
          </button>
        </PageHeader>
        <p className="hint">
          Друкуйте на A4 у масштабі 100%. Наліпка — 6 × 6 см. Камера телефона відкриє потрібну сторінку навіть без застосунку.
        </p>
        <div className={s.kinds} role="group" aria-label="Що друкувати">
          <button type="button" aria-pressed={kind === 'places'} onClick={() => setParams({}, { replace: true })}>
            Обладнання
          </button>
          <button type="button" aria-pressed={kind === 'items'} onClick={() => setParams({ kind: 'items' }, { replace: true })}>
            Склад
          </button>
        </div>
        {source.isPending ? (
          <Skeleton height={120} />
        ) : source.isError ? (
          <ErrorMessage text={errorOf(source.error)} />
        ) : (
          <fieldset className={s.pick}>
            <legend className="visually-hidden">Що друкувати</legend>
            {items.map((p) => (
              <label key={p.id} className={s.check}>
                <input type="checkbox" checked={!off.has(p.id)} onChange={() => toggle(p.id)} />
                {p.title} <span className={s.code}>{p.code}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <ul className={s.sheet} aria-label="Наліпки">
        {chosen.map((p) => (
          <li key={p.id} className={s.sticker}>
            <QrCode value={p.url} label={`QR-код ${p.title}`} size={150} />
            <span className={s.stickerTitle}>{p.title}</span>
            <span className={s.code}>{p.code}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
