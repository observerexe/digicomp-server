import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, unwrap } from '../../api/client';
import { Icon } from '../../components/Icon';
import { DictChip } from '../../components/Palette';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { DICTIONARIES_KEY, useDictionaries } from '../../lib/dictionaries';
import { plural } from '../../lib/format';
import s from './dictionaries.module.css';

/** /panel/dictionaries: lists of values with colours (staff). */
export function DictionariesPage() {
  const list = useDictionaries();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Link to="/panel" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Панель керування
      </Link>
      <PageHeader title="Довідники">
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Новий довідник
          </button>
        )}
      </PageHeader>
      <div className={s.stack}>
        {creating && <NewDictionary onCancel={() => setCreating(false)} />}
        <Card>
          {list.isPending ? (
            <Skeleton height={120} />
          ) : list.isError ? (
            <ErrorMessage text={errorOf(list.error)} />
          ) : list.data.length === 0 ? (
            <p className="hint">Довідників ще немає. Довідник — це список значень із кольорами: типи технічних завдань, категорії, пріоритети.</p>
          ) : (
            <ul className={s.rows} aria-label="Довідники">
              {list.data.map((d) => {
                const active = d.items.filter((i) => !i.archived);
                return (
                  <li key={d.key}>
                    <div className={s.row}>
                      <Link to={`/panel/dictionaries/${d.key}`} className={s.link}>
                        <span className={s.title}>{d.title}</span>
                        <span className={s.sub}>
                          {active.length} {plural(active.length, ['пункт', 'пункти', 'пунктів'])}
                        </span>
                        {active.length > 0 && (
                          <span className={s.chips}>
                            {active.slice(0, 6).map((i) => (
                              <DictChip key={i.key} title={i.title} color={i.color} />
                            ))}
                            {active.length > 6 && <span className={s.sub}>ще {active.length - 6}</span>}
                          </span>
                        )}
                      </Link>
                      <Icon name="chevron" size={20} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function NewDictionary({ onCancel }: { onCancel: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: (title: string) => unwrap(api.POST('/api/dictionaries', { body: { title } })),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: DICTIONARIES_KEY });
      void navigate(`/panel/dictionaries/${d.key}`);
    },
  });
  return (
    <Card>
      <TitleForm
        id="dict-title"
        label="Назва довідника"
        initial=""
        placeholder="Тип технічного завдання"
        submitText="Створити"
        busy={create.isPending}
        onCancel={onCancel}
        onSubmit={(t) => create.mutate(t)}
      />
      <ErrorMessage text={create.error ? errorOf(create.error) : null} />
    </Card>
  );
}

/** Title of a dictionary: creating and renaming. */
export function TitleForm(props: {
  id: string;
  label: string;
  initial: string;
  placeholder?: string;
  submitText: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState(props.initial);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    props.onSubmit(title.trim());
  };
  return (
    <form className={s.form} onSubmit={submit}>
      <div className="field">
        <label htmlFor={props.id}>{props.label}</label>
        <input
          id={props.id}
          required
          autoFocus
          maxLength={100}
          placeholder={props.placeholder}
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
        />
      </div>
      <div className={s.formActions}>
        <button type="submit" className="btn btn-primary" disabled={props.busy || !title.trim()}>
          {props.submitText}
        </button>
        <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
          Скасувати
        </button>
      </div>
    </form>
  );
}
