import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { InventoryItemDetail } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { isIntegerUnit, itemKey } from './ItemPage';
import s from './inventory.module.css';

/** /inventory/new and /inventory/:code/edit (staff). Quantity changes only by movements. */
export function ItemFormPage() {
  const { code } = useParams();
  const q = useQuery({
    queryKey: itemKey(code ?? ''),
    enabled: !!code,
    queryFn: () => unwrap(api.GET('/api/inventory/items/{id}', { params: { path: { id: code! } } })),
  });
  if (code && q.isPending) return <Skeleton height={320} />;
  if (code && q.isError) return <ErrorMessage text={errorOf(q.error)} />;
  return <ItemForm item={q.data} />;
}

function ItemForm({ item }: { item?: InventoryItemDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: item?.code ?? '',
    title: item?.title ?? '',
    category: item?.category ?? '',
    unit: item?.unit ?? 'шт',
    quantity: '0',
    minQuantity: String(item?.minQuantity ?? 0),
    location: item?.location ?? '',
    notes: item?.notes ?? '',
  });
  const num = (v: string) => Number(v.replace(',', '.'));
  const whole = isIntegerUnit(f.unit);
  const bad = (v: string) => !Number.isFinite(num(v)) || num(v) < 0 || (whole && !Number.isInteger(num(v)));
  const invalid = !item && !/^[A-Za-z0-9_-]{2,60}$/.test(f.code)
    ? 'Код — 2–60 латинських літер, цифр, «-» або «_».'
    : !f.title.trim() || !f.category.trim() || !f.unit.trim()
      ? 'Заповніть назву, категорію й одиницю.'
      : (!item && bad(f.quantity)) || bad(f.minQuantity)
        ? whole
          ? `Для «${f.unit}» кількість — ціле число від 0.`
          : 'Кількість — число від 0.'
        : null;

  const save = useMutation({
    mutationFn: () => {
      const common = {
        title: f.title.trim(),
        category: f.category.trim(),
        unit: f.unit.trim(),
        minQuantity: num(f.minQuantity),
        location: f.location.trim(),
        notes: f.notes,
      };
      return item
        ? unwrap(api.PATCH('/api/inventory/items/{id}', { params: { path: { id: item.id } }, body: common }))
        : unwrap(api.POST('/api/inventory/items', { body: { ...common, code: f.code.trim(), quantity: num(f.quantity) } }));
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void navigate(`/inventory/${encodeURIComponent(saved.code)}`);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  const back = item ? `/inventory/${encodeURIComponent(item.code)}` : '/inventory';

  return (
    <>
      <Link to={back} className="btn btn-ghost">
        <Icon name="back" size={20} />
        {item ? item.title : 'Склад'}
      </Link>
      <PageHeader title={item ? 'Редагувати позицію' : 'Нова позиція'} />
      <Card>
        <form
          className={s.form}
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          {!item && (
            <div className="field">
              <label htmlFor="it-code">Код (для QR)</label>
              <input id="it-code" maxLength={60} autoCapitalize="characters" placeholder="PLY-3" value={f.code} onChange={set('code')} />
            </div>
          )}
          <div className="field">
            <label htmlFor="it-title">Назва</label>
            <input id="it-title" maxLength={200} value={f.title} onChange={set('title')} />
          </div>
          <div className={s.row}>
            <div className="field">
              <label htmlFor="it-cat">Категорія</label>
              <input id="it-cat" maxLength={100} value={f.category} onChange={set('category')} />
            </div>
            <div className="field">
              <label htmlFor="it-unit">Одиниця</label>
              <input id="it-unit" maxLength={20} list="units" value={f.unit} onChange={set('unit')} />
              <datalist id="units">
                {['шт', 'уп', 'кг', 'г', 'м', 'л'].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            {!item && (
              <div className="field">
                <label htmlFor="it-qty">Початковий залишок</label>
                <input id="it-qty" inputMode="decimal" value={f.quantity} onChange={set('quantity')} />
              </div>
            )}
            <div className="field">
              <label htmlFor="it-min">Мінімум</label>
              <input id="it-min" inputMode="decimal" value={f.minQuantity} onChange={set('minQuantity')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="it-loc">Місце</label>
            <input id="it-loc" maxLength={200} placeholder="Шафа 2, полиця 3" value={f.location} onChange={set('location')} />
          </div>
          <div className="field">
            <label htmlFor="it-notes">Нотатки</label>
            <textarea id="it-notes" maxLength={5000} value={f.notes} onChange={set('notes')} />
          </div>
          <p className="hint">
            {item ? 'Залишок змінюється лише через «Взяти» / «Поповнити», щоб кожен рух був у журналі.' : 'Коли залишок досягне мінімуму, позиція позначиться «мало».'}
          </p>
          <ErrorMessage text={invalid && (f.title || f.code) ? invalid : save.isError ? errorOf(save.error) : null} />
          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={!!invalid || save.isPending}>
              {item ? 'Зберегти' : 'Створити'}
            </button>
            <Link to={back} className="btn btn-ghost">
              Скасувати
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
