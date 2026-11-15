import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { RecordType, TemplateItem, TemplateKind } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ErrorMessage, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { recordsKey } from '../../lib/fields';
import { RECORD_TYPES } from '../../lib/records';
import s from './editor.module.css';

/** What a template is for: kept from the start, never changes. */
export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  free: 'Вільний документ',
  creates: 'Створює запис',
  report: 'Звіт про запис',
};

/** Every record type with its name and whether a template may create its records (from the schemas). */
function useRecordTypes() {
  const schemas = useQueries({
    queries: RECORD_TYPES.map((type) => ({
      queryKey: [...recordsKey(type), 'schema'],
      queryFn: () => unwrap(api.GET('/api/records/{type}/schema', { params: { path: { type } } })),
      staleTime: 5 * 60_000,
    })),
  });
  return RECORD_TYPES.map((type, i) => {
    const schema = schemas[i]!.data;
    return { type: type as RecordType, label: schema?.label ?? type, creatable: !!schema?.fields.some((f) => f.create), ready: !!schema };
  });
}

/** «Шаблони»: every template with its versions; a template opens in the constructor. */
export function TemplatesList() {
  const templates = useQuery({
    queryKey: ['paper-templates', 'list'],
    queryFn: () => unwrap(api.GET('/api/papers/templates')),
  });
  const types = useRecordTypes();
  const typeLabel = (t: string | null) => types.find((x) => x.type === t)?.label ?? t;

  if (templates.isPending) return <Skeleton height={240} />;
  if (templates.isError) return <ErrorMessage text={errorOf(templates.error)} />;
  if (!templates.data.length) return <p className="hint">Шаблонів ще немає. Створіть перший — він відкриється в конструкторі.</p>;
  return (
    <ul className={s.list} aria-label="Шаблони документів">
      {templates.data.map((t) => (
        <li key={t.id}>
          <Link to={`/editor/templates/${t.id}`} className={s.row}>
            <span className={s.kind}>
              <Icon name="file" size={20} />
            </span>
            <span className={s.main}>
              <span className={s.title}>
                {t.title}
                <TemplateTags t={t} />
              </span>
              <span className={s.sub}>{[TEMPLATE_KIND_LABEL[t.kind], t.target && typeLabel(t.target)].filter(Boolean).join(' · ')}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TemplateTags({ t }: { t: TemplateItem }) {
  return (
    <>
      {t.currentVersion !== null ? <span className={`${s.tag} ${s.tagPublished}`}>v{t.currentVersion} опубліковано</span> : <span className={s.tag}>Не опубліковано</span>}
      {t.draftVersion !== null && <span className={`${s.tag} ${s.tagDraft}`}>v{t.draftVersion} чернетка</span>}
      {t.needsUpdate && <span className={s.tag}>Потребує оновлення</span>}
      {t.archived && <span className={s.tag}>В архіві</span>}
    </>
  );
}

/** «Новий шаблон»: a name, what it is for and which record; the template opens in the constructor. */
export function NewTemplate({ onClose }: { onClose: () => void }) {
  const id = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TemplateKind>('free');
  const [target, setTarget] = useState<RecordType | ''>('');
  const types = useRecordTypes();
  const offered = types.filter((t) => t.ready && (kind !== 'creates' || t.creatable));
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api/papers/templates', { body: { title: title.trim(), kind, ...(kind !== 'free' && target ? { target } : {}) } })),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['paper-templates', 'list'] });
      void navigate(`/editor/templates/${t.id}`);
    },
  });
  const ready = title.trim() !== '' && (kind === 'free' || offered.some((t) => t.type === target));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) create.mutate();
  };
  return (
    <form className={s.newTemplate} onSubmit={submit} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Новий шаблон</h2>
      <div className="field">
        <label htmlFor={`${id}-title`}>Назва</label>
        <input id={`${id}-title`} value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-kind`}>Призначення</label>
        <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
          {(Object.keys(TEMPLATE_KIND_LABEL) as TemplateKind[]).map((k) => (
            <option key={k} value={k}>
              {TEMPLATE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="hint">
          {kind === 'free'
            ? 'Документ без запису: протокол, інструкція, лист.'
            : kind === 'creates'
              ? 'Коли документ опублікують, з нього створиться запис.'
              : 'Документ про наявний запис: паспорт, звіт, акт.'}{' '}
          Призначення й запис потім не змінюються.
        </span>
      </div>
      {kind !== 'free' && (
        <div className="field">
          <label htmlFor={`${id}-target`}>Запис</label>
          <select id={`${id}-target`} value={offered.some((t) => t.type === target) ? target : ''} onChange={(e) => setTarget(e.target.value as RecordType)}>
            <option value="">Виберіть тип запису</option>
            {offered.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorMessage text={create.isError ? errorOf(create.error) : null} />
      <div className={s.formActions}>
        <button type="submit" className="btn btn-primary" disabled={!ready || create.isPending}>
          Створити й відкрити
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
      </div>
    </form>
  );
}
