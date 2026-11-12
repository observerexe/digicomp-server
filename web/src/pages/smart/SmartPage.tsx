import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { binaryAlarm, binaryText, byRoom, sensorText, type SmartState } from './logic';
import s from './smart.module.css';

export const SMART_KEY = ['smart', 'entities'] as const;

/** Timings; tests shorten them. */
export const SMART_TIMING = { refreshMs: 15_000, brightnessDelayMs: 400 };

/** /smart: devices by room. Everyone sees, staff controls (docs/tech/ARCHITECTURE.md). */
export function SmartPage() {
  const { can } = useAuth();
  const q = useQuery({
    queryKey: SMART_KEY,
    queryFn: () => unwrap(api.GET('/api/smart/entities')),
    // A lamp switched in HA itself or by someone else shows up on its own.
    refetchInterval: SMART_TIMING.refreshMs,
  });
  const canControl = can('smart.control');
  const canManage = can('smart.allowlist');

  return (
    <>
      <PageHeader title="Розумна лабораторія">
        {canManage && (
          <Link to="/smart/devices" className="btn btn-ghost">
            Пристрої
          </Link>
        )}
      </PageHeader>
      {q.isPending ? (
        <div className={s.grid}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : q.isError ? (
        <>
          <ErrorMessage text={errorOf(q.error)} />
          {q.error instanceof ApiError && q.error.code === 'SMART_NOT_CONFIGURED' && canManage && (
            <p className="hint">Як підключити Home Assistant — docs/tech/OPERATIONS.md, розділ «Home Assistant».</p>
          )}
        </>
      ) : q.data.items.length === 0 ? (
        <p className="hint">
          {canManage ? (
            <>
              Пристроїв ще немає. <Link to="/smart/devices">Додайте їх зі списку Home Assistant.</Link>
            </>
          ) : (
            'Пристроїв ще немає: їх додає адміністратор.'
          )}
        </p>
      ) : (
        byRoom(q.data.items).map(([room, items]) => (
          <section key={room} className={s.room} aria-label={room}>
            <h2 className={s.roomTitle}>{room}</h2>
            <ul className={s.grid}>
              {items.map((e) => (
                <li key={e.id}>
                  <Tile entity={e} canControl={canControl} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {!canControl && q.data && q.data.items.length > 0 && (
        <p className="hint">Керують світлом і сценами модератори й адміністратор.</p>
      )}
    </>
  );
}

function Tile({ entity: e, canControl }: { entity: SmartState; canControl: boolean }) {
  const off = !e.available;
  return (
    <article className={`${s.tile} ${off ? s.tileOff : ''}`} aria-label={e.label}>
      <span className={s.tileHead}>
        <span className={s.tileTitle}>{e.label}</span>
        {off && <span className={s.badge}>недоступний</span>}
      </span>
      {e.kind === 'light' && <Light entity={e} canControl={canControl && !off} />}
      {e.kind === 'scene' && <Scene entity={e} canControl={canControl && !off} />}
      {e.kind === 'sensor' && !off && <span className={s.value}>{sensorText(e)}</span>}
      {e.kind === 'binary_sensor' && !off && (
        <span className={`${s.value} ${binaryAlarm(e) ? s.alarm : ''}`}>{binaryText(e)}</span>
      )}
    </article>
  );
}

/** Puts the light's new state into the cached list (optimistic and from the answer). */
function useLight(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { on: boolean; brightness?: number }) =>
      unwrap(api.POST('/api/smart/lights/{id}/state', { params: { path: { id } }, body })),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: SMART_KEY });
      const before = qc.getQueryData<{ items: SmartState[] }>(SMART_KEY);
      patch(qc, id, { on: body.on, ...(body.brightness !== undefined ? { brightness: body.brightness } : {}) });
      return { before };
    },
    onError: (_e, _b, ctx) => {
      if (ctx?.before) qc.setQueryData(SMART_KEY, ctx.before);
    },
    onSuccess: (next) => patch(qc, id, next),
  });
}

function patch(qc: ReturnType<typeof useQueryClient>, id: string, next: Partial<SmartState>) {
  qc.setQueryData<{ items: SmartState[] }>(SMART_KEY, (old) =>
    old ? { items: old.items.map((x) => (x.id === id ? { ...x, ...next } : x)) } : old,
  );
}

function Light({ entity: e, canControl }: { entity: SmartState; canControl: boolean }) {
  const set = useLight(e.id);
  const on = !!e.on;
  // The slider shows the dragged value; HA gets one request when the hand stops.
  const [level, setLevel] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onSlide = (v: number) => {
    setLevel(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      set.mutate({ on: true, brightness: v }, { onSettled: () => setLevel(null) });
    }, SMART_TIMING.brightnessDelayMs);
  };

  const shown = level ?? e.brightness ?? null;
  return (
    <>
      <span className={s.lightRow}>
        <span className={s.value}>{on ? (e.brightness != null ? `Увімкнено · ${e.brightness}%` : 'Увімкнено') : 'Вимкнено'}</span>
        {canControl && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={e.label}
            className={s.switch}
            disabled={set.isPending}
            onClick={() => set.mutate({ on: !on })}
          >
            <span className={s.knob} />
          </button>
        )}
      </span>
      {canControl && on && shown !== null && (
        <div className={s.slider}>
          <Icon name="bulb" size={18} />
          <input
            type="range"
            min={1}
            max={100}
            aria-label={`Яскравість, ${e.label}`}
            value={shown}
            onChange={(ev) => onSlide(Number(ev.target.value))}
          />
          <span className={s.percent} aria-hidden="true">
            {shown}%
          </span>
        </div>
      )}
      {set.isError && <ErrorMessage text={errorOf(set.error)} />}
    </>
  );
}

function Scene({ entity: e, canControl }: { entity: SmartState; canControl: boolean }) {
  const run = useMutation({
    mutationFn: () => unwrap(api.POST('/api/smart/scenes/{id}/activate', { params: { path: { id: e.id } } })),
  });
  if (!canControl) return <span className={s.value}>Сцена</span>;
  return (
    <>
      <span className={s.lightRow}>
        <span className={s.value}>{run.isSuccess ? 'Увімкнено' : 'Сцена'}</span>
        <button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Вмикаємо…' : 'Увімкнути'}
        </button>
      </span>
      {run.isError && <ErrorMessage text={errorOf(run.error)} />}
    </>
  );
}
