import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Place, PlaceStatus } from '../../api/types';
import { distinct } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { keys, usePlace } from './queries';
import s from './lab.module.css';

export const PLACE_STATUS_LABEL: Record<PlaceStatus, string> = {
  active: 'Працює',
  maintenance: 'На обслуговуванні',
  archived: 'В архіві',
};

export const PLACE_CODE = /^[A-Za-z0-9_-]{3,60}$/;

/** /lab/new and /lab/:code/edit (places.manage). The code is fixed: it is printed on the QR. */
export function PlaceFormPage() {
  const { code } = useParams();
  const place = usePlace(code ?? '');
  if (!code) return <PlaceForm />;
  if (place.isPending) return <Skeleton height={320} />;
  if (place.isError) return <ErrorMessage text={errorOf(place.error)} />;
  return <PlaceForm place={place.data} />;
}

function PlaceForm({ place }: { place?: Place }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const all = useQuery({ queryKey: keys.places, queryFn: () => unwrap(api.GET('/api/places')) });
  const categories = useMemo(() => distinct((all.data ?? []).map((p) => p.category)), [all.data]);
  const [f, setF] = useState({
    code: place?.code ?? '',
    title: place?.title ?? '',
    category: place?.category ?? '',
    location: place?.location ?? '',
    description: place?.description ?? '',
    needsAuthorization: place?.needsAuthorization ?? true,
    exclusive: place?.exclusive ?? true,
    status: place?.status ?? ('active' as PlaceStatus),
  });
  const invalid =
    !place && !PLACE_CODE.test(f.code.trim())
      ? 'Код — 3–60 латинських літер, цифр, «-» або «_». Його друкують на QR-наліпці.'
      : !f.title.trim() || !f.category.trim()
        ? 'Заповніть назву й категорію.'
        : null;

  const save = useMutation({
    mutationFn: () => {
      const common = {
        title: f.title.trim(),
        category: f.category.trim(),
        location: f.location.trim(),
        description: f.description,
        needsAuthorization: f.needsAuthorization,
        exclusive: f.exclusive,
      };
      return place
        ? unwrap(api.PATCH('/api/places/{id}', { params: { path: { id: place.id } }, body: { ...common, status: f.status } }))
        : unwrap(api.POST('/api/places', { body: { ...common, code: f.code.trim() } }));
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['places'] });
      void navigate(`/lab/${encodeURIComponent(saved.code)}`);
    },
  });
  const set = (k: 'code' | 'title' | 'category' | 'location' | 'description') => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));
  const back = place ? `/lab/${encodeURIComponent(place.code)}` : '/lab';

  return (
    <>
      <Link to={back} className="btn btn-ghost">
        <Icon name="back" size={20} />
        {place ? place.title : 'Лабораторія'}
      </Link>
      <PageHeader title={place ? 'Редагувати обладнання' : 'Нове обладнання'} />
      <Card>
        <form
          className={s.form}
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          {place ? (
            <p className="hint">Код {place.code} не змінюється: він уже на QR-наліпці.</p>
          ) : (
            <div className="field">
              <label htmlFor="pl-code">Код (для QR)</label>
              <input id="pl-code" maxLength={60} autoCapitalize="characters" placeholder="CNC-1" value={f.code} onChange={set('code')} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pl-title">Назва</label>
            <input id="pl-title" maxLength={200} value={f.title} onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="pl-cat">Категорія</label>
            <input id="pl-cat" maxLength={100} list="place-categories" value={f.category} onChange={set('category')} />
            <datalist id="place-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="pl-loc">Місце</label>
            <input id="pl-loc" maxLength={200} placeholder="Майстерня, стіл 2" value={f.location} onChange={set('location')} />
          </div>
          <div className="field">
            <label htmlFor="pl-desc">Опис</label>
            <textarea id="pl-desc" maxLength={5000} value={f.description} onChange={set('description')} />
          </div>
          <label className={s.check}>
            <input type="checkbox" checked={f.needsAuthorization} onChange={(e) => setF((v) => ({ ...v, needsAuthorization: e.target.checked }))} />
            Потрібен допуск (учасник працює й бронює лише після інструктажу)
          </label>
          <label className={s.check}>
            <input type="checkbox" checked={f.exclusive} onChange={(e) => setF((v) => ({ ...v, exclusive: e.target.checked }))} />
            Лише один користувач одночасно
          </label>
          {place && (
            <div className="field">
              <label htmlFor="pl-status">Стан</label>
              <select id="pl-status" value={f.status} onChange={(e) => setF((v) => ({ ...v, status: e.target.value as PlaceStatus }))}>
                {(Object.keys(PLACE_STATUS_LABEL) as PlaceStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {PLACE_STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
              <span className="hint">
                На обслуговуванні не можна почати сеанс чи забронювати. Архівне обладнання зникає зі списку; історія зберігається.
              </span>
            </div>
          )}
          <ErrorMessage text={invalid && (f.title || f.code) ? invalid : save.isError ? errorOf(save.error) : null} />
          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={!!invalid || save.isPending}>
              {place ? 'Зберегти' : 'Додати'}
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
