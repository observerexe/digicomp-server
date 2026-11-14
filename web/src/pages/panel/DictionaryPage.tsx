import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Dictionary, DictionaryItem, PaletteColor } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ColorPicker, DictChip } from '../../components/Palette';
import { Card, ConfirmButton, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { DICTIONARIES_KEY, TitleForm } from './DictionariesPage';
import s from './dictionaries.module.css';

/** /panel/dictionaries/:key: items with colours, order and archive (staff). */
export function DictionaryPage() {
  const { key = '' } = useParams();
  const q = useQuery({
    queryKey: [...DICTIONARIES_KEY, key],
    queryFn: () => unwrap(api.GET('/api/dictionaries/{key}', { params: { path: { key } } })),
  });

  return (
    <>
      <Link to="/panel/dictionaries" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Довідники
      </Link>
      {q.isPending ? <Skeleton height={240} /> : q.isError ? <ErrorMessage text={errorOf(q.error)} /> : <Content dict={q.data} />}
    </>
  );
}

function useDone() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: DICTIONARIES_KEY });
}

function Content({ dict }: { dict: Dictionary }) {
  const done = useDone();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const path = { params: { path: { key: dict.key } } };
  const rename = useMutation({
    mutationFn: (title: string) => unwrap(api.PATCH('/api/dictionaries/{key}', { ...path, body: { title } })),
    onSuccess: () => {
      setRenaming(false);
      done();
    },
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/dictionaries/{key}', path)),
    onSuccess: () => {
      done();
      void navigate('/panel/dictionaries');
    },
  });
  const reorder = useMutation({
    mutationFn: (keys: string[]) =>
      unwrap(
        api.PUT('/api/dictionaries/{key}/items/order', {
          ...path,
          body: { keys },
        }),
      ),
    onSuccess: done,
  });

  const active = dict.items.filter((i) => !i.archived);
  const archived = dict.items.filter((i) => i.archived);
  // The order covers every item; archived ones keep their place at the end.
  const move = (index: number, by: -1 | 1) => {
    const keys = active.map((i) => i.key);
    [keys[index], keys[index + by]] = [keys[index + by]!, keys[index]!];
    reorder.mutate([...keys, ...archived.map((i) => i.key)]);
  };

  return (
    <>
      {renaming ? (
        <Card>
          <TitleForm
            id="dict-rename"
            label="Назва довідника"
            initial={dict.title}
            submitText="Зберегти"
            busy={rename.isPending}
            onCancel={() => setRenaming(false)}
            onSubmit={(t) => rename.mutate(t)}
          />
          <ErrorMessage text={rename.error ? errorOf(rename.error) : null} />
        </Card>
      ) : (
        <PageHeader title={dict.title}>
          <button type="button" className="btn" onClick={() => setRenaming(true)}>
            Перейменувати
          </button>
          {!dict.required && dict.items.length === 0 && (
            <ConfirmButton
              label="Видалити"
              question={`Видалити довідник «${dict.title}»?`}
              danger
              disabled={remove.isPending}
              onConfirm={() => remove.mutate()}
            />
          )}
        </PageHeader>
      )}
      <ErrorMessage text={remove.error ? errorOf(remove.error) : null} />
      <div className={s.stack}>
        <Card>
          <h2 className={s.caption}>Пункти</h2>
          {active.length === 0 ? (
            <p className="hint">Пунктів ще немає. Додайте перший нижче.</p>
          ) : (
            <ul className={s.rows} aria-label="Пункти">
              {active.map((item, index) => (
                <li key={item.key}>
                  <ItemRow
                    dictKey={dict.key}
                    item={item}
                    busy={reorder.isPending}
                    onUp={index > 0 ? () => move(index, -1) : undefined}
                    onDown={index < active.length - 1 ? () => move(index, 1) : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
          <ErrorMessage text={reorder.error ? errorOf(reorder.error) : null} />
        </Card>
        <NewItem dictKey={dict.key} />
        {archived.length > 0 && (
          <Card>
            <h2 className={s.caption}>В архіві</h2>
            <p className="hint">Їх не пропонують для нових записів; у старих записах вони лишаються.</p>
            <ul className={s.rows} aria-label="В архіві">
              {archived.map((item) => (
                <li key={item.key}>
                  <ItemRow dictKey={dict.key} item={item} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function ItemRow(props: { dictKey: string; item: DictionaryItem; busy?: boolean; onUp?: () => void; onDown?: () => void }) {
  const { item } = props;
  const done = useDone();
  const [editing, setEditing] = useState(false);
  const path = { params: { path: { key: props.dictKey, itemKey: item.key } } };
  const update = useMutation({
    mutationFn: (body: { title?: string; color?: PaletteColor; archived?: boolean }) =>
      unwrap(api.PATCH('/api/dictionaries/{key}/items/{itemKey}', { ...path, body })),
    onSuccess: () => {
      setEditing(false);
      done();
    },
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/dictionaries/{key}/items/{itemKey}', path)),
    onSuccess: done,
  });
  const busy = props.busy || update.isPending || remove.isPending;
  const error = update.error ?? remove.error;

  const deleteButton = (
    <ConfirmButton label="Видалити" question={`Видалити «${item.title}»?`} danger disabled={busy} onConfirm={() => remove.mutate()} />
  );

  return (
    <div className={`${s.row} ${item.archived ? s.archived : ''}`}>
      <span className={s.rowMain}>
        <DictChip title={item.title} color={item.color} />
      </span>
      {item.archived ? (
        <span className={s.actions}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => update.mutate({ archived: false })}>
            Повернути
          </button>
          {deleteButton}
        </span>
      ) : (
        !editing && (
          <span className={s.actions}>
            <button
              type="button"
              className={`btn btn-ghost ${s.icon}`}
              aria-label={`«${item.title}» вище`}
              disabled={busy || !props.onUp}
              onClick={props.onUp}
            >
              <Icon name="up" size={20} />
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${s.icon}`}
              aria-label={`«${item.title}» нижче`}
              disabled={busy || !props.onDown}
              onClick={props.onDown}
            >
              <Icon name="down" size={20} />
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              Змінити
            </button>
          </span>
        )
      )}
      {editing && (
        <ItemForm
          id={`item-${item.key}`}
          initial={item}
          submitText="Зберегти"
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => update.mutate(v)}
        >
          <button type="button" className="btn" disabled={busy} onClick={() => update.mutate({ archived: true })}>
            В архів
          </button>
          {deleteButton}
        </ItemForm>
      )}
      <ErrorMessage text={error ? errorOf(error) : null} />
    </div>
  );
}

function NewItem({ dictKey }: { dictKey: string }) {
  const done = useDone();
  const [form, setForm] = useState(0);
  const add = useMutation({
    mutationFn: (body: { title: string; color: PaletteColor }) =>
      unwrap(
        api.POST('/api/dictionaries/{key}/items', {
          params: { path: { key: dictKey } },
          body,
        }),
      ),
    onSuccess: () => {
      setForm((n) => n + 1); // a fresh empty form for the next item
      done();
    },
  });
  return (
    <Card>
      <h2 className={s.caption}>Додати пункт</h2>
      <ItemForm key={form} id="item-new" submitText="Додати" busy={add.isPending} onSubmit={(v) => add.mutate(v)} />
      <ErrorMessage text={add.error ? errorOf(add.error) : null} />
    </Card>
  );
}

function ItemForm(props: {
  id: string;
  initial?: { title: string; color: PaletteColor };
  submitText: string;
  busy: boolean;
  onCancel?: () => void;
  onSubmit: (v: { title: string; color: PaletteColor }) => void;
  children?: ReactNode;
}) {
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [color, setColor] = useState<PaletteColor>(props.initial?.color ?? 'gray');
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    props.onSubmit({ title: title.trim(), color });
  };
  return (
    <form className={s.form} onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${props.id}-title`}>Назва</label>
        <input id={`${props.id}-title`} required maxLength={100} value={title} onChange={(ev) => setTitle(ev.target.value)} />
      </div>
      <ColorPicker name={`${props.id}-color`} value={color} onChange={setColor} />
      <div className={s.formActions}>
        <button type="submit" className="btn btn-primary" disabled={props.busy || !title.trim()}>
          {props.submitText}
        </button>
        {props.onCancel && (
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            Скасувати
          </button>
        )}
        {props.children}
      </div>
    </form>
  );
}
