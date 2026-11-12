import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import { SearchField, norm } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { Card, ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { KIND_LABEL, NO_ROOM, type SmartAllowed, type SmartDiscovered } from './logic';
import s from './smart.module.css';

const ALLOWED_KEY = ['smart', 'allowlist'] as const;

/** /smart/devices: which HA devices the app may show and control (admin). */
export function SmartDevicesPage() {
  const status = useQuery({ queryKey: ['smart', 'status'], queryFn: () => unwrap(api.GET('/api/smart/status')), retry: false });
  const allowed = useQuery({ queryKey: ALLOWED_KEY, queryFn: () => unwrap(api.GET('/api/smart/allowlist')) });
  const rooms = [...new Set((allowed.data?.items ?? []).map((e) => e.room).filter(Boolean))];

  return (
    <>
      <Link to="/smart" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Розумна лабораторія
      </Link>
      <PageHeader title="Пристрої" />
      <div className={s.stack}>
        <Card>
          <h2 className={s.caption}>Home Assistant</h2>
          {status.isPending ? (
            <Skeleton height={24} />
          ) : status.isError ? (
            <ErrorMessage text={errorOf(status.error)} />
          ) : (
            <p className={s.rowSub}>
              Зв’язок є{status.data.name ? ` · ${status.data.name}` : ''}
              {status.data.version ? ` · версія ${status.data.version}` : ''} · дозволено пристроїв: {status.data.allowedEntities}
            </p>
          )}
          <p className="hint">
            Додати можна лише світло, сцени й датчики. Розетки й вимикачі застосунок не показує й не вмикає — так задумано.
          </p>
        </Card>
        <Card>
          <h2 className={s.caption}>Дозволені</h2>
          {allowed.isPending ? (
            <Skeleton height={120} />
          ) : allowed.isError ? (
            <ErrorMessage text={errorOf(allowed.error)} />
          ) : allowed.data.items.length === 0 ? (
            <p className="hint">Поки порожньо. Додайте пристрої зі списку нижче.</p>
          ) : (
            <ul className={s.rows} aria-label="Дозволені пристрої">
              {allowed.data.items.map((e) => (
                <li key={e.id}>
                  <AllowedRow entity={e} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Discover />
      </div>
      <datalist id="smart-rooms">
        {rooms.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['smart'] });
}

function AllowedRow({ entity: e }: { entity: SmartAllowed }) {
  const done = useInvalidate();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (body: { label?: string; room?: string; enabled?: boolean }) =>
      unwrap(api.PATCH('/api/smart/allowlist/{id}', { params: { path: { id: e.id } }, body })),
    onSuccess: () => {
      setEditing(false);
      done();
    },
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/smart/allowlist/{id}', { params: { path: { id: e.id } } })),
    onSuccess: done,
  });
  const busy = update.isPending || remove.isPending;

  return (
    <div className={s.row}>
      <span className={s.rowMain}>
        <span className={s.rowTitle}>
          {e.label}
          {!e.enabled && <span className={s.rowSub}> · приховано</span>}
        </span>
        <span className={s.rowSub}>
          {KIND_LABEL[e.kind]} · {e.room || NO_ROOM} · {e.entityId}
        </span>
      </span>
      {!editing && (
        <span className={s.actions}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
            Змінити
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => update.mutate({ enabled: !e.enabled })}>
            {e.enabled ? 'Приховати' : 'Показати'}
          </button>
          <ConfirmButton
            label="Прибрати"
            question={`Прибрати «${e.label}» зі списку? У Home Assistant пристрій лишиться.`}
            danger
            disabled={busy}
            onConfirm={() => remove.mutate()}
          />
        </span>
      )}
      {editing && (
        <NameForm
          id={`edit-${e.id}`}
          label={e.label}
          room={e.room}
          submitText="Зберегти"
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => update.mutate(v)}
        />
      )}
      <ErrorMessage text={update.error ? errorOf(update.error) : remove.error ? errorOf(remove.error) : null} />
    </div>
  );
}

function Discover() {
  const q = useQuery({ queryKey: ['smart', 'discover'], queryFn: () => unwrap(api.GET('/api/smart/discover')), retry: false });
  const [search, setSearch] = useState('');
  const needle = norm(search);
  const shown = (q.data?.items ?? []).filter((d) => !needle || norm(d.name).includes(needle) || norm(d.entityId).includes(needle));

  return (
    <Card>
      <h2 className={s.caption}>Знайдено в Home Assistant</h2>
      {q.isPending ? (
        <Skeleton height={120} />
      ) : q.isError ? (
        <ErrorMessage text={errorOf(q.error)} />
      ) : q.data.items.length === 0 ? (
        <p className="hint">Нових пристроїв немає: усе, що є в Home Assistant, уже в списку.</p>
      ) : (
        <>
          <div className={s.search}>
            <SearchField value={search} onChange={setSearch} placeholder="Назва чи entity_id" />
          </div>
          {shown.length === 0 ? (
            <p className="hint">Нічого не знайдено.</p>
          ) : (
            <ul className={s.rows} aria-label="Знайдені пристрої">
              {shown.map((d) => (
                <li key={d.entityId}>
                  <DiscoveredRow device={d} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function DiscoveredRow({ device: d }: { device: SmartDiscovered }) {
  const done = useInvalidate();
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: (v: { label: string; room: string }) =>
      unwrap(api.POST('/api/smart/allowlist', { body: { entityId: d.entityId, kind: d.kind, ...v } })),
    onSuccess: done,
  });
  return (
    <div className={s.row}>
      <span className={s.rowMain}>
        <span className={s.rowTitle}>{d.name}</span>
        <span className={s.rowSub}>
          {KIND_LABEL[d.kind]} · {d.entityId} · зараз: {d.state}
        </span>
      </span>
      {!adding && (
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Додати
        </button>
      )}
      {adding && (
        <NameForm
          id={`add-${d.entityId}`}
          label={d.name}
          room=""
          submitText="Додати"
          busy={add.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(v) => add.mutate(v)}
        />
      )}
      <ErrorMessage text={add.error ? errorOf(add.error) : null} />
    </div>
  );
}

function NameForm(props: {
  id: string;
  label: string;
  room: string;
  submitText: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { label: string; room: string }) => void;
}) {
  const [label, setLabel] = useState(props.label);
  const [room, setRoom] = useState(props.room);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    props.onSubmit({ label: label.trim(), room: room.trim() });
  };
  return (
    <form className={s.form} onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${props.id}-label`}>Назва в застосунку</label>
        <input id={`${props.id}-label`} required maxLength={120} value={label} onChange={(ev) => setLabel(ev.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${props.id}-room`}>Кімната</label>
        <input id={`${props.id}-room`} list="smart-rooms" maxLength={120} placeholder="Майстерня" value={room} onChange={(ev) => setRoom(ev.target.value)} />
      </div>
      <span className={s.actions}>
        <button type="submit" className="btn btn-primary" disabled={props.busy || !label.trim()}>
          {props.submitText}
        </button>
        <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
          Скасувати
        </button>
      </span>
    </form>
  );
}
