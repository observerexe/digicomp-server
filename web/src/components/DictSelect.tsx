import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { api, unwrap } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { errorOf } from '../errors/messages';
import { DICTIONARIES_KEY, useDictionary } from '../lib/dictionaries';
import { ErrorMessage } from './ui';
import s from './DictSelect.module.css';

// Item keys start with a letter, so this never clashes with one.
const NEW = '__new__';

/**
 * Choice of a dictionary item for a form field. Archived items are not offered,
 * except the current value. Staff can add a missing item right from the list.
 */
export function DictSelect(props: {
  id: string;
  dictionary: string;
  value: string;
  onChange: (key: string) => void;
  newLabel: string;
  /** The value may be empty: «Не вибрано» can be chosen. */
  clearable?: boolean;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const dict = useDictionary(props.dictionary);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/api/dictionaries/{key}/items', { params: { path: { key: props.dictionary } }, body: { title: title.trim() } })),
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: DICTIONARIES_KEY });
      props.onChange(item.key);
      setAdding(false);
      setTitle('');
    },
  });

  if (adding) {
    const submit = () => {
      if (title.trim() && !add.isPending) add.mutate();
    };
    const cancel = () => {
      setAdding(false);
      setTitle('');
      add.reset();
    };
    return (
      <>
        <div className={s.add}>
          <input
            id={props.id}
            maxLength={100}
            placeholder="Назва"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e: KeyboardEvent) => {
              // Enter adds the item instead of submitting the whole form.
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') cancel();
            }}
          />
          <button type="button" className="btn" disabled={!title.trim() || add.isPending} onClick={submit}>
            Додати
          </button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Скасувати
          </button>
        </div>
        <ErrorMessage text={add.isError ? errorOf(add.error) : null} />
      </>
    );
  }

  const items = dict.data?.items ?? [];
  const current = items.find((i) => i.key === props.value);
  return (
    <>
      <select
        id={props.id}
        value={props.value}
        disabled={dict.isPending}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : props.onChange(e.target.value))}
      >
        <option value="" disabled={!props.clearable}>
          {dict.isPending ? 'Завантаження…' : props.clearable ? 'Не вибрано' : 'Виберіть…'}
        </option>
        {items
          .filter((i) => !i.archived)
          .map((i) => (
            <option key={i.key} value={i.key}>
              {i.title}
            </option>
          ))}
        {current?.archived && <option value={current.key}>{current.title} (в архіві)</option>}
        {props.value && !current && !dict.isPending && <option value={props.value}>{props.value}</option>}
        {can('dictionaries.manage') && <option value={NEW}>{props.newLabel}</option>}
      </select>
      <ErrorMessage text={dict.isError ? errorOf(dict.error) : null} />
    </>
  );
}
