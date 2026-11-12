import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Card, ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDateTime, formatTime } from '../../lib/format';
import {
  ACTION_LABEL,
  BACKUP_STALE_HOURS,
  CONTAINER_LABEL,
  containerText,
  containerTone,
  formatAgo,
  formatBytes,
  formatUptime,
  usageTone,
  type PanelAction,
  type PanelJob,
  type PanelOverview,
  type Tone,
} from './labels';
import s from './admin.module.css';

/** `tailscale serve --https=9443` (docs/ADMIN_PANEL_UA.md): same host, panel port. */
export const PANEL_HTTPS_PORT = '9443';
export const panelUrl = (loc: { hostname: string }) => `https://${loc.hostname}:${PANEL_HTTPS_PORT}/admin`;

/** Timings of the job polling; tests shorten them. */
export const POLL = { intervalMs: 2000, overviewMs: 15_000, restartWaitMs: 90_000 };

const OVERVIEW_KEY = ['admin-panel', 'overview'] as const;

/** Not the panel port (404) or a session without 2FA: polling cannot help. */
export const panelClosed = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.code === 'TWO_FACTOR_REQUIRED');

/** /admin: the extended panel (admin, 2FA session, panel port only — the API checks all three). */
export function AdminPage() {
  const overview = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => unwrap(api.GET('/api/admin-panel/overview')),
    retry: false,
    // Stop polling only when the panel cannot open here at all; a 429 or a
    // session refresh must not freeze the numbers until a manual reload.
    refetchInterval: (q) => (panelClosed(q.state.error) ? false : POLL.overviewMs),
  });
  const err = overview.error;

  return (
    <>
      <PageHeader title="Розширена панель">
        <Link to="/admin/audit" className="btn btn-ghost">
          Журнал дій
        </Link>
      </PageHeader>
      {overview.isPending ? (
        <Skeleton height={320} />
      ) : err instanceof ApiError && err.status === 404 ? (
        <NotHere />
      ) : err instanceof ApiError && err.code === 'TWO_FACTOR_REQUIRED' ? (
        <NeedTwoFactor />
      ) : (
        <>
          {err ? (
            <Card>
              <ErrorMessage text={errorOf(err)} />
              <p className="hint">Журнал дій працює і без агента.</p>
            </Card>
          ) : (
            <Overview data={overview.data!} />
          )}
          <div className={s.grid}>
            <Actions />
            <Logs />
          </div>
        </>
      )}
    </>
  );
}

function NotHere() {
  const url = panelUrl(location);
  return (
    <Card>
      <div className={s.stack}>
        <p>Розширена панель відкривається лише з tailnet, за окремою адресою.</p>
        <p>
          <a href={url} className="btn btn-primary">
            Відкрити панель
          </a>
        </p>
        <p className="hint">
          Адреса: {url}. Пристрій має бути в мережі Tailscale. Звичайна адреса застосунку (через Funnel) панелі не показує — так задумано.
        </p>
      </div>
    </Card>
  );
}

function NeedTwoFactor() {
  const { user, logout } = useAuth();
  return (
    <Card>
      <div className={s.stack}>
        <p>Для розширеної панелі потрібен вхід із кодом 2FA.</p>
        {user?.twoFactorEnabled ? (
          <>
            <p className="hint">2FA у вас увімкнена, але цей вхід був без коду (наприклад, до її ввімкнення). Увійдіть знову.</p>
            <span className={s.actions}>
              <button type="button" className="btn btn-primary" onClick={() => void logout({ next: '/admin' })}>
                Вийти й увійти з кодом
              </button>
            </span>
          </>
        ) : (
          <span className={s.actions}>
            <Link to="/profile/2fa" className="btn btn-primary">
              Увімкнути 2FA
            </Link>
          </span>
        )}
      </div>
    </Card>
  );
}

function Meter({ label, value, percent, note }: { label: string; value: string; percent: number; note?: string }) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <div className={s.stat}>
      <span className={s.statHead}>
        <span>{label}</span>
        <span className={s.statValue}>{value}</span>
      </span>
      <div className={s.bar} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
        <div className={`${s.fill} ${s[usageTone(p)]}`} style={{ width: `${p}%` }} />
      </div>
      {note && <span className={s.sub}>{note}</span>}
    </div>
  );
}

function Badge({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}

function Overview({ data }: { data: PanelOverview }) {
  const { metrics: m, containers, lastBackup: b } = data;
  const memPercent = m.memory.totalBytes ? (100 * m.memory.usedBytes) / m.memory.totalBytes : 0;
  const stale = b.found && b.at ? Date.now() - Date.parse(b.at) > BACKUP_STALE_HOURS * 3_600_000 : false;
  return (
    <div className={s.grid}>
      <Card>
        <h2 className={s.caption}>Сервер</h2>
        <div className={s.stack}>
          <Meter
            label="Процесор"
            value={`${Math.round(m.cpuPercent)}%`}
            percent={m.cpuPercent}
            note={`${m.cpuCount ?? '?'} ядер · навантаження ${m.load.map((x) => x.toLocaleString('uk-UA')).join(' / ')}`}
          />
          <Meter
            label="Пам’ять"
            value={`${formatBytes(m.memory.usedBytes)} з ${formatBytes(m.memory.totalBytes)}`}
            percent={memPercent}
          />
          {m.disks.map((d) => (
            <Meter
              key={d.path}
              label={`Диск ${d.path}`}
              value={`вільно ${formatBytes(d.freeBytes)}`}
              percent={d.totalBytes ? (100 * d.usedBytes) / d.totalBytes : 0}
              note={`зайнято ${formatBytes(d.usedBytes)} з ${formatBytes(d.totalBytes)}`}
            />
          ))}
          <span className={s.sub}>
            Працює без перезапуску {formatUptime(m.uptimeSeconds)} · оновлено о {formatTime(m.collectedAt)}
          </span>
        </div>
      </Card>
      <div className={s.stack}>
        <Card>
          <h2 className={s.caption}>Контейнери</h2>
          <ul className={s.rows} aria-label="Контейнери">
            {containers.map((c) => (
              <li key={c.name} className={s.row}>
                <span>
                  <span className={s.statValue}>{CONTAINER_LABEL[c.name] ?? c.name}</span>
                  {c.status && <span className={s.sub}> · {c.status}</span>}
                </span>
                <Badge tone={containerTone(c)}>{containerText(c)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className={s.caption}>Бекап</h2>
          {b.found && b.at ? (
            <div className={s.row}>
              <span>
                <span className={s.statValue}>{formatDateTime(b.at)}</span>
                <span className={s.sub}>
                  {' '}
                  · {formatAgo(b.at)}
                  {b.sizeBytes !== undefined && ` · ${formatBytes(b.sizeBytes)}`} · файлів {b.count}
                </span>
              </span>
              <Badge tone={stale ? 'warn' : 'ok'}>{stale ? 'застарів' : 'свіжий'}</Badge>
            </div>
          ) : (
            <div className={s.row}>
              <span>Бекапів не знайдено.</span>
              <Badge tone="bad">немає</Badge>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const ACTIONS: { action: PanelAction; question: string; danger?: boolean }[] = [
  { action: 'backup', question: 'Зробити бекап бази й файлів зараз?' },
  { action: 'restore-check', question: 'Перевірити відновлення останнього бекапу? Це займе кілька хвилин.' },
  { action: 'restart-api', question: 'Перезапустити API? Застосунок буде недоступний приблизно хвилину.', danger: true },
  { action: 'restart-ha', question: 'Перезапустити Home Assistant? Світло й датчики зникнуть на хвилину-дві.', danger: true },
];

function start(action: PanelAction) {
  if (action === 'backup') return unwrap(api.POST('/api/admin-panel/actions/backup'));
  if (action === 'restore-check') return unwrap(api.POST('/api/admin-panel/actions/restore-check'));
  return unwrap(api.POST('/api/admin-panel/actions/restart', { body: { target: action === 'restart-api' ? 'api' : 'ha' } }));
}

/**
 * Worth asking again: network down or a gateway error while the API restarts,
 * the request limit, or a session that is being restored after the restart.
 */
const retryable = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || e.status >= 502 || e.status === 401 || e.status === 429);

function Actions() {
  const qc = useQueryClient();
  const [job, setJob] = useState<PanelJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [offline, setOffline] = useState(false);
  const [starting, setStarting] = useState(false);
  // The job result could not be read (the agent forgot it, access lost):
  // the action may still have succeeded, so this is not «помилка».
  const [lost, setLost] = useState(false);
  const running = job?.status === 'running' && !lost;

  // Poll the job until it ends; ride out the API restart (the agent keeps the job).
  useEffect(() => {
    if (!job || !running) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const since = Date.now();
    const tick = async () => {
      try {
        const next = await unwrap(api.GET('/api/admin-panel/jobs/{id}', { params: { path: { id: job.id } } }));
        if (stop) return;
        setOffline(false);
        setJob(next);
        if (next.status !== 'running') {
          void qc.invalidateQueries({ queryKey: ['admin-panel'] });
          return;
        }
      } catch (e) {
        if (stop) return;
        if (!retryable(e) || Date.now() - since > POLL.restartWaitMs) {
          setOffline(false);
          setLost(true);
          return;
        }
        setOffline(true);
      }
      timer = setTimeout(() => void tick(), POLL.intervalMs);
    };
    timer = setTimeout(() => void tick(), POLL.intervalMs);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // A new job (id) or a finished one restarts or stops the loop; the job
    // object itself changes on every poll and must not restart it.
  }, [job?.id, running]);

  const run = async (action: PanelAction) => {
    setError(null);
    setLost(false);
    setStarting(true);
    try {
      setJob(await start(action));
    } catch (e) {
      setError(e);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <h2 className={s.caption}>Дії</h2>
      <div className={s.stack}>
        <span className={s.actions}>
          {ACTIONS.map((a) => (
            <ConfirmButton
              key={a.action}
              label={ACTION_LABEL[a.action]}
              question={a.question}
              danger={a.danger}
              disabled={running || starting}
              onConfirm={() => void run(a.action)}
            />
          ))}
        </span>
        <p className="hint">Одночасно виконується лише одна дія. Базу даних з панелі не перезапустити, і нічого не видаляється.</p>
        {job && (
          <div className={s.stack} aria-live="polite">
            <div className={s.row}>
              <span>
                <span className={s.statValue}>{ACTION_LABEL[job.action]}</span>
                <span className={s.sub}>
                  {' '}
                  · почато о {formatTime(job.startedAt)}
                  {job.finishedAt && `, завершено о ${formatTime(job.finishedAt)}`}
                </span>
              </span>
              <Badge tone={lost ? 'warn' : job.status === 'succeeded' ? 'ok' : job.status === 'running' ? 'warn' : 'bad'}>
                {lost
                  ? 'невідомо'
                  : job.status === 'succeeded'
                    ? 'готово'
                    : job.status === 'running'
                      ? 'виконується…'
                      : `помилка${job.exitCode !== null ? ` (код ${job.exitCode})` : ''}`}
              </Badge>
            </div>
            {offline && <p className="hint">Сервер перезапускається, чекаємо, поки він знову відповість…</p>}
            {lost && (
              <p className="hint">
                Не вдалося дізнатися, чим закінчилась дія: вона могла виконатись успішно. Перевірте стан контейнерів і час бекапу вище або логи.
              </p>
            )}
            {job.output.length > 0 && <pre className={s.output}>{job.output.join('\n')}</pre>}
          </div>
        )}
        <ErrorMessage text={error ? errorOf(error) : null} />
      </div>
    </Card>
  );
}

const LOG_SIZES = [100, 200, 500];

function Logs() {
  const [lines, setLines] = useState(200);
  const [filter, setFilter] = useState('');
  const q = useQuery({
    queryKey: ['admin-panel', 'logs', lines],
    queryFn: () => unwrap(api.GET('/api/admin-panel/logs', { params: { query: { lines: String(lines) } } })),
    retry: false,
  });
  const needle = filter.trim().toLowerCase();
  const shown = (q.data?.lines ?? []).filter((l) => !needle || l.toLowerCase().includes(needle));
  return (
    <Card>
      <h2 className={s.caption}>Логи API</h2>
      <div className={s.tools}>
        <div className="field">
          <label htmlFor="log-lines">Рядків</label>
          <select id="log-lines" value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            {LOG_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="log-filter">Пошук</label>
          <input id="log-filter" type="search" placeholder="error, 500, ім’я…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button type="button" className="btn" disabled={q.isFetching} onClick={() => void q.refetch()}>
          Оновити
        </button>
      </div>
      {q.isPending ? (
        <Skeleton height={200} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : (
        <>
          {!q.data.ok && <p className="hint">Агент не зміг прочитати логи; нижче — його відповідь.</p>}
          <pre className={s.output} aria-label="Рядки логу">
            {shown.length ? shown.join('\n') : needle ? 'Нічого не знайдено.' : 'Лог порожній.'}
          </pre>
        </>
      )}
    </Card>
  );
}
