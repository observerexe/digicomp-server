import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, unwrap } from '../../api/client';
import type { RecordSchema, Template, TemplateCreators, PaperVisibility } from '../../api/types';
import { ConfirmButton, ErrorMessage } from '../../components/ui';
import { Switch } from '../../editor/BuilderPanel';
import p from '../../editor/BuilderPanel.module.css';
import { errorOf } from '../../errors/messages';
import { formatDate, plural } from '../../lib/format';
import s from './editor.module.css';
import { TEMPLATE_KIND_LABEL } from './TemplatesTab';

type Patch = { title?: string; numberPrefix?: string | null; autoFreeze?: boolean; creators?: TemplateCreators; visibility?: PaperVisibility; archived?: boolean };

/** Capital letters (Latin or Cyrillic) and digits, as the server takes them. */
const PREFIX = /^[\p{Lu}\d]{1,10}$/u;

type Props = {
  template: Template;
  schema: RecordSchema | undefined;
  /** The server's template after a change. */
  onChange: (t: Template) => void;
  /** The draft or the template is gone: its unsaved changes must not follow. */
  stopSaving: () => void;
  onDiscarded: () => void;
  onDeleted: () => void;
};

/**
 * «Шаблон»: what the template is for, the number, who makes documents and
 * who sees them, auto-freeze, versions, the archive. These settings are of
 * the whole template and apply at once; text and fields — when a version is published.
 */
export function TemplateSettings({ template: t, schema, onChange, stopSaving, onDiscarded, onDeleted }: Props) {
  const id = useId();
  const patch = useMutation({
    mutationFn: (body: Patch) => unwrap(api.PATCH('/api/papers/templates/{id}', { params: { path: { id: t.id } }, body })),
    onSuccess: onChange,
  });
  const discard = useMutation({
    mutationFn: (v: number) => unwrap(api.DELETE('/api/papers/templates/{id}/versions/{v}', { params: { path: { id: t.id, v } } })),
    onSuccess: () => {
      stopSaving();
      onDiscarded();
    },
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/papers/templates/{id}', { params: { path: { id: t.id } } })),
    onSuccess: () => {
      stopSaving();
      onDeleted();
    },
  });
  const [title, setTitle] = useState(t.title);
  const [prefix, setPrefix] = useState(t.numberPrefix ?? '');
  const prefixBad = prefix !== '' && !PREFIX.test(prefix);
  const saveTitle = () => {
    const v = title.trim();
    if (!v) setTitle(t.title);
    else if (v !== t.title) patch.mutate({ title: v });
  };
  const savePrefix = () => {
    const v = prefix || null;
    if (!prefixBad && v !== t.numberPrefix) patch.mutate({ numberPrefix: v });
  };
  const error = patch.error ?? discard.error ?? remove.error;

  return (
    <>
      <p className="hint">Ці налаштування діють одразу для всього шаблону. Текст і поля — після публікації версії.</p>
      <div className="field">
        <label htmlFor={`${id}-title`}>Назва</label>
        <input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          aria-invalid={!title.trim()}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
        />
      </div>
      <div className={p.prop}>
        <span className={p.propLabel}>Призначення</span>
        <span>{[TEMPLATE_KIND_LABEL[t.kind], t.target && (schema?.label ?? t.target)].filter(Boolean).join(' · ')}</span>
        <span className="hint">Призначення й запис не змінюються.</span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-prefix`}>Префікс номера</label>
        <input
          id={`${id}-prefix`}
          className={p.mono}
          value={prefix}
          maxLength={10}
          placeholder="без номера"
          autoComplete="off"
          aria-invalid={prefixBad}
          aria-describedby={`${id}-prefix-hint`}
          onChange={(e) => setPrefix(e.target.value.toUpperCase().trim())}
          onBlur={savePrefix}
          onKeyDown={(e) => e.key === 'Enter' && savePrefix()}
        />
        <span id={`${id}-prefix-hint`} className={prefixBad ? p.error : 'hint'}>
          {prefixBad
            ? 'Лише великі літери й цифри, до 10 знаків.'
            : prefix
              ? `Номер видається, коли документ опублікують: ${prefix}-${new Date().getFullYear()}-001.`
              : 'Без префікса документи не мають номера.'}
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-creators`}>Хто створює документи</label>
        <select id={`${id}-creators`} value={t.creators} onChange={(e) => patch.mutate({ creators: e.target.value as TemplateCreators })}>
          <option value="staff">Модератори й адмін</option>
          <option value="all">Усі учасники</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-visibility`}>Хто бачить нові документи</label>
        <select id={`${id}-visibility`} value={t.visibility} onChange={(e) => patch.mutate({ visibility: e.target.value as PaperVisibility })}>
          <option value="author">Автор і модератори</option>
          <option value="members">Усі учасники</option>
        </select>
      </div>
      {t.kind === 'creates' && (
        <div className={p.prop}>
          <Switch label="Фіксувати, коли запис готовий" on={t.autoFreeze} onChange={(autoFreeze) => patch.mutate({ autoFreeze })} />
          <span className="hint">Документ сам фіксується для друку й підпису, щойно запис завершено.</span>
        </div>
      )}
      <section className={p.prop} aria-labelledby={`${id}-versions`}>
        <h3 id={`${id}-versions`} className={p.propLabel}>
          Версії
        </h3>
        <ul className={s.versions}>
          {t.versions.map((v) => (
            <li key={v.number}>
              <span className={s.versionHead}>
                <strong>v{v.number}</strong>
                {v.publishedAt === null ? (
                  <span className={`${s.tag} ${s.tagDraft}`}>чернетка</span>
                ) : v.number === t.currentVersion ? (
                  <span className={`${s.tag} ${s.tagPublished}`}>поточна</span>
                ) : null}
              </span>
              {v.publishedAt !== null && (
                <span className="hint">
                  {[
                    `опубліковано ${formatDate(v.publishedAt)}`,
                    v.publishedBy?.name,
                    v.documents !== null && `${v.documents} ${plural(v.documents, ['документ', 'документи', 'документів'])}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
              {v.publishedAt === null && t.currentVersion !== null && (
                <ConfirmButton
                  label="Відкинути чернетку"
                  question={`Відкинути v${v.number}? Зміни в ній зникнуть.`}
                  confirmLabel="Відкинути"
                  danger
                  disabled={discard.isPending}
                  onConfirm={() => discard.mutate(v.number)}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
      {t.currentVersion === null ? (
        <ConfirmButton label="Видалити шаблон" question="Видалити шаблон назавжди?" confirmLabel="Видалити" danger disabled={remove.isPending} onConfirm={() => remove.mutate()} />
      ) : (
        <div className={p.prop}>
          <button type="button" className={`btn ${p.remove}`} disabled={patch.isPending} onClick={() => patch.mutate({ archived: !t.archived })}>
            {t.archived ? 'Повернути з архіву' : 'Перенести в архів'}
          </button>
          <span className="hint">
            {t.archived ? 'Шаблон в архіві: нові документи з нього не створюються.' : 'В архіві шаблон лишається для наявних документів, але нових з нього не створюють.'}
          </span>
        </div>
      )}
      <ErrorMessage text={error ? errorOf(error) : null} />
    </>
  );
}
