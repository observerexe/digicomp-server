import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { InventoryItemDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { formatDateTime } from '../../lib/format';
import { newActionKey } from '../lab/queries';
import { qty } from './InventoryPage';
import s from './inventory.module.css';

const INTEGER_UNITS = ['шт', 'pcs', 'уп'];
export const isIntegerUnit = (unit: string) => INTEGER_UNITS.includes(unit.trim().toLowerCase());
export const itemKey = (code: string) => ['inventory', 'item', code.toUpperCase()] as const;

/** Inventory item (by QR code): take or restock with a note, movement history. */
export function ItemPage() {
  const { code = '' } = useParams();
  const q = useQuery({
    queryKey: itemKey(code),
    queryFn: () => unwrap(api.GET('/api/inventory/items/{id}', { params: { path: { id: code } } })),
  });
  const back = (
    <Link to="/inventory" className="btn btn-ghost">
      <Icon name="back" size={20} />
      Склад
    </Link>
  );
  if (q.isPending) {
    return (
      <>
        {back}
        <Skeleton height={240} />
      </>
    );
  }
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        {back}
        <PageHeader title={gone ? 'Позицію не знайдено' : 'Не вдалося відкрити'} />
        <ErrorMessage text={gone ? 'Перевірте QR-код або виберіть позицію зі списку.' : errorOf(q.error)} />
      </>
    );
  }
  return (
    <>
      {back}
      <ItemView item={q.data} />
    </>
  );
}

function ItemView({ item }: { item: InventoryItemDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'take' | 'restock'>('take');
  const [amount, setAmount] = useState('1');
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ['projects', 'board', null],
    queryFn: () => unwrap(api.GET('/api/projects', { params: { query: { limit: '100' } } })),
  });
  const moves = useQuery({
    queryKey: ['inventory', 'moves', item.id],
    queryFn: () => unwrap(api.GET('/api/inventory/movements', { params: { query: { itemId: item.id, limit: '20' } } })),
  });
  const move = useMutation({
    mutationFn: () => {
      const n = Number(amount.replace(',', '.'));
      return unwrap(
        api.POST('/api/inventory/items/{id}/movements', {
          params: { path: { id: item.id } },
          body: {
            delta: mode === 'take' ? -n : n,
            note: note.trim(),
            ...(projectId ? { projectId } : {}),
            idempotencyKey: newActionKey(),
          },
        }),
      );
    },
    onSuccess: (m) => {
      // The new balance at once; the list and history refresh in the background.
      qc.setQueryData<InventoryItemDetail>(itemKey(item.code), (old) => (old ? { ...old, quantity: m.quantityAfter } : old));
      setDone(`${mode === 'take' ? 'Взято' : 'Поповнено'}: ${qty(Math.abs(m.delta), item.unit)}. Залишок ${qty(m.quantityAfter, item.unit)}.`);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const n = Number(amount.replace(',', '.'));
  const invalid =
    !Number.isFinite(n) || n <= 0
      ? 'Вкажіть кількість більше нуля.'
      : isIntegerUnit(item.unit) && !Number.isInteger(n)
        ? `Для «${item.unit}» — лише ціле число.`
        : mode === 'take' && n > item.quantity
          ? `На складі лише ${qty(item.quantity, item.unit)}.`
          : !note.trim()
            ? null
            : null;
  const low = item.minQuantity > 0 && item.quantity <= item.minQuantity;

  return (
    <>
      <PageHeader title={item.title}>
        <span className={`${s.qtyBig} ${low ? s.low : ''}`}>{qty(item.quantity, item.unit)}</span>
      </PageHeader>
      <p className={s.sub}>
        {[item.category, item.location && `місце: ${item.location}`, `код ${item.code}`, item.minQuantity > 0 && `мінімум ${qty(item.minQuantity, item.unit)}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {low && <p className={s.warn}>Залишок на мінімумі або нижче. Повідомте модератора, якщо потрібно докупити.</p>}
      {item.notes && <p className={s.notes}>{item.notes}</p>}
      <div className={s.grid}>
        <Card>
          <form
            className={s.form}
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!invalid && note.trim()) move.mutate();
            }}
          >
            <div className={s.segmented} role="group" aria-label="Дія">
              <button type="button" aria-pressed={mode === 'take'} onClick={() => setMode('take')}>
                Взяти
              </button>
              <button type="button" aria-pressed={mode === 'restock'} onClick={() => setMode('restock')}>
                Поповнити
              </button>
            </div>
            <div className="field">
              <label htmlFor="mv-amount">Кількість, {item.unit}</label>
              <input
                id="mv-amount"
                inputMode={isIntegerUnit(item.unit) ? 'numeric' : 'decimal'}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setTouched(true);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="mv-note">{mode === 'take' ? 'Для чого' : 'Звідки'}</label>
              <input
                id="mv-note"
                maxLength={500}
                placeholder={mode === 'take' ? 'Корпус для стенду' : 'Купили в «Епіцентрі»'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mv-project">Проєкт (необов’язково)</label>
              <select id="mv-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Без проєкту</option>
                {projects.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            {done && (
              <p role="status" className={s.ok}>
                {done}
              </p>
            )}
            <ErrorMessage text={(touched || note.trim() ? invalid : null) ?? (move.isError ? errorOf(move.error) : null)} />
            <button type="submit" className="btn btn-primary" disabled={!!invalid || !note.trim() || move.isPending}>
              {move.isPending ? 'Зберігаємо…' : mode === 'take' ? 'Взяти' : 'Поповнити'}
            </button>
          </form>
        </Card>
        <div className={s.stack}>
          <Card>
            <h2 className={s.caption}>Рухи</h2>
            {moves.isPending ? (
              <Skeleton height={96} />
            ) : moves.isError ? (
              <ErrorMessage text={errorOf(moves.error)} />
            ) : moves.data.items.length === 0 ? (
              <p className="hint">Рухів ще не було.</p>
            ) : (
              <ul className={s.moves} aria-label="Рухи">
                {moves.data.items.map((m) => (
                  <li key={m.id}>
                    <span className={s.main}>
                      <span>{m.note}</span>
                      <span className={s.sub}>
                        {m.actor.name ?? 'Учасник'} · {formatDateTime(m.createdAt)}
                      </span>
                    </span>
                    <span className={m.delta < 0 ? s.minus : s.plus}>
                      {m.delta > 0 ? '+' : '−'}
                      {qty(Math.abs(m.delta), item.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {item.documents.length > 0 && (
            <Card>
              <h2 className={s.caption}>Документи</h2>
              <ul className={s.moves}>
                {item.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/documents/${d.id}/download`} target="_blank" rel="noopener">
                      {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {can('inventory.manage') && (
            <Link to={`/inventory/${encodeURIComponent(item.code)}/edit`} className="btn">
              Редагувати позицію
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
