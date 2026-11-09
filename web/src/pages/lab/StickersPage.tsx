import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { Icon } from '../../components/Icon';
import { QrCode } from '../../components/QrCode';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { placeUrl } from '../../lib/scan';
import { keys } from './queries';
import s from './lab.module.css';

/**
 * A4 sheet of QR stickers. The QR holds the full app URL, so a plain phone
 * camera opens the equipment page; the in-app scanner reads it too.
 */
export function StickersPage() {
  const places = useQuery({ queryKey: keys.places, queryFn: () => unwrap(api.GET('/api/places')) });
  const items = (places.data ?? []).filter((p) => p.status !== 'archived');
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
          Друкуйте на A4 у масштабі 100%. Наліпка — 6 × 6 см. Камера телефона відкриє сторінку обладнання навіть без застосунку.
        </p>
        {places.isPending ? (
          <Skeleton height={120} />
        ) : places.isError ? (
          <ErrorMessage text={errorOf(places.error)} />
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
            <QrCode value={placeUrl(location.origin, p.code)} label={`QR-код ${p.title}`} size={150} />
            <span className={s.stickerTitle}>{p.title}</span>
            <span className={s.code}>{p.code}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
