import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Fault, FaultStatus, Place, PlaceStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Card, ErrorMessage, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDate } from '../../lib/format';
import { resizeImage } from '../../lib/resizeImage';
import { keys } from './queries';
import s from './lab.module.css';

const MAX_PHOTOS = 3;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const FAULT_STATUS_LABEL: Record<FaultStatus, string> = {
  open: 'Відкрито',
  in_progress: 'В роботі',
  closed: 'Закрито',
};

/** Open reports, the last closed one, «Несправність» with photos; staff actions. */
export function FaultsSection({ place }: { place: Place }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: keys.faults(place.id),
    queryFn: () => unwrap(api.GET('/api/faults', { params: { query: { placeId: place.id, limit: '20' } } })),
  });
  const items = q.data?.items ?? [];
  const active = items.filter((f) => f.status !== 'closed');
  const lastClosed = items.find((f) => f.status === 'closed');

  return (
    <Card>
      <section id="faults" aria-labelledby="faults-title" className={s.form}>
        <div className={s.sectionHead}>
          <h2 id="faults-title" className={s.caption}>
            Несправності
          </h2>
          {!open && place.status !== 'archived' && (
            <button type="button" className="btn" onClick={() => setOpen(true)}>
              Несправність
            </button>
          )}
        </div>
        {open && (
          <ReportForm
            place={place}
            onDone={() => {
              setOpen(false);
              void qc.invalidateQueries({ queryKey: ['faults'] });
            }}
          />
        )}
        {q.isPending ? (
          <Skeleton height={64} />
        ) : q.isError ? (
          <ErrorMessage text={errorOf(q.error)} />
        ) : (
          <>
            {active.length === 0 ? (
              <p className="hint">Відкритих несправностей немає. Помітили, що щось не так? Натисніть «Несправність» і додайте фото.</p>
            ) : (
              <ul className={s.rows} aria-label="Відкриті несправності">
                {active.map((f) => (
                  <FaultRow key={f.id} fault={f} placeStatus={place.status} />
                ))}
              </ul>
            )}
            {lastClosed && (
              <p className="hint">
                Остання закрита — «{lastClosed.description}», {lastClosed.closedAt && formatDate(lastClosed.closedAt)}
                {lastClosed.closedBy?.name && `, ${lastClosed.closedBy.name}`}
                {lastClosed.resolution && `: «${lastClosed.resolution}»`}.
              </p>
            )}
          </>
        )}
      </section>
    </Card>
  );
}

function ReportForm({ place, onDone }: { place: Place; onDone: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [partial, setPartial] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const fault = await unwrap(api.POST('/api/faults', { body: { placeId: place.id, description: text.trim() } }));
      // The report exists; a photo that fails is reported but does not undo it.
      let failed = 0;
      for (const f of files) {
        try {
          const small = await resizeImage(f, 1600);
          if (!PHOTO_TYPES.includes(small.type) || small.size > PHOTO_MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
          const body = new FormData();
          body.append('file', small);
          await unwrap(api.POST('/api/faults/{id}/photos', { params: { path: { id: fault.id } }, body: body as never }));
        } catch {
          failed++;
        }
      }
      return failed;
    },
    onSuccess: (failed) => {
      if (failed) setPartial(`Звіт надіслано, але ${failed} фото не завантажилось.`);
      else onDone();
    },
  });

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  };

  if (partial) {
    return (
      <div className={s.form}>
        <p className={s.warn}>{partial}</p>
        <button type="button" className="btn" onClick={onDone}>
          Гаразд
        </button>
      </div>
    );
  }

  return (
    <form
      className={s.form}
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <div className="field">
        <label htmlFor="fault-text">Що сталося</label>
        <textarea
          id="fault-text"
          maxLength={2000}
          placeholder="Наприклад: люфт осі Z, шпиндель гуде після 10 хвилин роботи"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className={s.photos}>
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className={s.photoChip}>
            {f.name}
            <button type="button" aria-label={`Прибрати ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        {files.length < MAX_PHOTOS && (
          <label className="btn btn-ghost">
            Додати фото
            <input type="file" accept="image/*" multiple className={s.fileInput} onChange={onFiles} />
          </label>
        )}
      </div>
      <p className="hint">До {MAX_PHOTOS} фото. Телефон зменшить їх перед надсиланням.</p>
      <ErrorMessage text={send.isError ? errorOf(send.error) : null} />
      <div className={s.actions}>
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || send.isPending}>
          {send.isPending ? 'Надсилаємо…' : 'Надіслати'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Скасувати
        </button>
      </div>
    </form>
  );
}

/**
 * One report with staff actions. On the equipment page the place state comes
 * from the page (fresh); in the panel list — from the report itself, and the
 * equipment is shown as a link.
 */
export function FaultRow({ fault, placeStatus, showPlace = false }: { fault: Fault; placeStatus?: PlaceStatus; showPlace?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [resolution, setResolution] = useState('');
  const [reactivate, setReactivate] = useState(true);
  const detail = useQuery({
    queryKey: keys.fault(fault.id),
    enabled: expanded && fault.photosCount > 0,
    queryFn: () => unwrap(api.GET('/api/faults/{id}', { params: { path: { id: fault.id } } })),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['faults'] });
    void qc.invalidateQueries({ queryKey: ['places'] });
  };
  const path = { params: { path: { id: fault.id } } };
  const act = useMutation({
    mutationFn: (kind: 'progress' | 'maintenance' | 'close') =>
      kind === 'progress'
        ? unwrap(api.POST('/api/faults/{id}/in-progress', path))
        : kind === 'maintenance'
          ? unwrap(api.POST('/api/faults/{id}/maintenance', path))
          : unwrap(api.POST('/api/faults/{id}/close', { ...path, body: { resolution: resolution.trim(), reactivatePlace: reactivate } })),
    onSuccess: () => setClosing(false),
    onSettled: refresh,
  });

  const staff = can('faults.close');
  return (
    <li className={s.fault}>
      <span className={s.faultHead}>
        <span className={`${s.badge} ${fault.status === 'open' ? s.badgeBusy : s.badgeWarn}`}>{FAULT_STATUS_LABEL[fault.status]}</span>
        <span className={s.rowSub}>
          {formatDate(fault.createdAt)}
          {fault.reporter?.name && ` · ${fault.reporter.name}`}
        </span>
      </span>
      {showPlace && (
        <Link className={s.rowTitle} to={`/lab/${encodeURIComponent(fault.place.code ?? fault.place.id)}`}>
          {fault.place.title ?? 'Обладнання'}
        </Link>
      )}
      <span>{fault.description}</span>
      {fault.photosCount > 0 && (
        <button type="button" className={s.linkButton} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Сховати фото' : `Фото: ${fault.photosCount}`}
        </button>
      )}
      {expanded && detail.data && (
        <span className={s.photoGrid}>
          {detail.data.photos.map((ph) => (
            <a key={ph.id} href={`/api/faults/${fault.id}/photos/${ph.id}`} target="_blank" rel="noopener">
              <img src={`/api/faults/${fault.id}/photos/${ph.id}`} alt="Фото несправності" loading="lazy" />
            </a>
          ))}
        </span>
      )}
      {staff && !closing && (
        <span className={s.actions}>
          {fault.status === 'open' && (
            <button type="button" className="btn" disabled={act.isPending} onClick={() => act.mutate('progress')}>
              В роботі
            </button>
          )}
          {placeStatus === 'active' && (
            <button type="button" className="btn" disabled={act.isPending} onClick={() => act.mutate('maintenance')}>
              На обслуговування
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setClosing(true)}>
            Закрити
          </button>
        </span>
      )}
      {closing && (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate('close');
          }}
        >
          <div className="field">
            <label htmlFor={`res-${fault.id}`}>Що зроблено</label>
            <input id={`res-${fault.id}`} maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </div>
          {placeStatus === 'maintenance' && (
            <label className={s.check}>
              <input type="checkbox" checked={reactivate} onChange={(e) => setReactivate(e.target.checked)} />
              Повернути обладнання в роботу
            </label>
          )}
          <span className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={!resolution.trim() || act.isPending}>
              Закрити звіт
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setClosing(false)}>
              Назад
            </button>
          </span>
        </form>
      )}
      <ErrorMessage text={act.isError ? errorOf(act.error) : null} />
    </li>
  );
}
